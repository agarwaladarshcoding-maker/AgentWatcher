# AgentWatch

> The real terminal already exists. AgentWatch never replaces it — it mirrors it
> 1:1 and adds one extra layer on top: **the words** (state annotations + a
> permission control plane).

AgentWatch spawns a CLI agent inside a PTY, mirrors its terminal byte-for-byte,
and layers state annotations + a permission control plane on top — without ever
changing how the agent runs. See the architecture doc in this repo for the full,
locked plan.

## Status

**MVP — Phases 0–4 complete (plus multi-agent pulled forward).** AgentWatch
mirrors any CLI agent byte-for-byte, layers on "the words" (state + a file-aware
event feed via Agent Profiles), and a **permission control plane** (Allow/Deny
writes the agent's own y/n with a logged verdict — no OS interception). A single
primary app owns all PTYs; each `agentwatch <cli>` relays to both its **native
terminal** and the shared GUI, where a searchable **sidebar** lists every agent
with instant switching and inline **rename**. Sessions, events, and verdicts are
persisted to a local **SQLite audit log** (viewable via History); default Allow/
Deny bytes are configurable in **Settings**. Packaged with electron-builder.

**Exit criterion:** a fresh machine can install AgentWatch and run a full
annotated, gated session.

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

## The `agentwatch` launcher (multi-agent relay)

`agentwatch <command>` does **not** open its own window. The first run boots a
single primary app; every run (including in other terminals) connects to it over
a local socket and relays that terminal's bytes to/from the agent's PTY. So each
agent shows in **both** its native terminal and the shared GUI, and all agents
live in one window you can search + switch between.

```bash
npm run build        # produce out/main/index.js
npm link             # expose the `agentwatch` bin on your PATH

agentwatch gemini              # first run also boots the app
agentwatch ollama run llama3   # in another terminal — appears in the same window
```

> During day-to-day development, run `npm run dev` first (it starts the primary
> app), then `agentwatch <cli>` in a terminal to attach a session.

## Project layout

```
agentwatch/
├─ bin/
│  ├─ agentwatch.js             # relay launcher (connects to the primary app)
│  └─ protocol.js               # wire protocol (CJS twin of shared/protocol.ts)
├─ electron.vite.config.ts      # electron-vite: main / preload / renderer
├─ src/
│  ├─ shared/                   # no-dep types shared by all sides
│  │  ├─ ipc.ts                 # renderer<->main channel names + payloads
│  │  ├─ protocol.ts            # relay socket framing
│  │  └─ types.ts               # AgentState, FeedEvent, SessionInfo
│  ├─ main/                     # Electron main (Node)
│  │  ├─ index.ts               # primary app: window + IPC wiring
│  │  ├─ ipcServer.ts           # local socket server for relay launchers
│  │  ├─ sessionManager.ts      # owns all sessions; per-session size negotiation
│  │  ├─ settings.ts            # persisted app settings (default responses)
│  │  ├─ store/db.ts            # SQLite audit log (sessions / events / verdicts)
│  │  ├─ pty/ptyManager.ts      # node-pty wrapper
│  │  └─ interpreter/           # cleaned stream -> state + events (+ profiles)
│  ├─ preload/                  # contextBridge: the only main<->renderer surface
│  └─ renderer/                 # React UI
│     └─ src/
│        ├─ {main.tsx, App.tsx, styles.css, theme.ts}
│        ├─ store/sessions.ts   # multi-session zustand store
│        ├─ terminal/manager.ts # imperative per-session xterm manager
│        └─ components/         # Sidebar, TerminalsLayer, EventFeed,
│                               #   NotificationPanel, History/Settings modals
└─ resources/                   # icons, packaged assets (added later)
```
