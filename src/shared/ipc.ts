/**
 * Shared IPC contract between the Electron main process, the preload bridge,
 * and the React renderer (architecture doc §11), now session-keyed for the
 * multi-agent model. No runtime dependencies — safe to import from any side.
 */
import type { AgentState, FeedEvent, SessionInfo } from "./types";

/** Channel names — the complete main<->renderer surface. */
export const IPC = {
  /** renderer -> main (invoke): snapshot of all sessions. */
  sessionsGet: "sessions:get",
  /** main -> renderer (event): the full session list changed. */
  sessionsList: "sessions:list",
  /** main -> renderer (event): verbatim PTY output for a session. */
  sessionData: "session:data",
  /** main -> renderer (event): interpreted state for a session. */
  sessionState: "session:state",
  /** main -> renderer (event): a new feed entry for a session. */
  sessionEvent: "session:event",
  /** main -> renderer (event): the authoritative PTY size for a session changed. */
  sessionSize: "session:size",
  /** main -> renderer (event): a session's process ended. */
  sessionExit: "session:exit",
  /** renderer -> main (event): keystrokes / paste -> a session's PTY stdin. */
  sessionInput: "session:input",
  /** renderer -> main (event): the GUI view's size for a session (size negotiation). */
  sessionResize: "session:resize",
  /** renderer -> main (event): kill a session. */
  sessionClose: "session:close",
} as const;

/** Terminal dimensions in character cells. */
export interface PtySize {
  cols: number;
  rows: number;
}

/** Emitted once when a session's process exits. */
export interface PtyExitInfo {
  code: number;
  signal?: number;
}

/** main -> renderer payloads. */
export interface SessionDataMsg {
  id: string;
  chunk: string;
}
export interface SessionStateMsg {
  id: string;
  state: AgentState;
}
export interface SessionEventMsg {
  id: string;
  event: FeedEvent;
}
export interface SessionSizeMsg {
  id: string;
  cols: number;
  rows: number;
}
export interface SessionExitMsg {
  id: string;
  info: PtyExitInfo;
}

/** renderer -> main payloads. */
export interface SessionInputMsg {
  id: string;
  data: string;
}
export interface SessionResizeMsg {
  id: string;
  cols: number;
  rows: number;
}

export type { AgentState, FeedEvent, SessionInfo };
