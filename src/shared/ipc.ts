/**
 * Shared IPC contract between the Electron main process, the preload bridge,
 * and the React renderer (architecture doc §11). This module has NO runtime
 * dependencies (no node-pty, no electron) so it is safe to import from any of
 * the three sides.
 */

import type { AgentState, FeedEvent } from "./types";

/** Channel names — the complete main<->renderer surface (Phases 1–2). */
export const IPC = {
  /** renderer -> main (invoke): fetch the wrapped command we were launched with. */
  appGetLaunchInfo: "app:getLaunchInfo",
  /** renderer -> main (invoke): spawn the PTY at the given size; returns start info. */
  ptyStart: "pty:start",
  /** main -> renderer (event): verbatim PTY output chunk. */
  ptyData: "pty:data",
  /** renderer -> main (event): keystrokes / paste -> PTY stdin. */
  ptyInput: "pty:input",
  /** renderer -> main (event): request a PTY resize (honored only when the mirror is size authority). */
  ptyResize: "pty:resize",
  /** main -> renderer (event): the authoritative PTY size changed (e.g. native terminal resized). */
  ptySize: "pty:size",
  /** main -> renderer (event): the PTY process ended. */
  ptyExit: "pty:exit",
  /** main -> renderer (event): current interpreted agent state (the words). */
  agentState: "agent:state",
  /** main -> renderer (event): a new entry for the event feed. */
  feedEvent: "feed:event",
} as const;

/** Terminal dimensions in character cells. */
export interface PtySize {
  cols: number;
  rows: number;
}

/**
 * Who owns the single PTY's size.
 * - "native": the native terminal that launched agentwatch is attached and
 *   authoritative; the GUI mirror renders at the PTY size (it does not drive it).
 * - "mirror": no controlling TTY, so the GUI mirror fits-to-window and drives size.
 */
export type SizeAuthority = "native" | "mirror";

/** Result of starting the PTY. pid is the session identity (architecture §4.4). */
export interface PtyStartResult {
  pid: number;
  /** Which surface owns the PTY size for this session. */
  sizeAuthority: SizeAuthority;
  /** The size the PTY actually started at. */
  cols: number;
  rows: number;
  /** True when the agent is also mirrored to the native launching terminal. */
  nativeMirror: boolean;
}

/** Emitted once when the wrapped process exits. */
export interface PtyExitInfo {
  code: number;
  signal?: number;
}

export type { AgentState, FeedEvent };
