/**
 * Shared IPC contract between the Electron main process, the preload bridge,
 * and the React renderer (architecture doc §11), now session-keyed for the
 * multi-agent model. No runtime dependencies — safe to import from any side.
 */
import type {
  AgentState,
  AppSettings,
  FeedEvent,
  PendingPermission,
  PermissionAction,
  RespondedPermission,
  SessionInfo,
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
  /** renderer -> main (event): keystrokes / paste -> a session's PTY stdin. */
  sessionInput: "session:input",
  /** renderer -> main (event): the GUI view's size for a session (size negotiation). */
  sessionResize: "session:resize",
  /** renderer -> main (event): kill a session (terminate the process). */
  sessionClose: "session:close",
  /** renderer -> main (event): remove an already-ended session from the list. */
  sessionRemove: "session:remove",
  /** renderer -> main (invoke): spawn a brand-new session from the GUI. */
  sessionSpawn: "session:spawn",
  /** main -> renderer (event): focus/switch to a session (e.g. notification click). */
  sessionFocus: "session:focus",

  // ---- Phase 3: permission control plane ----
  /** main -> renderer (event): a new pending permission for a session. */
  permissionPending: "permission:pending",
  /** main -> renderer (event): a pending permission was cleared (answered elsewhere). */
  permissionResolved: "permission:resolved",
  /** main -> renderer (event): a permission moved to the Responded/audit list. */
  permissionResponded: "permission:responded",
  /** renderer -> main (event): answer a pending permission (Allow/Deny/choice/custom). */
  permissionRespond: "permission:respond",

  /** renderer -> main (event): user settings changed. */
  settingsUpdate: "settings:update",
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

/** renderer -> main (invoke): create a new GUI-owned session. */
export interface SessionSpawnMsg {
  command: string;
  args: string[];
  cwd?: string;
  cols: number;
  rows: number;
}

/** main -> renderer: a permission is now pending for a session. */
export interface PermissionPendingMsg {
  id: string;
  permission: PendingPermission;
}
/** main -> renderer: a pending permission was cleared without an explicit verdict. */
export interface PermissionResolvedMsg {
  id: string;
  permissionId: string;
}
/** main -> renderer: a permission has a recorded verdict. */
export interface PermissionRespondedMsg {
  id: string;
  responded: RespondedPermission;
}
/** renderer -> main: answer a pending permission. */
export interface PermissionRespondMsg {
  id: string;
  permissionId: string;
  action: PermissionAction;
}

export type {
  AgentState,
  AppSettings,
  FeedEvent,
  PendingPermission,
  PermissionAction,
  RespondedPermission,
  SessionInfo,
};
