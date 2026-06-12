import { join } from "node:path";
import { writeFile } from "node:fs/promises";
import { app, shell, BrowserWindow, ipcMain, dialog } from "electron";
import { SessionManager, type SessionSink } from "./sessionManager";
import { IpcServer } from "./ipcServer";
import { NotificationCenter } from "./notifications";
import { createAuditStore, type AuditStore } from "./store/db";
import {
  IPC,
  type SessionInputMsg,
  type SessionResizeMsg,
  type SessionSpawnMsg,
  type PermissionRespondMsg,
} from "../shared/ipc";
import type { AppSettings, HistoryDetail } from "../shared/types";

/**
 * Electron main: the single PRIMARY that owns the window and every PTY. Relay
 * launchers (bin/agentwatch.js) connect over a local socket (IpcServer) to spawn
 * agents and mirror them to their native terminals; the renderer shows them all
 * in one window with a sidebar + switcher.
 */
let mainWindow: BrowserWindow | null = null;
let ipcServer: IpcServer | null = null;
let sessionManager: SessionManager | null = null;
let notifications: NotificationCenter | null = null;
let auditStore: AuditStore | null = null;

/** Keys (`${sessionId}:${permissionId}`) of every still-pending permission. */
const pendingKeys = new Set<string>();

// A stable app identity so OS notifications are attributed to AgentWatch (not
// "Electron") and Windows can group/toast correctly.
app.setName("AgentWatch");
if (process.platform === "win32") app.setAppUserModelId("com.agentwatch.app");

/** Reflect the pending count on the dock/taskbar badge; clear flash when empty. */
function updateAttentionBadge(): void {
  try {
    app.setBadgeCount(pendingKeys.size);
  } catch {
    /* unsupported platform */
  }
  if (pendingKeys.size === 0 && mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.flashFrame(false);
  }
}

/** Never-miss fallback: bounce the dock (macOS) and flash the window/taskbar. */
function flashAttention(): void {
  try {
    app.dock?.bounce("critical");
  } catch {
    /* macOS only */
  }
  if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isFocused()) {
    mainWindow.flashFrame(true);
  }
}

// Single instance: only one primary may own the socket + window. A second
// `agentwatch …` boots Electron, which quits here and lets the relay connect to
// the already-running primary instead.
if (!app.requestSingleInstanceLock()) {
  app.quit();
}

function sendToRenderer(channel: string, payload: unknown): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

/** Render a persisted session timeline as a readable Markdown report (Phase 5). */
function renderSessionMarkdown(detail: HistoryDetail): string {
  const s = detail.session;
  const lines: string[] = [];
  const when = (ts: number): string => new Date(ts).toLocaleString();
  if (s) {
    lines.push(`# AgentWatch session — ${s.commandLine}`, "");
    lines.push(`- **Profile:** ${s.profile}`);
    lines.push(`- **PID:** ${s.pid}`);
    lines.push(`- **Started:** ${when(s.startedAt)}`);
    lines.push(
      `- **Ended:** ${s.endedAt ? `${when(s.endedAt)} (exit ${s.exitCode ?? 0})` : "still running"}`,
    );
    lines.push(`- **Events:** ${s.eventCount} · **Verdicts:** ${s.verdictCount}`, "");
  }
  if (detail.verdicts.length > 0) {
    lines.push("## Verdicts", "");
    for (const v of detail.verdicts) {
      lines.push(`- \`${when(v.decidedAt)}\` **${v.label}** — ${v.title}`);
    }
    lines.push("");
  }
  lines.push("## Event timeline", "");
  if (detail.events.length === 0) {
    lines.push("_No recorded events._");
  } else {
    for (const e of detail.events) {
      const detailText = e.detail ? ` — ${e.detail}` : "";
      lines.push(`- \`${when(e.ts)}\` **${e.title}**${detailText}`);
    }
  }
  lines.push("");
  return lines.join("\n");
}

