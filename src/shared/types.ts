/**
 * The data & event model for "the words" (architecture doc §6) plus the
 * multi-session model. Pure types, no runtime dependencies — safe to import
 * from main, preload, and renderer.
 */

/** The interpreted state of the agent, derived from the cleaned stream. */
export type AgentState =
  | "idle"
  | "reading"
  | "thinking"
  | "writing"
  | "waiting"
  | "done";

/** An entry in the live event feed. */
export interface FeedEvent {
  id: string;
  ts: number;
  kind:
    | "session_start"
    | "session_end"
    | "state_change"
    | "permission_needed"
    | "verdict"
    | "output";
  state?: AgentState;
  title: string;
  detail?: string;
}

/** A running (or finished) agent session — one PTY, one PID. */
export interface SessionInfo {
  id: string;
  command: string;
  args: string[];
  commandLine: string;
  profile: string;
  pid: number;
  state: AgentState;
  startedAt: number;
  /** Set once the process exits. */
  exitCode?: number;
  ended: boolean;
  /** True while a native terminal relay is attached to this session. */
  nativeAttached: boolean;
}

/**
 * A pending permission prompt the agent is already blocking on (Phase 3). Kept
 * here so the contract is stable, even though the control plane lands later.
 */
export interface PendingPermission {
  id: string;
  ts: number;
  title: string;
  source: string;
  rawPrompt: string;
  allowInput: string;
  denyInput: string;
}

/** The recorded outcome of a permission decision (Phase 3). */
export interface Verdict {
  permissionId: string;
  decision: "allow" | "deny";
  ts: number;
}
