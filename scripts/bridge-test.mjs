#!/usr/bin/env node
/**
 * AgentWatch bridge integration test — launches the REAL Electron app in
 * `AGENTWATCH_SELFTEST=bridge` mode (which starts the actual BridgeServer +
 * BrowserAgentRegistry) and drives the full bridge contract from a WebSocket
 * client, exactly as the Chrome extension would:
 *
 *   1. token gate     — a hello with the wrong code is denied;
 *   2. handshake      — a hello with the right code gets a hello-ack;
 *   3. ext → app      — bridge:agents / agent:state / agent:completed update
 *                       the registry (the app logs LIST / COMPLETED);
 *   4. app → ext      — on completion the app sends focusTab + scrollToLatest
 *                       (+ injectReply in test mode) back to the client.
 *
 * Run with:  npm run bridge-test
 */
import { execSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(import.meta.url);

if (!existsSync(join(root, "out", "main", "index.js"))) {
  console.log("▸ Building first (no out/main/index.js found)…");
  execSync("npm run build", { cwd: root, stdio: "inherit" });
}

let electronPath;
let WebSocket;
try {
  electronPath = require("electron");
  WebSocket = require("ws");
} catch {
  console.error("✗ Could not resolve 'electron' or 'ws'. Run `npm install`.");
  process.exit(1);
}

console.log("▸ Launching AgentWatch bridge integration test…\n");

const child = spawn(electronPath, [root], {
  cwd: root,
  env: { ...process.env, AGENTWATCH_SELFTEST: "bridge", AGENTWATCH_PRIMARY: "1" },
  stdio: ["ignore", "pipe", "pipe"],
});

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok });
  console.log(`[bridge-test] ${ok ? "PASS" : "FAIL"} — ${name}${detail ? ` (${detail})` : ""}`);
};

let appOut = "";
let started = false;
let appSawList = false;
let appSawCompleted = false;

const ORIGIN = "chrome-extension://agentwatchtestextensionid";
const fail = (msg) => {
  console.error(`\n✗ ${msg}`);
  finish(1);
};

let finished = false;
function finish(code) {
  if (finished) return;
  finished = true;
  try {
    child.kill("SIGKILL");
  } catch {
    /* ignore */
  }
  const hard = results.filter((r) => !r.ok);
  console.log(`\n${"─".repeat(48)}`);
  if (code === 0 && hard.length === 0) {
    console.log(`✓ Bridge integration test passed (${results.length} checks).`);
    process.exit(0);
  }
  console.error(`✗ Bridge integration test FAILED (${hard.length} failures).`);
  process.exit(1);
}

const killTimer = setTimeout(() => fail("Timed out waiting for the bridge test."), 30000);

child.stdout.on("data", (b) => onApp(b.toString()));
child.stderr.on("data", (b) => onApp(b.toString()));

function onApp(s) {
  appOut += s;
  for (const line of s.split("\n")) {
    if (line.includes("[bridge] LIST")) appSawList = true;
    if (line.includes("[bridge] COMPLETED")) appSawCompleted = true;
    const m = line.match(/\[bridge\] READY port=(\d+) code=(\w+)/);
    if (m && !started) {
      started = true;
      runClient(Number(m[1]), m[2]);
    }
  }
}

function connect(port, headers) {
  return new WebSocket(`ws://127.0.0.1:${port}`, { headers: { Origin: ORIGIN, ...headers } });
}

async function runClient(port, token) {
  // ── Test 1: wrong token is denied. ──
  await new Promise((resolve) => {
    const ws = connect(port);
    let denied = false;
    ws.on("open", () =>
      ws.send(JSON.stringify({ type: "bridge:hello", version: "1", adapters: ["claude"], token: "wrong" })),
    );
    ws.on("message", (d) => {
      const msg = JSON.parse(d.toString());
      if (msg.type === "bridge:denied") denied = true;
      if (msg.type === "bridge:hello-ack") denied = false;
    });
    ws.on("close", () => {
      check("wrong pairing code is rejected", denied);
      resolve();
    });
    setTimeout(() => {
      try {
        ws.close();
      } catch {
        /* ignore */
      }
    }, 1500);
  });

  // ── Test 2: correct token handshake + full message flow. ──
  const ws = connect(port);
  let gotAck = false;
  let gotFocus = false;
  let gotScroll = false;
  let gotInject = false;

  ws.on("open", () =>
    ws.send(JSON.stringify({ type: "bridge:hello", version: "1", adapters: ["claude"], token })),
  );
  ws.on("message", (d) => {
    const msg = JSON.parse(d.toString());
    if (msg.type === "bridge:hello-ack") {
      gotAck = true;
      // Drive the registry: snapshot → state → completion.
      ws.send(
        JSON.stringify({
          type: "bridge:agents",
          agents: [
            { tabId: 7, adapterId: "claude", label: "Claude", state: "working", lastChange: Date.now() },
          ],
        }),
      );
      ws.send(JSON.stringify({ type: "agent:state", tabId: 7, state: "working" }));
      setTimeout(
        () =>
          ws.send(
            JSON.stringify({
              type: "agent:completed",
              tabId: 7,
              label: "Claude",
              snippet: "here is the answer",
            }),
          ),
        300,
      );
    }
    if (msg.type === "focusTab" && msg.tabId === 7) gotFocus = true;
    if (msg.type === "scrollToLatest" && msg.tabId === 7) gotScroll = true;
    if (msg.type === "injectReply" && msg.tabId === 7) gotInject = true;
  });

  // Give the round-trip time to complete, then assert.
  setTimeout(() => {
    check("correct pairing code → hello-ack", gotAck);
    check("app received snapshot (LIST)", appSawList);
    check("app received completion (COMPLETED)", appSawCompleted);
    check("app → ext focusTab on completion", gotFocus);
    check("app → ext scrollToLatest on completion", gotScroll);
    check("app → ext injectReply round-trips", gotInject);
    clearTimeout(killTimer);
    try {
      ws.close();
    } catch {
      /* ignore */
    }
    finish(0);
  }, 3000);

  ws.on("error", (e) => fail(`client ws error: ${e?.message ?? e}`));
}

child.on("exit", (code) => {
  if (!finished) {
    clearTimeout(killTimer);
    if (!started) fail(`app exited before bridge was ready (code ${code})`);
  }
});
