#!/usr/bin/env node
/**
 * AgentWatch Web build (spec §B7). No fragile plugin chain: esbuild bundles the
 * three entry points and we copy the static assets. Output is a load-unpacked
 * folder at dist/.
 *
 *   - background/index.ts → dist/background/index.js   (ESM service worker)
 *   - content/index.ts    → dist/content/index.js      (IIFE classic content script)
 *   - popup/main.ts       → dist/popup/main.js          (ESM module)
 *
 * Run:  npm run build   (then load dist/ unpacked in chrome://extensions)
 */
import { build } from "esbuild";
import {
  cpSync,
  existsSync,
  mkdirSync,
  rmSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const root = dirname(fileURLToPath(import.meta.url));
const dist = join(root, "dist");

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

const common = {
  bundle: true,
  sourcemap: false,
  target: ["chrome116"],
  logLevel: "info",
};

await build({
  ...common,
  entryPoints: [join(root, "src/background/index.ts")],
  outfile: join(dist, "background/index.js"),
  format: "esm",
});

await build({
  ...common,
  entryPoints: [join(root, "src/content/index.ts")],
  outfile: join(dist, "content/index.js"),
  format: "iife",
});

await build({
  ...common,
  entryPoints: [join(root, "src/popup/main.ts")],
  outfile: join(dist, "popup/main.js"),
  format: "esm",
});

// Static assets.
cpSync(join(root, "manifest.json"), join(dist, "manifest.json"));
cpSync(join(root, "src/popup/index.html"), join(dist, "popup/index.html"));

// Icons — generate if missing, then copy.
if (!existsSync(join(root, "icons/icon128.png"))) {
  execSync("node scripts/make-icons.mjs", { cwd: root, stdio: "inherit" });
}
cpSync(join(root, "icons"), join(dist, "icons"), { recursive: true });

console.log("\n✓ Built AgentWatch Web → dist/  (load unpacked in chrome://extensions)");
