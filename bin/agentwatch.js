#!/usr/bin/env node
/* eslint-disable no-console */
"use strict";

/**
 * AgentWatch CLI launcher.
 *
 * Usage:  agentwatch <command> [args...]
 *   e.g.  agentwatch gemini
 *         agentwatch echo hello
 *
 * Phase 0 responsibility (per the architecture doc §13):
 *   - Collect argv (the wrapped command + its args).
 *   - Boot the Electron app, handing the wrapped command to the main process
 *     via the AGENTWATCH_ARGV environment variable (JSON).
 *
 * It does NOT spawn a PTY yet — that arrives in Phase 1. For now the main
 * process simply logs the command it was asked to wrap and opens the window.
 */

const { spawn } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");

function fail(message) {
  console.error(`agentwatch: ${message}`);
  process.exit(1);
}

// argv[0]=node, argv[1]=this script, argv[2..]=wrapped command + args
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
      "  agentwatch echo hello     # Phase 0 smoke test (opens the window)",
      "  agentwatch gemini         # wrap an interactive agent (Phase 1+)",
    ].join("\n"),
  );
  process.exit(wrapped.length === 0 ? 1 : 0);
}

// The app root is the package root (one level up from bin/).
const appRoot = path.resolve(__dirname, "..");

// Resolve the Electron executable from this package's own dependencies.
let electronPath;
try {
  // `electron` exports the absolute path to its prebuilt binary.
  electronPath = require("electron");
} catch {
  fail(
    "could not find the 'electron' module. Run `npm install` in the AgentWatch project first.",
  );
}

if (typeof electronPath !== "string") {
  fail("the 'electron' module did not resolve to an executable path.");
}

// Make sure the app has been built (main entry exists). In dev, use `npm run dev`.
const mainEntry = path.join(appRoot, "out", "main", "index.js");
if (!fs.existsSync(mainEntry)) {
  fail(
    `build output not found at ${mainEntry}.\n` +
      "  Build it first with `npm run build`, or use `npm run dev` for hot-reload development.",
  );
}

const [command, ...args] = wrapped;

const child = spawn(electronPath, [appRoot], {
  stdio: "inherit",
  env: {
    ...process.env,
    // Hand the wrapped command to the main process. Kept as structured JSON
    // so commands/args with spaces survive intact.
    AGENTWATCH_ARGV: JSON.stringify({ command, args, cwd: process.cwd() }),
  },
});

child.on("close", (code) => process.exit(code == null ? 0 : code));
child.on("error", (err) => fail(`failed to launch Electron: ${err.message}`));
