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

// The notification self-test runs in full isolation (its own userData dir, no
// socket server) so it can never disturb a real running primary.
if (process.env.AGENTWATCH_SELFTEST === "1") {
  try {
    const os = require("node:os");
    const p = require("node:path").join(
      os.tmpdir(),
      `agentwatch-selftest-${process.pid}`,
    );
    app.setPath("userData", p);
  } catch {
    /* fall back to default userData */
  }
}

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
    return;
  }
  // --nodashboard mode: there is no window. Bring the app's space forward so the
  // user can return to their native terminal where the agent is running.
  try {
    app.focus({ steal: true });
  } catch {
    /* best-effort */
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
    // The GUI is gone; let native terminals drive PTY size again.
    sessionManager?.setSizeAuthority(null);
  });

  // While the dashboard is focused it OWNS the PTY size, so agents use the full
  // GUI width even when a small native terminal is also mirroring them. When the
  // GUI loses focus, native terminals take the size back (MIN negotiation).
  win.on("focus", () => sessionManager?.setSizeAuthority("gui"));
  win.on("blur", () => sessionManager?.setSizeAuthority(null));

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

/** Create the window if needed, then bring it to the front. Used on demand. */
function ensureWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

/**
 * Drive the real NotificationCenter through permission / dedupe / grouping /
 * completion and print PASS/FAIL lines the notif-test script greps for. Quits
 * when done. Honest about environments where the OS suppresses toasts.
 */
function runNotificationSelfTest(): void {
  const results: Array<{ name: string; ok: boolean; detail?: string }> = [];
  const check = (name: string, ok: boolean, detail?: string): void => {
    results.push({ name, ok, detail });
  };

  let supported = false;
  try {
    const { Notification } = require("electron");
    supported = Notification.isSupported();
  } catch {
    supported = false;
  }

  const center = notifications!;
  const mkPerm = (id: string): import("../shared/types").PendingPermission => ({
    id,
    ts: Date.now(),
    title: "Write permission needed",
    source: "selftest",
    rawPrompt: "Apply this change?",
    kind: "confirm",
    allowInput: "y\n",
    denyInput: "n\n",
  });

  const r1 = center.notify("s-test", mkPerm("p1"));
  const r2 = center.notify("s-test", mkPerm("p1")); // same → must dedupe
  const r3 = center.notify("s-test", mkPerm("p2")); // different → independent
  const c1 = center.notifyCompleted("s-test", {
    commandLine: "gemini",
    exitCode: 0,
  });

  if (supported) {
    check("permission toast raised", r1 === "raised", `got ${r1}`);
    check("duplicate permission deduped", r2 === "deduped", `got ${r2}`);
    check("distinct permission raised", r3 === "raised", `got ${r3}`);
    check("completion toast raised", c1 === "raised", `got ${c1}`);
    center.resolve("s-test", "p1");
    center.resolve("s-test", "p2");
    check("resolve() closes without throwing", true);
  } else {
    // No toast backend (headless CI). The dedupe map is only populated when a
    // toast actually shows, so we can only assert the API is callable + honest.
    check(
      "notifications callable; OS backend unavailable (honest skip)",
      r1 === "unsupported" && c1 === "unsupported",
      `perm=${r1} complete=${c1}`,
    );
  }

  // Settings gate: disabling notifications suppresses everything.
  center.updateSettings({
    notifications: false,
    notifyOnComplete: true,
    sound: false,
    allowInput: "",
    denyInput: "",
  });
  const disabled = center.notify("s-test", mkPerm("p3"));
  check("disabled in settings → suppressed", disabled === "disabled", `got ${disabled}`);

  const failed = results.filter((r) => !r.ok);
  console.log("[selftest] notification results:");
  for (const r of results) {
    console.log(
      `[selftest] ${r.ok ? "PASS" : "FAIL"} — ${r.name}${r.detail ? ` (${r.detail})` : ""}`,
    );
  }
  console.log(
    `[selftest] SUMMARY ${results.length - failed.length}/${results.length} passed; supported=${supported}`,
  );
  center.clearAll();
  app.exit(failed.length === 0 ? 0 : 1);
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
      // A friendly "completed" toast so the user knows the agent is done even
      // when they are working elsewhere (or in --nodashboard mode).
      const commandLine =
        sessionManager?.list().find((s) => s.id === id)?.commandLine ?? "agent";
      notifications?.notifyCompleted(id, {
        commandLine,
        exitCode: info.code,
      });
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
  ipcServer = new IpcServer(sessionManager, ensureWindow);
  // The self-test must not touch the shared relay socket of a running primary.
  if (process.env.AGENTWATCH_SELFTEST !== "1") ipcServer.listen();

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

  // Notification self-test (`npm run notif-test`): exercise the real
  // NotificationCenter, print results, and quit. Runs before any window/IPC.
  if (process.env.AGENTWATCH_SELFTEST === "1") {
    runNotificationSelfTest();
    return;
  }

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

  // Debug: trigger test notifications (both families) so the user can verify
  // the whole alert path — permission prompt AND completion — at once.
  ipcMain.on(IPC.debugTestNotification, () => {
    const list = sessionManager?.list() ?? [];
    const sessionId = list[0]?.id || "test-session";
    notifications?.notify(sessionId, {
      id: `test-permission-${Date.now()}`,
      ts: Date.now(),
      title: "Write permission needed",
      source: "AgentWatch Debug",
      rawPrompt:
        "Apply this change to bin/agentwatch.js? This is a test of the OS-level alert system.",
      kind: "confirm",
      allowInput: "y\n",
      denyInput: "n\n",
    });
    // A moment later, fire a completion toast too (distinct family + grouping).
    setTimeout(() => {
      notifications?.notifyCompleted(sessionId, {
        commandLine: list[0]?.commandLine || "gemini",
        exitCode: 0,
      });
    }, 1200);
  });

  // The renderer awaits this before lifting its loading screen, so buttons are
  // never enabled while the backend (PTYs, socket, store) is still wiring up.
  ipcMain.handle(IPC.appReady, () => ({
    ready: true,
    nodashboard: process.env.AGENTWATCH_NO_DASHBOARD === "1",
    home: app.getPath("home"),
  }));

  // Native folder picker for the New Terminal dialog (choose where to launch).
  ipcMain.handle(IPC.dialogPickDirectory, async (_e, current?: string) => {
    const result = await dialog.showOpenDialog(mainWindow ?? undefined!, {
      title: "Choose working directory",
      defaultPath: current || app.getPath("home"),
      properties: ["openDirectory", "createDirectory"],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  // --nodashboard: boot headless. The relay still mirrors into the native
  // terminal and notifications still fire; the window opens on demand if a later
  // `agentwatch <cli>` (without the flag) connects, or via `activate` on macOS.
  if (process.env.AGENTWATCH_NO_DASHBOARD === "1") {
    console.log("[agentwatch] started in --nodashboard mode (no window).");
  } else {
    createWindow();
  }

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
