import { join } from "node:path";
import { app, shell, BrowserWindow, ipcMain } from "electron";
import {
  readLaunchInfo,
  formatCommand,
  resolveCommand,
  type LaunchInfo,
} from "./launch";
import { PtyManager } from "./pty/ptyManager";
import { IPC, type PtySize, type PtyStartResult } from "../shared/ipc";

// The wrapped command the user asked us to watch (from the `agentwatch` launcher).
const launchInfo: LaunchInfo = readLaunchInfo();

// v1 is single-agent: one window, one PTY (architecture §1, §4.4). The model is
// window-per-agent ready, but we keep a single current pair for now.
let mainWindow: BrowserWindow | null = null;
let ptyManager: PtyManager | null = null;

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 900,
    minHeight: 560,
    show: false,
    backgroundColor: "#0F1117",
    title: "AgentWatch",
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      // Security invariants (architecture doc §18 / §22):
      sandbox: false, // node-pty/better-sqlite3 live in main; preload stays thin
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow = win;

  // One PTY manager per window. Forward its verbatim output + exit straight to
  // this window's renderer. The mirror is sacred: bytes pass through untouched.
  const manager = new PtyManager();
  ptyManager = manager;

  manager.onData((chunk) => {
    if (!win.isDestroyed()) win.webContents.send(IPC.ptyData, chunk);
  });
  manager.onExit((info) => {
    if (!win.isDestroyed()) win.webContents.send(IPC.ptyExit, info);
    console.log(`[agentwatch] session ended (code ${info.code})`);
  });

  win.on("ready-to-show", () => win.show());

  // Closing the window ends the session — forward the kill to the PTY (§4.4).
  win.on("closed", () => {
    manager.kill();
    if (ptyManager === manager) ptyManager = null;
    if (mainWindow === win) mainWindow = null;
  });

  // Open external links in the user's browser, never in-app.
  win.webContents.setWindowOpenHandler((details) => {
    void shell.openExternal(details.url);
    return { action: "deny" };
  });

  // electron-vite sets ELECTRON_RENDERER_URL in dev for HMR; load the file in prod.
  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void win.loadFile(join(__dirname, "../renderer/index.html"));
  }
}

app.whenReady().then(() => {
  console.log(`[agentwatch] launch command: ${formatCommand(launchInfo)}`);
  console.log(`[agentwatch] cwd: ${launchInfo.cwd}`);

  // ---- IPC contract (architecture §11). All traffic crosses the preload bridge.

  // renderer asks what we were launched to watch.
  ipcMain.handle(IPC.appGetLaunchInfo, () => launchInfo);

  // renderer requests the PTY spawn once xterm has mounted + fitted, passing the
  // initial size so line-wrapping is correct from the very first byte.
  ipcMain.handle(IPC.ptyStart, (_event, size: PtySize): PtyStartResult => {
    if (!ptyManager) return { pid: -1 };
    const { command, args } = resolveCommand(launchInfo);
    const pid = ptyManager.start({
      command,
      args,
      cwd: launchInfo.cwd,
      cols: size?.cols ?? 80,
      rows: size?.rows ?? 30,
    });
    console.log(`[agentwatch] spawned pid ${pid}: ${command} ${args.join(" ")}`.trim());
    return { pid };
  });

  // renderer -> PTY stdin (keystrokes / paste).
  ipcMain.on(IPC.ptyInput, (_event, data: string) => ptyManager?.write(data));

  // renderer view resized -> resize the PTY.
  ipcMain.on(IPC.ptyResize, (_event, size: PtySize) =>
    ptyManager?.resize(size.cols, size.rows),
  );

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// Make sure the child dies with the app.
app.on("before-quit", () => ptyManager?.kill());

// Quit when all windows are closed, except on macOS.
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
