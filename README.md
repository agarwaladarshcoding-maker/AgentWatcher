# AgentWatch

> The real terminal already exists. AgentWatch never replaces it — it mirrors it
> 1:1 and adds one extra layer on top: **the words** (state annotations + a
> permission control plane).

AgentWatch spawns a CLI agent inside a PTY, mirrors its terminal byte-for-byte,
and layers state annotations + a permission control plane on top — without ever
changing how the agent runs. See the architecture doc in this repo for the full,
locked plan.

## Status

**Phase 2 — Interpretation layer (the words) + dual-mirror passthrough.** On top
of the faithful mirror, a tee'd ANSI-stripped copy of the stream feeds an
interpreter that derives agent state (idle/reading/thinking/writing/waiting/done)
and a live event feed via swappable regex **Agent Profiles** (generic + Gemini +
Claude starters). The single PTY is also teed to the **native terminal** that
launched `agentwatch`, so the agent is usable from both the native terminal and
the GUI mirror at once — one process, no double compute, agent-agnostic. The
permission control plane and persistence arrive in Phases 3–4.

**Phase 2 exit criterion:** during a real session the state badge + event feed
update sensibly while the mirror stays byte-perfect, and the agent is usable
from both the native terminal and the GUI mirror with one underlying process.

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

## The `agentwatch` launcher

The `agentwatch <command>` CLI boots the app and hands the wrapped command to
the main process, which spawns it inside a PTY and mirrors it. To use it against
the **built** app:

```bash
npm run build        # produce out/main/index.js
npm link             # expose the `agentwatch` bin on your PATH

agentwatch echo hello    # opens the window (Phase 0 smoke test)
agentwatch gemini        # wrap an interactive agent — fully usable mirror
```

> During day-to-day development you can skip the launcher and just run
> `npm run dev`. With no wrapped command, AgentWatch mirrors your default shell
> so the terminal is still usable for testing.

## Project layout

```
agentwatch/
├─ bin/agentwatch.js            # the `agentwatch <cmd>` CLI launcher
├─ electron.vite.config.ts      # electron-vite: main / preload / renderer
├─ src/
│  ├─ shared/ipc.ts             # IPC channel names + payload types (no deps)
│  ├─ main/                     # Electron main process (Node)
│  │  ├─ index.ts               # app lifecycle, window creation, IPC wiring
│  │  ├─ launch.ts              # parse the wrapped command from the launcher
│  │  └─ pty/ptyManager.ts      # node-pty wrapper: spawn, data, input, resize, exit
│  ├─ preload/                  # contextBridge: the only main<->renderer surface
│  │  ├─ index.ts
│  │  └─ index.d.ts
│  └─ renderer/                 # React UI
│     ├─ index.html
│     └─ src/
│        ├─ {main.tsx, App.tsx, styles.css}
│        └─ components/TerminalMirror.tsx   # xterm.js host (mounted once via ref)
└─ resources/                   # icons, packaged assets (added later)
```
