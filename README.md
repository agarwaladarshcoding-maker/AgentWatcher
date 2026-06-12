# AgentWatch

> The real terminal already exists. AgentWatch never replaces it — it mirrors it
> 1:1 and adds one extra layer on top: **the words** (state annotations + a
> permission control plane).

AgentWatch spawns a CLI agent inside a PTY, mirrors its terminal byte-for-byte,
and layers state annotations + a permission control plane on top — without ever
changing how the agent runs. See the architecture doc in this repo for the full,
locked plan.

## Status

**Phase 0 — Scaffolding.** Runnable empty Electron app + the `agentwatch`
launcher. No PTY, no mirror, no interpretation yet.

**Phase 0 exit criterion:** `agentwatch echo hello` opens the AgentWatch window.

## Stack

Electron + TypeScript · React + Vite (electron-vite) · node-pty · xterm.js ·
better-sqlite3 · strip-ansi · zustand. Node 20 LTS.

## Prerequisites

- **Node.js 20.x LTS** and npm
- A C/C++ toolchain + Python 3 (to compile the native modules `node-pty` and
  `better-sqlite3`):
  - macOS: Xcode Command Line Tools
  - Linux: `build-essential`
  - Windows: "Desktop development with C++" (MSVC Build Tools)

## Getting started

```bash
npm install          # install deps; postinstall rebuilds native modules for Electron
npm run dev          # electron-vite dev server with HMR (opens the window directly)
```

## Scripts

| Script              | What it does                                                       |
| ------------------- | ------------------------------------------------------------------ |
| `npm run dev`       | electron-vite dev with HMR for main / preload / renderer.          |
| `npm run build`     | Type-check, then bundle main / preload / renderer into `out/`.     |
| `npm start`         | Preview the production build (`electron-vite preview`).            |
| `npm run typecheck` | Type-check the Node side and the web side separately.              |
| `npm run rebuild`   | Rebuild native modules (node-pty, better-sqlite3) against Electron.|
| `npm run package`   | Build + produce platform installers via electron-builder.          |

## The `agentwatch` launcher (Phase 0 smoke test)

The `agentwatch <command>` CLI boots the app and hands the wrapped command to
the main process. To use it against the **built** app:

```bash
npm run build        # produce out/main/index.js
npm link             # expose the `agentwatch` bin on your PATH

agentwatch echo hello   # ✅ Phase 0 exit criterion: the window opens
```

The window shows the command it was launched to watch. In Phase 0 the main
process only logs that command (`[agentwatch] launch command: echo hello`) — it
does not spawn a PTY yet. That arrives in Phase 1.

> During day-to-day development you can skip the launcher and just run
> `npm run dev`, which opens the window directly (no wrapped command).

## Project layout

```
agentwatch/
├─ bin/agentwatch.js            # the `agentwatch <cmd>` CLI launcher
├─ electron.vite.config.ts      # electron-vite: main / preload / renderer
├─ src/
│  ├─ main/                     # Electron main process (Node)
│  │  ├─ index.ts               # app lifecycle, window creation
│  │  └─ launch.ts              # parse the wrapped command from the launcher
│  ├─ preload/                  # contextBridge: the only main<->renderer surface
│  │  ├─ index.ts
│  │  └─ index.d.ts
│  └─ renderer/                 # React UI
│     ├─ index.html
│     └─ src/{main.tsx, App.tsx, styles.css}
└─ resources/                   # icons, packaged assets (added later)
```
