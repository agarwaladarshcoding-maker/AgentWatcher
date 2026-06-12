/**
 * Shared IPC contract between the Electron main process, the preload bridge,
 * and the React renderer (architecture doc §11). This module has NO runtime
 * dependencies (no node-pty, no electron) so it is safe to import from any of
 * the three sides.
 */

/** Channel names — the complete main<->renderer surface for Phase 1. */
export const IPC = {
  /** renderer -> main (invoke): fetch the wrapped command we were launched with. */
  appGetLaunchInfo: "app:getLaunchInfo",
  /** renderer -> main (invoke): spawn the PTY at the given size; returns the pid. */
  ptyStart: "pty:start",
  /** main -> renderer (event): verbatim PTY output chunk. */
  ptyData: "pty:data",
  /** renderer -> main (event): keystrokes / paste -> PTY stdin. */
  ptyInput: "pty:input",
  /** renderer -> main (event): keep the PTY size synced to the view. */
  ptyResize: "pty:resize",
  /** main -> renderer (event): the PTY process ended. */
  ptyExit: "pty:exit",
} as const;

/** Terminal dimensions in character cells. */
export interface PtySize {
  cols: number;
  rows: number;
}

/** Result of starting the PTY. pid is the session identity (architecture §4.4). */
export interface PtyStartResult {
  pid: number;
}

/** Emitted once when the wrapped process exits. */
export interface PtyExitInfo {
  code: number;
  signal?: number;
}
