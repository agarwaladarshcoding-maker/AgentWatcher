#!/usr/bin/env node
/**
 * AgentWatch notification test — launches the REAL Electron app in an isolated,
 * headless self-test mode (AGENTWATCH_SELFTEST=1) and drives the actual
 * NotificationCenter through:
 *
 *   • a permission toast is raised
 *   • a duplicate of the same prompt is DEDUPED (no second toast)
 *   • a distinct prompt is raised independently
 *   • a completion ("✓ finished") toast is raised
 *   • resolve() closes a toast without throwing
 *   • disabling notifications in settings suppresses everything
 *
 * The app prints `[selftest] PASS/FAIL …` lines; this script asserts them. It
 * runs in its own userData dir and never binds the relay socket, so it can run
 * even while a real AgentWatch primary is open. Honest on headless CI where the
 * OS has no notification backend (it verifies the API is callable instead).
 *
 * Run with:  npm run notif-test
 */
import { execSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(import.meta.url);

// Ensure there is something to launch.
if (!existsSync(join(root, "out", "main", "index.js"))) {
  console.log("▸ Building first (no out/main/index.js found)…");
  execSync("npm run build", { cwd: root, stdio: "inherit" });
}

let electronPath;
try {
  electronPath = require("electron");
} catch {
  console.error("✗ Could not resolve the 'electron' module. Run `npm install`.");
  process.exit(1);
}

console.log("▸ Launching AgentWatch in notification self-test mode…\n");

const child = spawn(electronPath, [root], {
  cwd: root,
  env: {
    ...process.env,
    AGENTWATCH_SELFTEST: "1",
    AGENTWATCH_PRIMARY: "1",
    AGENTWATCH_NO_DASHBOARD: "1",
  },
  stdio: ["ignore", "pipe", "pipe"],
});

let out = "";
const onChunk = (b) => {
  const s = b.toString();
  out += s;
  // Surface the test's own lines live; ignore Electron/GPU chatter.
  for (const line of s.split("\n")) {
    if (line.includes("[selftest]")) console.log(line.trim());
  }
};
child.stdout.on("data", onChunk);
child.stderr.on("data", onChunk);

// Don't hang forever if the app fails to quit.
const killTimer = setTimeout(() => {
  console.error("\n✗ Timed out waiting for the self-test to finish.");
  try {
    child.kill("SIGKILL");
  } catch {
    /* ignore */
  }
  process.exit(1);
}, 30000);

child.on("exit", (code) => {
  clearTimeout(killTimer);
  const hasSummary = /\[selftest\] SUMMARY/.test(out);
  const hasFail = /\[selftest\] FAIL/.test(out);

  console.log(`\n${"─".repeat(48)}`);
  if (!hasSummary) {
    console.error(
      "✗ Self-test did not report a summary (the app may have failed to start).",
    );
    process.exit(1);
  }
  if (hasFail || code !== 0) {
    console.error(`✗ Notification self-test FAILED (exit ${code}).`);
    process.exit(1);
  }
  console.log("✓ Notification self-test passed.");
  process.exit(0);
});
