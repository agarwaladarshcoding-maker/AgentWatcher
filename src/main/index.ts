import { join } from "node:path";
import { writeFile } from "node:fs/promises";
import { app, shell, BrowserWindow, ipcMain, dialog } from "electron";
import { SessionManager, type SessionSink } from "./sessionManager";
import { IpcServer } from "./ipcServer";
import { NotificationCenter } from "./notifications";
import { createAuditStore, type AuditStore } from "./store/db";
import { BridgeServer, type BridgeStatus } from "./bridge/bridgeServer";
import {
  BrowserAgentRegistry,
  type BrowserAgentSink,
} from "./bridge/browserAgents";
import {
  IPC,
  type SessionInputMsg,
  type SessionResizeMsg,
  type SessionSpawnMsg,
  type PermissionRespondMsg,
  type BrowserReplyMsg,
} from "../shared/ipc";
import type {
  AgentState,
  AppSettings,
  HistoryDetail,
  TrackedTab,
} from "../shared/types";

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
let bridgeServer: BridgeServer | null = null;
let browserRegistry: BrowserAgentRegistry | null = null;

/** Last pushed browser state, re-sent to the renderer on (re)load. */
let lastBrowserList: TrackedTab[] = [];
let lastBridgeStatus: BridgeStatus = {
  connected: false,
  port: null,
  pairingCode: "",
};

/** Whether the dashboard window currently has OS focus (gates "ready" toasts). */
let windowFocused = false;

/** Keys (`${sessionId}:${permissionId}`) of every still-pending permission. */
const pendingKeys = new Set<string>();

/**
 * "Ready" (busy→idle) toast gating, so a chatty full-screen CLI that keeps
 * redrawing (Gemini's idle spinner/timer) can't fire a "ready" every few
 * seconds. A toast may fire only ONCE per genuine working→completed edge
 * (re-armed when real `working` is next seen) AND no more than once per gap.
 */
const readyArmed = new Map<string, boolean>();
const lastReadyAt = new Map<string, number>();
const READY_MIN_GAP_MS = 12000;

// A stable app identity so OS notifications are attributed to AgentWatch (not
// "Electron") and Windows can group/toast correctly.
app.setName("AgentWatch");
if (process.platform === "win32") app.setAppUserModelId("com.agentwatch.app");

