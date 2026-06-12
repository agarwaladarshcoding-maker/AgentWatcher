import { join } from "node:path";
import { app, shell, BrowserWindow, ipcMain } from "electron";
import {
  readLaunchInfo,
  formatCommand,
  resolveCommand,
  type LaunchInfo,
} from "./launch";
import { PtyManager } from "./pty/ptyManager";
import { NativeTerminalBridge } from "./nativeBridge";
import { Interpreter } from "./interpreter/interpreter";
import { selectProfile } from "./interpreter/profiles";
import {
  IPC,
  type PtySize,
  type PtyStartResult,
  type SizeAuthority,
} from "../shared/ipc";

// The wrapped command the user asked us to watch (from the `agentwatch` launcher).
const launchInfo: LaunchInfo = readLaunchInfo();

// v1 is single-agent: one window, one PTY (architecture §1, §4.4). The model is
// window-per-agent ready, but we keep a single current set for now.
let mainWindow: BrowserWindow | null = null;
let ptyManager: PtyManager | null = null;
let nativeBridge: NativeTerminalBridge | null = null;
let interpreter: Interpreter | null = null;
let sizeAuthority: SizeAuthority = "mirror";
let started = false;

function sendToRenderer(channel: string, payload: unknown): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

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

  win.on("ready-to-show", () => win.show());

  win.on("closed", () => {
    // Closing the window ends the session — forward the kill + restore the
    // native terminal (§4.4, "One process, many mirrors").
    nativeBridge?.detach();
    ptyManager?.kill();
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

/**
 * Spawn the single PTY and tee its one raw stream to every faithful sink:
 *   1. the GUI mirror (xterm, via pty:data)
 *   2. the native terminal that launched agentwatch (NativeTerminalBridge)
 *   3. the interpreter (a strip-ANSI copy → the words)
 * One process, no double compute (§18).
 */
function startSession(requestedSize: PtySize): PtyStartResult {
  const manager = ptyManager!;
  const { command, args } = resolveCommand(launchInfo);
  const commandLine = [command, ...args].join(" ");

  // Attach the native terminal first so we can honor it as size authority.
  const bridge = new NativeTerminalBridge();
  const attached = bridge.attach({
    onInput: (data) => manager.write(data),
    onResize: (cols, rows) => {
      // Native terminal is authoritative when attached.
      if (sizeAuthority === "native") {
        manager.resize(cols, rows);
        sendToRenderer(IPC.ptySize, { cols, rows } satisfies PtySize);
      }
    },
  });
  nativeBridge = attached ? bridge : null;
  sizeAuthority = attached ? "native" : "mirror";

  // Pick the starting size from whichever surface owns it.
  const nativeSize = attached ? bridge.size : null;
  const startSize: PtySize =
    sizeAuthority === "native" && nativeSize ? nativeSize : requestedSize;

  // Interpreter consumes a tee'd copy only (§18).
  const profile = selectProfile(command);
  const interp = new Interpreter(profile, {
    onState: (state) => sendToRenderer(IPC.agentState, state),
    onEvent: (event) => sendToRenderer(IPC.feedEvent, event),
  });
  interpreter = interp;

  // Fan-out: verbatim to mirror + native terminal, copy to interpreter.
  manager.onData((chunk) => {
    sendToRenderer(IPC.ptyData, chunk); // 1) GUI mirror — synchronous, untouched
    nativeBridge?.write(chunk); //          2) native terminal — verbatim
    interp.feed(chunk); //                  3) interpreter — strips ANSI internally
  });

  manager.onExit((info) => {
    sendToRenderer(IPC.ptyExit, info);
    interp.sessionEnd(info.code, info.signal);
    nativeBridge?.detach();
    nativeBridge = null;
    console.log(`[agentwatch] session ended (code ${info.code})`);
  });

  const pid = manager.start({
    command,
    args,
    cwd: launchInfo.cwd,
    cols: startSize.cols,
    rows: startSize.rows,
  });

  interp.sessionStart(pid, commandLine);
  console.log(
    `[agentwatch] spawned pid ${pid}: ${commandLine} (profile=${profile.name}, size authority=${sizeAuthority}, native mirror=${attached})`,
  );

  return {
    pid,
    sizeAuthority,
    cols: startSize.cols,
    rows: startSize.rows,
    nativeMirror: attached,
  };
}

app.whenReady().then(() => {
  console.log(`[agentwatch] launch command: ${formatCommand(launchInfo)}`);
  console.log(`[agentwatch] cwd: ${launchInfo.cwd}`);

  // ---- IPC contract (architecture §11). All traffic crosses the preload bridge.

  ipcMain.handle(IPC.appGetLaunchInfo, () => launchInfo);

  ipcMain.handle(IPC.ptyStart, (_event, size: PtySize): PtyStartResult => {
    if (!ptyManager) ptyManager = new PtyManager();
    if (started && ptyManager.isRunning) {
      // Idempotent: a re-mounted renderer re-attaches to the live session.
      return {
        pid: ptyManager.pid ?? -1,
        sizeAuthority,
        cols: size?.cols ?? 80,
        rows: size?.rows ?? 30,
        nativeMirror: nativeBridge?.isAttached ?? false,
      };
    }
    started = true;
    return startSession({ cols: size?.cols ?? 80, rows: size?.rows ?? 30 });
  });

  // renderer -> PTY stdin (keystrokes / paste).
  ipcMain.on(IPC.ptyInput, (_event, data: string) => ptyManager?.write(data));

  // renderer view resized -> resize the PTY, but only when the mirror owns size.
  // When the native terminal is attached it is authoritative, so we ignore the
  // GUI's resize requests to avoid the two fighting over one PTY size.
  ipcMain.on(IPC.ptyResize, (_event, size: PtySize) => {
    if (sizeAuthority === "mirror") ptyManager?.resize(size.cols, size.rows);
  });

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// Make sure the child dies and the native terminal is restored with the app.
app.on("before-quit", () => {
  nativeBridge?.detach();
  ptyManager?.kill();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