/** Bring the window forward and switch the renderer to a given session. */
function focusSession(sessionId: string): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.moveTop();
    mainWindow.focus();
    // On macOS, pull the whole app to the foreground (the click came from a
    // notification, which does not steal focus on its own).
    try {
      app.focus({ steal: true });
    } catch {
      /* non-macOS */
    }
    mainWindow.flashFrame(false);
    sendToRenderer(IPC.sessionFocus, sessionId);
  }
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1240,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    show: false,
    backgroundColor: "#1F1E1D",
    title: "AgentWatch",
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow = win;

  win.on("ready-to-show", () => win.show());
  win.on("closed", () => {
    if (mainWindow === win) mainWindow = null;
  });

  win.webContents.setWindowOpenHandler((details) => {
    void shell.openExternal(details.url);
    return { action: "deny" };
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void win.loadFile(join(__dirname, "../renderer/index.html"));
  }
}

app.whenReady().then(() => {
  // The sink fans every session signal out to BOTH the renderer (GUI mirror)
  // and the relay sockets (native terminals).
  const sink: SessionSink = {
    onData: (id, chunk) => {
      sendToRenderer(IPC.sessionData, { id, chunk });
      ipcServer?.sendOutput(id, chunk);
    },
    onState: (id, state) => sendToRenderer(IPC.sessionState, { id, state }),
    onEvent: (id, event) => sendToRenderer(IPC.sessionEvent, { id, event }),
    onSize: (id, cols, rows) =>
      sendToRenderer(IPC.sessionSize, { id, cols, rows }),
    onExit: (id, info) => {
      sendToRenderer(IPC.sessionExit, { id, info });
      ipcServer?.sendExit(id, info);
    },
    onListChanged: () =>
      sendToRenderer(IPC.sessionsList, sessionManager?.list() ?? []),
    onPermissionPending: (id, permission) => {
      sendToRenderer(IPC.permissionPending, { id, permission });
      pendingKeys.add(`${id}:${permission.id}`);
      notifications?.notify(id, permission);
      updateAttentionBadge();
    },
    onPermissionResolved: (id, permissionId) => {
      sendToRenderer(IPC.permissionResolved, { id, permissionId });
      pendingKeys.delete(`${id}:${permissionId}`);
      notifications?.resolve(id, permissionId);
      updateAttentionBadge();
    },
    onPermissionResponded: (id, responded) => {
      sendToRenderer(IPC.permissionResponded, { id, responded });
      pendingKeys.delete(`${id}:${responded.id}`);
      notifications?.resolve(id, responded.id);
      updateAttentionBadge();
    },
  };

  // Phase 4: durable audit log + session history (best-effort; no-op if SQLite
  // is unavailable). Created before the manager so every session is recorded.
  auditStore = createAuditStore(app.getPath("userData"));

  sessionManager = new SessionManager(sink, auditStore);
  ipcServer = new IpcServer(sessionManager);
  ipcServer.listen();

  notifications = new NotificationCenter(
    {
      focus: (sessionId) => focusSession(sessionId),
      respond: (sessionId, permissionId, action) =>
        sessionManager?.respond(sessionId, permissionId, action),
      label: (sessionId) =>
        sessionManager?.list().find((s) => s.id === sessionId)?.commandLine ??
        "agent",
      flashAttention: () => flashAttention(),
    },
    sessionManager.getSettings(),
  );

  // ---- Renderer IPC (architecture §11). All traffic crosses the preload bridge.
  ipcMain.handle(IPC.sessionsGet, () => sessionManager?.list() ?? []);
  ipcMain.on(IPC.sessionInput, (_e, m: SessionInputMsg) =>
    sessionManager?.write(m.id, m.data),
  );
  // The GUI is the "gui" viewer; its size participates in per-session negotiation.
  ipcMain.on(IPC.sessionResize, (_e, m: SessionResizeMsg) =>
    sessionManager?.setViewerSize(m.id, "gui", m.cols, m.rows),
  );
  ipcMain.on(IPC.sessionClose, (_e, id: string) => sessionManager?.kill(id));
  ipcMain.on(IPC.sessionRemove, (_e, id: string) => sessionManager?.remove(id));

  // Spawn a brand-new agent/terminal straight from the GUI (no native relay).
  ipcMain.handle(IPC.sessionSpawn, (_e, m: SessionSpawnMsg) => {
    if (!sessionManager) return null;
    const command = (m.command || "").trim();
    if (!command) return null;
    return sessionManager.create(
      {
        command,
        args: Array.isArray(m.args) ? m.args : [],
        cwd: m.cwd || app.getPath("home"),
        cols: m.cols,
        rows: m.rows,
      },
      "gui",
    );
  });

  // Permission control plane: answer a pending prompt (Allow/Deny/choice/custom).
  ipcMain.on(IPC.permissionRespond, (_e, m: PermissionRespondMsg) =>
    sessionManager?.respond(m.id, m.permissionId, m.action),
  );

  // Settings: keep main + notifications in sync with the renderer's choices.
  ipcMain.on(IPC.settingsUpdate, (_e, s: AppSettings) => {
    sessionManager?.updateSettings(s);
    notifications?.updateSettings(s);
  });

  // Phase 4: history / audit-log queries (read-only from the renderer).
  ipcMain.handle(IPC.historyQuery, (_e, limit?: number) =>
    auditStore?.recentSessions(typeof limit === "number" ? limit : undefined) ??
    [],
  );
  ipcMain.handle(IPC.historyDetail, (_e, key: string) =>
    auditStore?.sessionDetail(key) ?? {
      session: null,
      events: [],
      verdicts: [],
    },
  );
  ipcMain.handle(IPC.historyClear, () => {
    auditStore?.clear();
    return true;
  });

  // Phase 5: export one session's timeline to JSON or Markdown (replay/share).
  ipcMain.handle(
    IPC.historyExport,
    async (_e, key: string, format: "json" | "md") => {
      if (!auditStore) return { ok: false as const };
      const detail = auditStore.sessionDetail(key);
      if (!detail.session) return { ok: false as const };

      const safe =
        detail.session.commandLine.replace(/[^a-z0-9.-]+/gi, "_").slice(0, 40) ||
        "session";
      const ext = format === "md" ? "md" : "json";
      const defaultPath = join(
        app.getPath("downloads"),
        `agentwatch-${safe}-${detail.session.sessionId}.${ext}`,
      );

      const result = await dialog.showSaveDialog(mainWindow ?? undefined!, {
        title: "Export session",
        defaultPath,
        filters:
          format === "md"
            ? [{ name: "Markdown", extensions: ["md"] }]
            : [{ name: "JSON", extensions: ["json"] }],
      });
      if (result.canceled || !result.filePath) return { ok: false as const };

      const content =
        format === "md"
          ? renderSessionMarkdown(detail)
          : JSON.stringify(detail, null, 2);
      try {
        await writeFile(result.filePath, content, "utf8");
        return { ok: true as const, path: result.filePath };
      } catch (error) {
        console.error("[agentwatch] export failed:", error);
        return { ok: false as const };
      }
    },
  );

  // Debug: trigger a test notification.
  ipcMain.on(IPC.debugTestNotification, () => {
    const list = sessionManager?.list() ?? [];
    const sessionId = list[0]?.id || "test-session";
    notifications?.notify(sessionId, {
      id: "test-permission",
      ts: Date.now(),
      title: "Test Notification",
      source: "AgentWatch Debug",
      rawPrompt: "This is a test notification to verify the OS-level alert system.",
      kind: "confirm",
      allowInput: "y\n",
      denyInput: "n\n",
    });
  });

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// If a second instance starts anyway, just focus our window.
app.on("second-instance", () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

function shutdown(): void {
  notifications?.clearAll();
  sessionManager?.killAll();
  ipcServer?.close();
  auditStore?.close();
  auditStore = null;
}

app.on("before-quit", shutdown);
app.on("window-all-closed", () => {
  shutdown();
  if (process.platform !== "darwin") app.quit();
});
