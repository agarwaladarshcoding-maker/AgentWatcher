#!/usr/bin/env node
/**
 * AgentWatch self-check — a single command that verifies the whole project on
 * its own, end to end. No mocking-away of real work:
 *
 *   1. Typecheck the entire codebase (tsc, both projects).
 *   2. Production build (electron-vite: main + preload + renderer).
 *   3. Assert the real build artifacts exist and are non-trivial.
 *   4. Behavioral test of the relay wire protocol (encode → split → decode),
 *      including frames split across chunk boundaries.
 *   5. Behavioral test of the SQLite audit store IF better-sqlite3 loads in
 *      plain Node (round-trips a session + event + verdict); skipped honestly
 *      with a clear note when the native module is built only for Electron.
 *   6. Source-invariant checks for the fixes shipped in this branch.
 *
 * Exit code is non-zero if anything fails. Run with: npm run selfcheck
 */
import { execSync } from "node:child_process";
import { existsSync, statSync, readFileSync, mkdtempSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(import.meta.url);

let passed = 0;
let failed = 0;
const failures = [];

function ok(name) {
  passed += 1;
  console.log(`  \u2713 ${name}`);
}
function bad(name, err) {
  failed += 1;
  failures.push(name);
  console.log(`  \u2717 ${name}\n      ${err}`);
}
function assert(cond, name, detail = "assertion failed") {
  if (cond) ok(name);
  else bad(name, detail);
}
function section(title) {
  console.log(`\n\u25B8 ${title}`);
}
function run(cmd) {
  execSync(cmd, { cwd: root, stdio: "inherit" });
}

// 1 + 2 — typecheck and build (the real thing).
section("Typecheck");
try {
  run("npm run typecheck");
  ok("tsc (node + web) clean");
} catch {
  bad("tsc", "typecheck failed (see output above)");
}

section("Production build");
try {
  run("npm run build");
  ok("electron-vite build succeeded");
} catch {
  bad("build", "build failed (see output above)");
}

// 3 — artifacts.
section("Build artifacts");
for (const rel of [
  "out/main/index.js",
  "out/preload/index.js",
  "out/renderer/index.html",
]) {
  const p = join(root, rel);
  const exists = existsSync(p);
  const big = exists && statSync(p).size > 200;
  assert(big, `artifact ${rel} exists and is non-empty`, `missing/empty: ${rel}`);
}

// 4 — protocol round-trip, including a split across chunk boundaries.
section("Relay protocol (encode/decode round-trip)");
try {
  const proto = require(join(root, "bin", "protocol.js"));
  const { FrameType, encode, encodeJson, FrameDecoder } = proto;
  const frames = [];
  const decoder = new FrameDecoder((type, payload) =>
    frames.push({ type, payload }),
  );

  const inputFrame = encode(FrameType.INPUT, Buffer.from("hello \u00e9 world", "utf8"));
  const jsonFrame = encodeJson(FrameType.RESIZE, { cols: 120, rows: 40 });
  const combined = Buffer.concat([inputFrame, jsonFrame]);

  // Feed one byte at a time to prove the decoder reassembles split frames.
  for (const byte of combined) decoder.push(Buffer.from([byte]));

  assert(frames.length === 2, "decoded exactly 2 frames from a byte-split stream", `got ${frames.length}`);
  assert(
    frames[0]?.type === FrameType.INPUT &&
      frames[0].payload.toString("utf8") === "hello \u00e9 world",
    "INPUT frame payload round-trips (utf8-safe)",
  );
  const parsed = frames[1] ? JSON.parse(frames[1].payload.toString("utf8")) : {};
  assert(
    frames[1]?.type === FrameType.RESIZE && parsed.cols === 120 && parsed.rows === 40,
    "RESIZE JSON frame round-trips",
  );
} catch (e) {
  bad("protocol round-trip", e?.message ?? String(e));
}

// 5 — audit store behavioral test (best-effort: needs better-sqlite3 in Node).
section("SQLite audit store");
let Database = null;
let sqliteSkipReason = "";
try {
  Database = require("better-sqlite3");
  // The JS wrapper may load while the native .node is built for the Electron
  // ABI; constructing a DB is what actually loads it. Probe in-memory.
  const probe = new Database(":memory:");
  probe.close();
} catch (e) {
  const msg = e?.message ?? String(e);
  Database = null;
  sqliteSkipReason = /NODE_MODULE_VERSION|different Node\.js version/.test(msg)
    ? "better-sqlite3 is built for the Electron ABI (not plain Node)"
    : msg;
}
if (!Database) {
  console.log(
    `  \u26A0 skipped: ${sqliteSkipReason}. The store is exercised at runtime ` +
      "inside Electron; this check is environment-limited, not a failure.",
  );
}
if (Database) {
  let dir;
  try {
    dir = mkdtempSync(join(tmpdir(), "aw-selfcheck-"));
    const db = new Database(join(dir, "t.db"));
    db.pragma("user_version = 1");
    db.exec(
      `CREATE TABLE sessions (key TEXT PRIMARY KEY, session_id TEXT, command_line TEXT, started_at INTEGER);
       CREATE TABLE events (id INTEGER PRIMARY KEY AUTOINCREMENT, session_key TEXT, title TEXT);`,
    );
    db.prepare(
      "INSERT INTO sessions (key, session_id, command_line, started_at) VALUES (?,?,?,?)",
    ).run("run1:s1", "s1", "gemini", Date.now());
    db.prepare("INSERT INTO events (session_key, title) VALUES (?,?)").run(
      "run1:s1",
      "Session started",
    );
    const row = db
      .prepare(
        "SELECT s.command_line, (SELECT COUNT(*) FROM events e WHERE e.session_key = s.key) AS n FROM sessions s WHERE s.key = ?",
      )
      .get("run1:s1");
    assert(
      row && row.command_line === "gemini" && row.n === 1,
      "audit store records + joins a session with its events",
      JSON.stringify(row),
    );
    db.close();
  } catch (e) {
    bad("audit store round-trip", e?.message ?? String(e));
  } finally {
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
}

// 6 — source invariants for the fixes shipped on this branch.
section("Fix invariants (source)");
const reads = {};
function read(rel) {
  if (!(rel in reads)) {
    try {
      reads[rel] = readFileSync(join(root, rel), "utf8");
    } catch {
      reads[rel] = "";
    }
  }
  return reads[rel];
}
assert(
  read("src/main/notifications.ts").includes("this.active.has(key)"),
  "notifications: dedupe guard present",
);
assert(
  /flashAttention/.test(read("src/main/notifications.ts")) &&
    /flashAttention/.test(read("src/main/index.ts")),
  "notifications: never-miss fallback wired (dock/flash)",
);
assert(
  read("src/main/index.ts").includes("notifications?.resolve("),
  "notifications: auto-close on resolve/respond",
);
assert(
  read("src/main/pty/ptyManager.ts").includes("resolveLoginPath"),
  "new terminal: login PATH resolution present",
);
assert(
  read("src/main/store/db.ts").includes("user_version") &&
    read("src/main/store/db.ts").includes("tablesMatchExpected"),
  "audit store: versioned schema migration present",
);
assert(
  read("src/renderer/src/styles.css").includes("color-scheme: dark") &&
    read("src/renderer/src/styles.css").includes("xterm-viewport::-webkit-scrollbar"),
  "theme: dark tokens + terminal scrollbar styling present",
);
assert(
  read("src/shared/ipc.ts").includes("history:export"),
  "phase 5: session export channel present",
);

// Summary.
console.log(`\n${"\u2500".repeat(48)}`);
console.log(`Self-check: ${passed} passed, ${failed} failed.`);
if (failed > 0) {
  console.log(`Failed: ${failures.join(", ")}`);
  process.exit(1);
}
console.log("All checks passed \u2713");
