/**
 * The data & event model for "the words" (architecture doc §6). Pure types,
 * no runtime dependencies — safe to import from main, preload, and renderer.
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
