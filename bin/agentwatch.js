#!/usr/bin/env node
/* eslint-disable no-console */
"use strict";

/**
 * AgentWatch CLI launcher — a thin RELAY.
 *
 * Usage:  agentwatch <command> [args...]
 *   e.g.  agentwatch gemini
 *         agentwatch ollama run llama3
 *
 * Model (architecture doc §4.4 + "One process, many mirrors" §18, multi-agent):
 *   A single primary AgentWatch app owns the window and ALL PTYs. Each
 *   `agentwatch <cli>` invocation does NOT open its own window — it connects to
 *   the primary over a local socket, asks it to spawn the agent, and then acts
 *   as a byte relay between THIS terminal and that PTY:
 *
 *       this terminal stdin  ──INPUT──▶  primary ──▶ PTY stdin
 *       PTY output  ──OUTPUT──▶  primary  ──▶  this terminal stdout
 *
 *   So the agent shows in BOTH this native terminal and the GUI mirror, every
 *   terminal keeps its own native passthrough, and they all share one window
 *   with a sidebar + switcher. One agent spawn = no double compute.
 *
 *   If no primary is running yet, the first invocation boots Electron (detached,
 *   so it outlives this terminal) and then connects.
 */

const net = require("node:net");
const path = require("node:path");
const fs = require("node:fs");
const { spawn } = require("node:child_process");
const {
  FrameType,
  encode,
  encodeJson,
  FrameDecoder,
  socketPath,
} = require("./protocol.js");

function fail(message) {
  console.error(`agentwatch: ${message}`);
  process.exit(1);
}

const wrapped = process.argv.slice(2);
if (wrapped.length === 0 || wrapped[0] === "-h" || wrapped[0] === "--help") {
  console.log(
    [
      "AgentWatch — mirror any CLI agent and layer the words on top.",
      "",
      "Usage:",
      "  agentwatch <command> [args...]",
      "",
      "Examples:",
      "  agentwatch echo hello",
      "  agentwatch gemini",
      "  agentwatch ollama run llama3",
    ].join("\n"),
  );
  process.exit(wrapped.length === 0 ? 1 : 0);
}

const [command, ...args] = wrapped;
const SOCKET = socketPath();
const appRoot = path.resolve(__dirname, "..");

function currentSize() {
  return {
    cols: process.stdout.columns || 80,
    rows: process.stdout.rows || 30,
  };
}

/** Boot the primary Electron app (detached) so it survives after this relay. */
function spawnPrimary() {
  let electronPath;
  try {
    electronPath = require("electron");
  } catch {
    fail(
      "could not find the 'electron' module. Run `npm install` in the AgentWatch project first.",
    );
  }
  const mainEntry = path.join(appRoot, "out", "main", "index.js");
  if (!fs.existsSync(mainEntry)) {
    fail(
      `build output not found at ${mainEntry}.\n` +
        "  Build it first with `npm run build`, or run `npm run dev` (which also starts the app).",
    );
  }
  const child = spawn(electronPath, [appRoot], {
    detached: true,
    stdio: "ignore",
    env: { ...process.env, AGENTWATCH_PRIMARY: "1" },
  });
  child.unref();
}

/** Try to connect; if refused/missing, boot the primary and retry for a while. */
function connectWithRetry(attempt, booted, onConnect) {
  const sock = net.connect(SOCKET);

  sock.on("connect", () => onConnect(sock));

  sock.on("error", (err) => {
    sock.destroy();
    const recoverable = err.code === "ENOENT" || err.code === "ECONNREFUSED";
    if (!recoverable) return fail(`socket error: ${err.message}`);

    if (!booted) {
      // Stale socket file from a crashed app? remove it before booting.
      if (err.code === "ECONNREFUSED" && process.platform !== "win32") {
        try {
          fs.unlinkSync(SOCKET);
        } catch {
          /* ignore */
        }
      }
      spawnPrimary();
    }
    if (attempt >= 100) {
      return fail("timed out waiting for the AgentWatch app to start.");
    }
    setTimeout(() => connectWithRetry(attempt + 1, true, onConnect), 100);
  });
}

function startRelay(sock) {
  const stdin = process.stdin;
  const isTty = Boolean(stdin.isTTY);

  // Ask the primary to spawn the agent at our terminal's size.
  const size = currentSize();
  sock.write(
    encodeJson(FrameType.CREATE, {
      command,
      args,
      cwd: process.cwd(),
      cols: size.cols,
      rows: size.rows,
    }),
  );

  // Raw mode so every keystroke (incl. Ctrl-C as \x03) goes to the PTY, not the
  // local shell's line discipline.
  if (isTty && stdin.setRawMode) stdin.setRawMode(true);
  stdin.resume();

  const cleanup = (code) => {
    try {
      if (isTty && stdin.setRawMode) stdin.setRawMode(false);
    } catch {
      /* ignore */
    }
    stdin.pause();
    try {
      sock.destroy();
    } catch {
      /* ignore */
    }
    process.exit(code == null ? 0 : code);
  };

  // local terminal -> PTY
  stdin.on("data", (chunk) => sock.write(encode(FrameType.INPUT, chunk)));

  // terminal resized -> tell the primary (this relay is the native size source)
  process.stdout.on("resize", () => {
    const s = currentSize();
    sock.write(encodeJson(FrameType.RESIZE, s));
  });

  // PTY output / lifecycle <- primary
  const decoder = new FrameDecoder((type, payload) => {
    if (type === FrameType.OUTPUT) {
      process.stdout.write(payload);
    } else if (type === FrameType.EXIT) {
      let code = 0;
      try {
        code = JSON.parse(payload.toString("utf8")).code || 0;
      } catch {
        /* ignore */
      }
      cleanup(code);
    }
    // READY is informational; ignore in the relay.
  });
  sock.on("data", (chunk) => decoder.push(chunk));

  sock.on("close", () => cleanup(0));
  sock.on("error", () => cleanup(1));

  process.on("SIGINT", () => sock.write(encode(FrameType.INPUT, Buffer.from([0x03]))));
  process.on("SIGTERM", () => cleanup(0));
}

connectWithRetry(0, false, startRelay);