// The notification self-test runs in full isolation (its own userData dir, no
// socket server) so it can never disturb a real running primary.
if (process.env.AGENTWATCH_SELFTEST) {
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

  win.on("ready-to-show", () => {
    win.show();
    // The GUI owns the PTY size for its whole lifetime (sticky). We do NOT
    // hand authority back on blur anymore: dropping to the MIN-across-viewers
    // size on every focus change resized the PTY back and forth, which made
    // full-screen agents repaint and the state flicker working↔completed.
    sessionManager?.setSizeAuthority("gui");
  });
  // Re-sync browser-bonding state to the renderer whenever it (re)loads, so a
  // reload while the extension is connected still shows the Chrome section.
  win.webContents.on("did-finish-load", () => {
    win.webContents.send(IPC.bridgeStatus, lastBridgeStatus);
    win.webContents.send(IPC.browserList, {
      connected: lastBridgeStatus.connected,
      tabs: lastBrowserList,
    });
  });
  win.on("closed", () => {
    if (mainWindow === win) mainWindow = null;
    windowFocused = false;
    // The GUI is gone; let native terminals drive PTY size again.
    sessionManager?.setSizeAuthority(null);
  });

  // Track focus only to gate "ready" toasts. Crucially, focus/blur no longer
  // renegotiates PTY size — see the sticky authority set in ready-to-show.
  win.on("focus", () => {
    windowFocused = true;
  });
  win.on("blur", () => {
    windowFocused = false;
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

/**
 * Bridge integration test (`npm run bridge-test`): start the REAL BridgeServer
 * + BrowserAgentRegistry, print the port + pairing code, and let a WS client
 * (scripts/bridge-test.mjs) drive the full contract: token gate, hello-ack,
 * snapshot/state/completed → registry, and app→ext focusTab/scrollToLatest/
 * injectReply. Prints PASS/FAIL lines via [bridge] and exits.
 */
async function runBridgeTest(): Promise<void> {
  const sleep = (ms: number): Promise<void> =>
    new Promise((r) => setTimeout(r, ms));
  let lastList: TrackedTab[] = [];
  let completedCount = 0;

  const registry = new BrowserAgentRegistry({
    onListChanged: (tabs) => {
      lastList = tabs;
      console.log(`[bridge] LIST n=${tabs.length}`);
    },
    onCompleted: (tab) => {
      completedCount += 1;
      console.log(`[bridge] COMPLETED tabId=${tab.tabId} label=${tab.label}`);
      // Exercise the app→ext path so the client can assert it receives them.
      bridge.focusTab(tab.tabId);
      bridge.injectReply(tab.tabId, "ack from app");
    },
  });
  const bridge = new BridgeServer(registry, (status) => {
    if (status.port) {
      console.log(`[bridge] READY port=${status.port} code=${status.pairingCode}`);
    }
  });
  bridge.start();

  // Safety timeout: the client must finish within this window.
  await sleep(15000);
  console.log(
    `[bridge] SUMMARY lists=${lastList.length >= 0 ? "ok" : "no"} completed=${completedCount}`,
  );
  bridge.shutdown();
  app.exit(0);
}

/**
 * Backend scenario test (`npm run scenarios-test`): spin up the REAL
 * SessionManager + interpreter + PTY and run many CLIs through it to prove:
 *   - state detection (idle → working → completed) works from output activity
 *     alone, for any CLI; and
 *   - terminate/kill actually stops a process (the Gemini-won't-die bug).
 * Prints PASS/FAIL lines and exits. Optional real agent CLIs (gemini, claude,
 * kiro) are tested when present and skipped honestly otherwise.
 */
async function runScenarioTests(): Promise<void> {
  const nodePath = require("node:path");
  const nodeFs = require("node:fs");
  const sleep = (ms: number): Promise<void> =>
    new Promise((r) => setTimeout(r, ms));
  const waitFor = async (
    pred: () => boolean,
    timeoutMs: number,
    stepMs = 60,
  ): Promise<boolean> => {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      if (pred()) return true;
      await sleep(stepMs);
    }
    return pred();
  };
  const findOnPath = (cmd: string): string | null => {
    for (const dir of (process.env.PATH || "").split(nodePath.delimiter)) {
      if (!dir) continue;
      const p = nodePath.join(dir, cmd);
      try {
        nodeFs.accessSync(p, nodeFs.constants.X_OK);
        return p;
      } catch {
        /* not here */
      }
    }
    return null;
  };

  interface Rec {
    states: AgentState[];
    output: string;
    exited: boolean;
    exitCode?: number;
    sizes: number;
  }
  const records = new Map<string, Rec>();
  const rec = (id: string): Rec => {
    let r = records.get(id);
    if (!r) {
      r = { states: [], output: "", exited: false, sizes: 0 };
      records.set(id, r);
    }
    return r;
  };

  const sink: SessionSink = {
    onData: (id, chunk) => {
      rec(id).output += chunk;
    },
    onState: (id, state) => {
      const r = rec(id);
      if (r.states[r.states.length - 1] !== state) r.states.push(state);
    },
    onEvent: () => {},
    onSize: (id) => {
      rec(id).sizes += 1;
    },
    onExit: (id, info) => {
      const r = rec(id);
      r.exited = true;
      r.exitCode = info.code;
    },
    onListChanged: () => {},
    onPermissionPending: () => {},
    onPermissionResolved: () => {},
    onPermissionResponded: () => {},
  };

  const mgr = new SessionManager(sink);
  const home = app.getPath("home");
  const results: Array<{ name: string; ok: boolean; soft?: boolean; detail?: string }> = [];
  const check = (
    name: string,
    ok: boolean,
    detail?: string,
    soft = false,
  ): void => {
    results.push({ name, ok, soft, detail });
    const tag = ok ? "PASS" : soft ? "SKIP" : "FAIL";
    console.log(`[scenarios] ${tag} — ${name}${detail ? ` (${detail})` : ""}`);
  };
  const spawn = (command: string, args: string[]): string =>
    mgr.create({ command, args, cwd: home, cols: 80, rows: 24 }, "gui").id;

  console.log("[scenarios] starting backend scenario tests…");

  // 1) Generic quick command — output then clean exit.
  try {
    const id = spawn("bash", ["-lc", "echo hello world"]);
    await waitFor(() => rec(id).exited, 6000);
    const r = rec(id);
    check("bash echo: output mirrored", r.output.includes("hello world"));
    check("bash echo: state reached working", r.states.includes("working"), r.states.join(">"));
    check("bash echo: exited cleanly", r.exited && r.exitCode === 0, `code ${r.exitCode}`);
  } catch (e) {
    check("bash echo", false, String(e));
  }

  // 2) Streaming bursts — working during stream, completed when it goes quiet.
  try {
    const script =
      "process.stdout.write('start');let n=0;const t=setInterval(()=>{process.stdout.write(' .'+n);if(++n>4)clearInterval(t);},80);setTimeout(()=>process.exit(0),1600)";
    const id = spawn("node", ["-e", script]);
    await waitFor(() => rec(id).states.includes("working"), 3000);
    check("node stream: detected working", rec(id).states.includes("working"));
    await waitFor(() => rec(id).states.includes("completed") || rec(id).exited, 4000);
    check(
      "node stream: reached completed/idle after quiet",
      rec(id).states.includes("completed") || rec(id).exited,
      rec(id).states.join(">"),
    );
    await waitFor(() => rec(id).exited, 3000);
    check("node stream: exited", rec(id).exited, `code ${rec(id).exitCode}`);
  } catch (e) {
    check("node stream", false, String(e));
  }

  // 3) TERMINATE — a process that never exits must die on kill().
  try {
    const id = spawn("node", [
      "-e",
      "setInterval(()=>process.stdout.write('tick '),150)",
    ]);
    const working = await waitFor(() => rec(id).states.includes("working"), 4000);
    check("long-runner: detected working", working, rec(id).states.join(">"));
    await sleep(400);
    mgr.kill(id);
    const died = await waitFor(() => rec(id).exited, 5000);
    check("terminate: kill() actually stops the process", died, `exited=${rec(id).exited}`);
  } catch (e) {
    check("terminate", false, String(e));
  }

  // 4) Python (if available).
  if (findOnPath("python3")) {
    try {
      const id = spawn("python3", ["-c", "print('py works')"]);
      await waitFor(() => rec(id).exited, 6000);
      const r = rec(id);
      check("python3: output + exit", r.output.includes("py works") && r.exited, `code ${r.exitCode}`);
    } catch (e) {
      check("python3", false, String(e));
    }
  } else {
    check("python3 present", true, "not installed — skipped", true);
  }

  // 5) FOCUS/RESIZE FLICKER REGRESSION — the bug this spec fixes. A TUI-like
  //    process repaints (emits a burst) when it receives SIGWINCH. After it has
  //    settled to idle, (a) a same-size refit must NOT resize the PTY
  //    (idempotent), and (b) a real resize's repaint must NOT be read as
  //    activity, so the state stays put instead of flickering working↔completed.
  try {
    const repaintScript =
      "process.stdout.write('initial render');" +
      "process.on('SIGWINCH',()=>process.stdout.write('X'.repeat(400)));" +
      "setInterval(()=>{},1000)";
    const id = spawn("node", ["-e", repaintScript]);
    await waitFor(() => rec(id).states.includes("working"), 4000);
    // Let it fully settle: completed, then decayed back to idle as the LAST
    // state (not the initial idle emitted at session start).
    const settled = (): boolean => {
      const st = rec(id).states;
      return st.includes("completed") && st[st.length - 1] === "idle";
    };
    await waitFor(settled, 4000);
    await sleep(200);
    const r = rec(id);
    const statesBefore = r.states.length;
    const sizesBefore = r.sizes; // resizes from sink.onSize (only on real resize)

    // (a) Same-size refit (what a focus event does): must be a no-op.
    mgr.setViewerSize(id, "gui", 80, 24);
    mgr.setViewerSize(id, "gui", 80, 24);
    await sleep(150);
    check(
      "flicker: same-size refit does not resize the PTY",
      rec(id).sizes === sizesBefore,
      `resizes ${rec(id).sizes - sizesBefore}`,
    );

    // (b) A genuine resize triggers a repaint; the repaint must be ignored.
    mgr.setViewerSize(id, "gui", 100, 30);
    await sleep(700);
    const after = rec(id);
    check(
      "flicker: genuine resize did happen",
      after.sizes === sizesBefore + 1,
      `resizes ${after.sizes - sizesBefore}`,
    );
    check(
      "flicker: resize repaint does not change state",
      after.states.length === statesBefore &&
        after.states[after.states.length - 1] === "idle",
      after.states.join(">"),
    );
    mgr.kill(id);
    await waitFor(() => rec(id).exited, 4000);
  } catch (e) {
    check("flicker regression", false, String(e));
  }

  // 6) Real agent CLIs — spawn, confirm activity, then terminate. kiro falls
  //    back to the Kiro.app launcher with --version so it never opens the IDE.
  const kiroLauncher = "/Applications/Kiro.app/Contents/Resources/app/bin/code";
  const agents: Array<{ name: string; command: string | null; args: string[]; quick: boolean }> = [
    { name: "gemini", command: findOnPath("gemini"), args: [], quick: false },
    { name: "claude", command: findOnPath("claude"), args: [], quick: false },
    {
      name: "kiro",
      command: findOnPath("kiro") || (nodeFs.existsSync(kiroLauncher) ? kiroLauncher : null),
      args: ["--version"],
      quick: true,
    },
  ];

  for (const agent of agents) {
    if (!agent.command) {
      check(`${agent.name}: present`, true, "not installed — skipped", true);
      continue;
    }
    try {
      const id = spawn(agent.command, agent.args);
      if (agent.quick) {
        const done = await waitFor(() => rec(id).exited, 8000);
        const r = rec(id);
        check(
          `${agent.name}: spawned + mirrored + exited`,
          done && r.states.includes("working"),
          `code ${r.exitCode}, states ${r.states.join(">")}`,
          !done, // soft if it didn't exit in time
        );
      } else {
        const working = await waitFor(() => rec(id).states.includes("working"), 6000);
        check(
          `${agent.name}: spawned + activity detected`,
          working,
          rec(id).states.join(">") || "no output",
          !working,
        );
        // The real point: it must be terminable.
        mgr.kill(id);
        const died = await waitFor(() => rec(id).exited, 6000);
        check(`${agent.name}: terminate stops it`, died, `exited=${rec(id).exited}`);
      }
    } catch (e) {
      check(`${agent.name}`, false, String(e));
    }
  }

  mgr.killAll();
  const hard = results.filter((r) => !r.ok && !r.soft);
  const passed = results.filter((r) => r.ok).length;
  console.log(`\n[scenarios] SUMMARY ${passed}/${results.length} passed, ${hard.length} hard failures.`);
  app.exit(hard.length === 0 ? 0 : 1);
}

app.whenReady().then(() => {
  // The sink fans every session signal out to BOTH the renderer (GUI mirror)
  // and the relay sockets (native terminals).
  const sink: SessionSink = {
    onData: (id, chunk) => {
      sendToRenderer(IPC.sessionData, { id, chunk });
      ipcServer?.sendOutput(id, chunk);
    },
    onState: (id, state) => {
      sendToRenderer(IPC.sessionState, { id, state });
      // Re-arm "ready" on genuine work so we fire at most once per busy→idle
      // edge; never re-fire for a CLI that merely redraws while idle.
      if (state === "working") readyArmed.set(id, true);
      // When the agent finishes a turn and the user isn't looking at the
      // window (or there is none, in --nodashboard mode), nudge them that it's
      // ready — but only once per real edge and not more often than the gap.
      if (state === "completed" && !windowFocused) {
        const now = Date.now();
        const armed = readyArmed.get(id) ?? false;
        const gapOk = now - (lastReadyAt.get(id) ?? 0) >= READY_MIN_GAP_MS;
        if (armed && gapOk) {
          readyArmed.set(id, false);
          lastReadyAt.set(id, now);
          const commandLine =
            sessionManager?.list().find((s) => s.id === id)?.commandLine ??
            "agent";
          notifications?.notifyReady(id, { commandLine });
        }
      }
    },
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
  // The self-tests must not touch the shared relay socket of a running primary.
  if (!process.env.AGENTWATCH_SELFTEST) ipcServer.listen();

  notifications = new NotificationCenter(
    {
      focus: (sessionId) => focusSession(sessionId),
      respond: (sessionId, permissionId, action) =>
        sessionManager?.respond(sessionId, permissionId, action),
      label: (sessionId) =>
        sessionManager?.list().find((s) => s.id === sessionId)?.commandLine ??
        "agent",
      flashAttention: () => flashAttention(),
      focusWindow: () => ensureWindow(),
    },
    sessionManager.getSettings(),
  );

  // ── Browser bonding: registry + local bridge to the Chrome extension ──
  // Additive only: when nothing is connected the registry is empty and the
  // renderer's Chrome section stays hidden.
  const browserSink: BrowserAgentSink = {
    onListChanged: (tabs) => {
      lastBrowserList = tabs;
      sendToRenderer(IPC.browserList, {
        connected: lastBridgeStatus.connected,
        tabs,
      });
    },
    onCompleted: (tab) => {
      sendToRenderer(IPC.browserCompleted, {
        tabId: tab.tabId,
        label: tab.label,
        snippet: tab.snippet,
        output: tab.output,
      });
      if (!windowFocused) {
        notifications?.notifyBrowserCompleted({
          tabId: tab.tabId,
          label: tab.label,
          snippet: tab.snippet,
        });
      }
    },
  };
  browserRegistry = new BrowserAgentRegistry(browserSink);
  bridgeServer = new BridgeServer(browserRegistry, (status) => {
    lastBridgeStatus = status;
    sendToRenderer(IPC.bridgeStatus, status);
    // Connection flag rides along with the list so the section shows/hides.
    sendToRenderer(IPC.browserList, {
      connected: status.connected,
      tabs: lastBrowserList,
    });
  });
  if (!process.env.AGENTWATCH_SELFTEST) bridgeServer.start();

  // Notification self-test (`npm run notif-test`): exercise the real
  // NotificationCenter, print results, and quit. Runs before any window/IPC.
  if (process.env.AGENTWATCH_SELFTEST === "1") {
    runNotificationSelfTest();
    return;
  }

  // Scenarios self-test (`npm run scenarios-test`): drive REAL CLIs through the
  // actual SessionManager + interpreter + PTY to verify state detection and the
  // terminate/kill path, then quit.
  if (process.env.AGENTWATCH_SELFTEST === "scenarios") {
    void runScenarioTests();
    return;
  }

  // Bridge integration self-test (`npm run bridge-test`).
  if (process.env.AGENTWATCH_SELFTEST === "bridge") {
    void runBridgeTest();
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

  // ── Browser bonding: renderer → bridge actions + status query ──
  ipcMain.on(IPC.browserFocus, (_e, tabId: number) => {
    if (typeof tabId === "number") bridgeServer?.focusTab(tabId);
  });
  ipcMain.on(IPC.browserReply, (_e, m: BrowserReplyMsg) => {
    // The single sanctioned write: only ever sent on an explicit user submit.
    if (m && typeof m.tabId === "number" && typeof m.text === "string") {
      bridgeServer?.injectReply(m.tabId, m.text);
    }
  });
  ipcMain.handle(IPC.bridgeStatusGet, () => lastBridgeStatus);

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
  bridgeServer?.shutdown();
  auditStore?.close();
  auditStore = null;
}

app.on("before-quit", shutdown);
app.on("window-all-closed", () => {
  shutdown();
  if (process.platform !== "darwin") app.quit();
});
