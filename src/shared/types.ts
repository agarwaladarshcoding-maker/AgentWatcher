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
 * One selectable option parsed out of a "choice" prompt (e.g. Gemini's
 * "1. Full Search / 2. Scoped Search / 3. Enter a custom value"). Clicking it
 * writes `send` to the PTY, mirroring what the user would type in the terminal.
 */
export interface PermissionChoice {
  label: string;
  /** Bytes to write to stdin when this option is chosen (e.g. "2\r"). */
  send: string;
}

/**
 * A pending permission prompt the agent is already blocking on (Phase 3).
 *
 * Two shapes:
 *   - "confirm": a yes/no style prompt → Allow / Deny buttons.
 *   - "choice":  a numbered menu → one button per parsed option (mirrors the
 *                terminal prompt, antigravity-style).
 * Either way the user can also send free text (custom response).
 */
export interface PendingPermission {
  id: string;
  /** The session this prompt belongs to. */
  sessionId?: string;
  ts: number;
  title: string;
  source: string;
  rawPrompt: string;
  kind: "confirm" | "choice";
  choices?: PermissionChoice[];
  /** confirm: what Allow writes to stdin. */
  allowInput: string;
  /** confirm: what Deny writes to stdin. */
  denyInput: string;
}

/** How a pending permission was resolved. */
export type RespondedDecision =
  | "allow"
  | "deny"
  | "choice"
  | "custom"
  | "answered"
  | "dismissed";

/** The recorded outcome of a permission decision (Phase 3 audit). */
export interface RespondedPermission {
  id: string;
  ts: number;
  decidedAt: number;
  title: string;
  source: string;
  rawPrompt: string;
  decision: RespondedDecision;
  /** Human label for the verdict chip (e.g. "Allowed", "Scoped Search"). */
  label: string;
}

/**
 * How the renderer asks main to answer a pending permission. Resolved to actual
 * bytes (+ an audit label) in the main process.
 */
export type PermissionAction =
  | { type: "allow" }
  | { type: "deny" }
  | { type: "choice"; send: string; label: string }
  | { type: "custom"; text: string };

/** User-tunable app settings (persisted in the renderer, mirrored to main). */
export interface AppSettings {
  /** Show OS notifications when a permission lands. */
  notifications: boolean;
  /** Play a soft chime when a permission lands. */
  sound: boolean;
  /** Override what Allow writes to stdin (empty = use the agent profile's). */
  allowInput: string;
  /** Override what Deny writes to stdin (empty = use the agent profile's). */
  denyInput: string;
}

export const DEFAULT_SETTINGS: AppSettings = {
  notifications: true,
  sound: true,
  allowInput: "",
  denyInput: "",
};
