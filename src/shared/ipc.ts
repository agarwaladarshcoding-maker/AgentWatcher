/**
 * Shared IPC contract between the Electron main process, the preload bridge,
 * and the React renderer (architecture doc §11), now session-keyed for the
 * multi-agent model. No runtime dependencies — safe to import from any side.
 */
import type {
  AgentState,
  FeedEvent,
  SessionInfo,
  PendingPermission,
  Verdict,
} from "./types";

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
  /** main -> renderer (event): a permission prompt is pending for a session. */
  sessionPermission: "session:permission",
  /** main -> renderer (event): a permission was resolved (Allowed/Denied). */
  sessionVerdict: "session:verdict",
  /** renderer -> main (event): keystrokes / paste -> a session's PTY stdin. */
  sessionInput: "session:input",
  /** renderer -> main (event): the GUI view's size for a session (size negotiation). */
  sessionResize: "session:resize",
  /** renderer -> main (event): answer a pending permission (Allow/Deny). */
  sessionRespond: "session:respond",
  /** renderer -> main (event): rename a session's label. */
  sessionRename: "session:rename",
  /** renderer -> main (event): kill a session. */
  sessionClose: "session:close",
  /** renderer -> main (invoke): query the audit log / session history. */
  historyQuery: "history:query",
  /** renderer -> main (invoke): read app settings. */
  settingsGet: "settings:get",
  /** renderer -> main (invoke): persist app settings; returns the saved value. */
  settingsSet: "settings:set",
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
export interface SessionRespondMsg {
  id: string;
  permissionId: string;
  decision: "allow" | "deny";
}
export interface SessionRenameMsg {
  id: string;
  name: string;
}

/** Permission / verdict messages. */
export interface SessionPermissionMsg {
  id: string;
  permission: PendingPermission;
}
export interface SessionVerdictMsg {
  id: string;
  verdict: Verdict;
}

/** Audit log / history (Phase 4). */
export interface HistoryFilter {
  limit?: number;
}
export interface HistoryRow {
  rowId: number;
  sessionId: string;
  command: string;
  label: string;
  profile: string;
  pid: number;
  startedAt: number;
  endedAt: number | null;
  exitCode: number | null;
  events: number;
  verdicts: number;
}

/** Persisted app settings (Phase 4). */
export interface AppSettings {
  /** Bytes written to stdin on Allow (default "y\n"). */
  defaultAllow: string;
  /** Bytes written to stdin on Deny (default "n\n"). */
  defaultDeny: string;
  /** Persist a full transcript per session to the audit log (default false). */
  persistTranscript: boolean;
}

export const DEFAULT_SETTINGS: AppSettings = {
  defaultAllow: "y\n",
  defaultDeny: "n\n",
  persistTranscript: false,
};

export type { AgentState, FeedEvent, SessionInfo, PendingPermission, Verdict };
