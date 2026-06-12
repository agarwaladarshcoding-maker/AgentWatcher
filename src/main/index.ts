import { join } from "node:path";
import { app, shell, BrowserWindow, ipcMain } from "electron";
import { readLaunchInfo, formatCommand, type LaunchInfo } from "./launch";

// The wrapped command the user asked us to watch (from the `agentwatch` launcher).
// Phase 0: we only read + log it. PTY spawning arrives in Phase 1.
const launchInfo: LaunchInfo = readLaunchInfo();

function createWindow(): void {
  const mainWindow = new BrowserWindow({
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

  mainWindow.on("ready-to-show", () => {
    mainWindow.show();
  });

  // Open external links in the user's browser, never in-app.
  mainWindow.webContents.setWindowOpenHandler((details) => {
    void shell.openExternal(details.url);
    return { action: "deny" };
  });

  // electron-vite sets ELECTRON_RENDERER_URL in dev for HMR; load the file in prod.
  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }
}

app.whenReady().then(() => {
  // Phase 0 exit criterion lives here: the window opens for `agentwatch echo hello`.
  console.log(`[agentwatch] launch command: ${formatCommand(launchInfo)}`);
  console.log(`[agentwatch] cwd: ${launchInfo.cwd}`);

  // The only IPC surface for Phase 0: let the renderer ask what we were launched
  // to watch. All main<->renderer traffic crosses through the preload bridge.
  ipcMain.handle("app:getLaunchInfo", () => launchInfo);

  createWindow();

  app.on("activate", () => {
    // macOS: re-create a window when the dock icon is clicked and none are open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// Quit when all windows are closed, except on macOS.
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
