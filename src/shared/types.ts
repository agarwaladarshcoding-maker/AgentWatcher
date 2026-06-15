/**
 * The data & event model for "the words" (architecture doc §6) plus the
 * multi-session model. Pure types, no runtime dependencies — safe to import
 * from main, preload, and renderer.
 */

/**
 * The interpreted state of the agent. Deliberately simple and robust: it is
 * derived from the FLOW of output (activity), not fragile per-CLI regexes, so
 * it works for any agent.
 *
 *   - idle:      at rest, nothing happening
 *   - working:   output is actively streaming (the agent is doing something)
 *   - waiting:   blocked on a permission/decision prompt (the control plane)
 *   - completed: just finished a burst of work and went quiet (then decays to idle)
 */
export type AgentState = "idle" | "working" | "waiting" | "completed";

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

/** Where a session was launched from: a native terminal relay, or the GUI itself. */
export type SessionOrigin = "native" | "gui";

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
  /** The working directory the session was spawned in (so it is trackable). */
  cwd: string;
  /** Whether this session was started from a native terminal or the GUI. */
  origin: SessionOrigin;
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
  /** Show OS notifications when a permission lands (the agent is waiting). */
  notifications: boolean;
  /** Also notify when an agent finishes / a session ends (a "completed" toast). */
  notifyOnComplete: boolean;
  /** Play a soft chime when a permission lands. */
  sound: boolean;
  /** Override what Allow writes to stdin (empty = use the agent profile's). */
  allowInput: string;
  /** Override what Deny writes to stdin (empty = use the agent profile's). */
  denyInput: string;
}

export const DEFAULT_SETTINGS: AppSettings = {
  notifications: true,
  notifyOnComplete: true,
  sound: true,
  allowInput: "",
  denyInput: "",
};

/**
 * Phase 4 — persisted history. One row in the session-history list (SQLite
 * audit log), with rolled-up event/verdict counts. Pure data, shared by main,
 * preload, and renderer.
 */
export interface HistorySessionRow {
  /** Stable key, unique across runs (runId:sessionId). */
  key: string;
  sessionId: string;
  commandLine: string;
  profile: string;
  pid: number;
  startedAt: number;
  endedAt: number | null;
  exitCode: number | null;
  eventCount: number;
  verdictCount: number;
}

/** The full persisted timeline of one historical session. */
export interface HistoryDetail {
  session: HistorySessionRow | null;
  events: FeedEvent[];
  verdicts: RespondedPermission[];
}

/**
 * ─── Browser bonding (spec: browser-bonding §B) ───────────────────────────
 * The state of a browser-based agent tab, as observed by the AgentWatch Web
 * Chrome extension and streamed to the desktop app over the local bridge.
 * Mirrors AgentState but in the web vocabulary (done == completed).
 */
export type BrowserAgentState = "idle" | "working" | "done";

/**
 * One watched browser tab, keyed by Chrome `tabId` (the web analog of a PID).
 * The desktop "Chrome section" renders one card per TrackedTab when the
 * extension is connected; absent entirely when it is not.
 */
export interface TrackedTab {
  /** Chrome tab id — the stable identity of a watched agent tab. */
  tabId: number;
  /** Chrome window id, used to focus the right window on jump-to-tab. */
  windowId?: number;
  /** Adapter that matched this tab, e.g. "claude". */
  adapterId: string;
  /** Human label, e.g. "Claude". */
  label: string;
  url?: string;
  favIconUrl?: string;
  state: BrowserAgentState;
  /** epoch ms of the last state change. */
  lastChange: number;
  /** First ~120 chars of the latest answer (set on completion). */
  snippet?: string;
  /** Optional fuller latest-message text, shown inline in the card. */
  output?: string;
}
