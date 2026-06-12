#!/usr/bin/env node
/**
 * AgentWatch backend scenario test — launches the REAL Electron app headless
 * and drives the actual SessionManager + interpreter + PTY across many CLIs to
 * prove the two things the user cares about:
 *
 *   1. STATE DETECTION is simple + robust: idle → working → completed, derived
 *      purely from output activity (no fragile per-CLI regexes). Verified on
 *      bash, node (streaming), python3, and any installed agent CLI.
 *   2. TERMINATE works: a never-exiting process (and the real Gemini/Claude
 *      CLIs) actually die when killed.
 *
 * It also "installs" a `kiro` command (symlinking the Kiro.app launcher) so the
 * kiro CLI is on PATH for the run, then tests it with `--version` (which prints
 * and exits without opening the IDE).
 *
 * Uses fast interpreter thresholds so the whole thing runs in a few seconds.
 * Runs isolated (own userData, no relay socket) so it won't disturb a running
 * AgentWatch. Run with:  npm run scenarios-test
 */
import { execSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, symlinkSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(import.meta.url);

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

// "Install" the kiro CLI: symlink the Kiro.app launcher into a temp bin dir we
// prepend to PATH, so the app finds `kiro` on PATH like any other CLI.
const kiroLauncher = "/Applications/Kiro.app/Contents/Resources/app/bin/code";
const shimDir = join(tmpdir(), `agentwatch-bin-${process.pid}`);
let pathPrefix = "";
try {
  if (existsSync(kiroLauncher)) {
    mkdirSync(shimDir, { recursive: true });
    const link = join(shimDir, "kiro");
    try {
      rmSync(link, { force: true });
    } catch {
      /* ignore */
    }
    symlinkSync(kiroLauncher, link);
    pathPrefix = shimDir + (process.platform === "win32" ? ";" : ":");
    console.log(`▸ Installed kiro shim → ${link}`);
  } else {
    console.log("▸ Kiro launcher not found; kiro scenario will be skipped.");
  }
} catch (e) {
  console.log(`▸ Could not install kiro shim (${e?.message ?? e}); skipping.`);
}

console.log("▸ Launching AgentWatch backend scenario test…\n");

const child = spawn(electronPath, [root], {
  cwd: root,
  env: {
    ...process.env,
    PATH: pathPrefix + (process.env.PATH || ""),
    AGENTWATCH_SELFTEST: "scenarios",
    AGENTWATCH_PRIMARY: "1",
    AGENTWATCH_NO_DASHBOARD: "1",
    // Fast state machine so the test is quick but still realistic.
    AGENTWATCH_QUIET_MS: "300",
    AGENTWATCH_IDLE_MS: "500",
    AGENTWATCH_MIN_WORK_MS: "100",
    AGENTWATCH_MIN_WORK_BYTES: "4",
    AGENTWATCH_TICK_MS: "80",
  },
  stdio: ["ignore", "pipe", "pipe"],
});

let out = "";
const onChunk = (b) => {
  const s = b.toString();
  out += s;
  for (const line of s.split("\n")) {
    if (line.includes("[scenarios]")) console.log(line.trim());
  }
};
child.stdout.on("data", onChunk);
child.stderr.on("data", onChunk);

const killTimer = setTimeout(() => {
  console.error("\n✗ Timed out waiting for the scenario test to finish.");
  try {
    child.kill("SIGKILL");
  } catch {
    /* ignore */
  }
  cleanup();
  process.exit(1);
}, 90000);

function cleanup() {
  try {
    rmSync(shimDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

child.on("exit", (code) => {
  clearTimeout(killTimer);
  cleanup();
  const hasSummary = /\[scenarios\] SUMMARY/.test(out);
  const hasHardFail = /\[scenarios\] FAIL/.test(out);

  console.log(`\n${"─".repeat(48)}`);
  if (!hasSummary) {
    console.error("✗ Scenario test did not report a summary (app failed to start?).");
    process.exit(1);
  }
  if (hasHardFail || code !== 0) {
    console.error(`✗ Backend scenario test FAILED (exit ${code}).`);
    process.exit(1);
  }
  console.log("✓ Backend scenario test passed.");
  process.exit(0);
});
