import { join } from "node:path";
import { app, shell, BrowserWindow, ipcMain } from "electron";
import { SessionManager, type SessionSink } from "./sessionManager";
import { IpcServer } from "./ipcServer";
import { Store } from "./store/db";
import { Settings } from "./settings";
import {
  IPC,
  type SessionInputMsg,
  type SessionResizeMsg,
  type SessionRespondMsg,
  type SessionRenameMsg,
  type HistoryFilter,
  type AppSettings,
} from "../shared/ipc";

/**
 * Electron main: the single PRIMARY that owns the window and every PTY. Relay
 * launchers (bin/agentwatch.js) connect over a local socket (IpcServer) to spawn
 * agents and mirror them to their native terminals; the renderer shows them all
 * in one window with a sidebar + switcher.
 */
let mainWindow: BrowserWindow | null = null;
let ipcServer: IpcServer | null = null;
let sessionManager: SessionManager | null = null;
const store = new Store();
const settings = new Settings();

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

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1240,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    show: false,
    backgroundColor: "#0F1117",
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
  store.init();
  settings.init();
  const initial = settings.get();

  // The sink fans every session signal out to BOTH the renderer (GUI mirror)
  // and the relay sockets (native terminals), and persists to the audit log.
  const sink: SessionSink = {
    onStart: (info) => store.startSession(info),
    onData: (id, chunk) => {
      sendToRenderer(IPC.sessionData, { id, chunk });
      ipcServer?.sendOutput(id, chunk);
    },
    onState: (id, state) => sendToRenderer(IPC.sessionState, { id, state }),
    onEvent: (id, event) => {
      sendToRenderer(IPC.sessionEvent, { id, event });
      store.addEvent(id, event);
    },
    onSize: (id, cols, rows) =>
      sendToRenderer(IPC.sessionSize, { id, cols, rows }),
    onExit: (id, info) => {
      sendToRenderer(IPC.sessionExit, { id, info });
      ipcServer?.sendExit(id, info);
      store.endSession(id, info.code);
    },
    onPermission: (id, permission) =>
      sendToRenderer(IPC.sessionPermission, { id, permission }),
    onVerdict: (id, verdict) => {
      sendToRenderer(IPC.sessionVerdict, { id, verdict });
      store.addVerdict(
        id,
        verdict.permissionId,
        verdict.rawPrompt ?? "",
        verdict.decision,
        verdict.ts,
      );
    },
    onListChanged: () =>
      sendToRenderer(IPC.sessionsList, sessionManager?.list() ?? []),
  };

  sessionManager = new SessionManager(sink);
  sessionManager.setDefaultResponses(initial.defaultAllow, initial.defaultDeny);
  ipcServer = new IpcServer(sessionManager);
  ipcServer.listen();

  // ---- Renderer IPC (architecture §11). All traffic crosses the preload bridge.
  ipcMain.handle(IPC.sessionsGet, () => sessionManager?.list() ?? []);
  ipcMain.on(IPC.sessionInput, (_e, m: SessionInputMsg) =>
    sessionManager?.write(m.id, m.data),
  );
  ipcMain.on(IPC.sessionResize, (_e, m: SessionResizeMsg) =>
    sessionManager?.setViewerSize(m.id, "gui", m.cols, m.rows),
  );
  ipcMain.on(IPC.sessionClose, (_e, id: string) => sessionManager?.kill(id));
  ipcMain.on(IPC.sessionRespond, (_e, m: SessionRespondMsg) =>
    sessionManager?.respond(m.id, m.permissionId, m.decision),
  );
  ipcMain.on(IPC.sessionRename, (_e, m: SessionRenameMsg) =>
    sessionManager?.rename(m.id, m.name),
  );
  ipcMain.handle(IPC.historyQuery, (_e, filter: HistoryFilter) =>
    store.queryHistory(filter ?? {}),
  );
  ipcMain.handle(IPC.settingsGet, () => settings.get());
  ipcMain.handle(IPC.settingsSet, (_e, patch: Partial<AppSettings>) => {
    const next = settings.set(patch);
    sessionManager?.setDefaultResponses(next.defaultAllow, next.defaultDeny);
    return next;
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
  sessionManager?.killAll();
  ipcServer?.close();
  store.close();
}

app.on("before-quit", shutdown);
app.on("window-all-closed", () => {
  shutdown();
  if (process.platform !== "darwin") app.quit();
});
