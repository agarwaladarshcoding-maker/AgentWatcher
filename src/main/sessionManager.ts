import { PtyManager } from "./pty/ptyManager";
import { Interpreter } from "./interpreter/interpreter";
import { selectProfile } from "./interpreter/profiles";
import type {
  AgentState,
  AppSettings,
  FeedEvent,
  PendingPermission,
  PermissionAction,
  RespondedDecision,
  RespondedPermission,
  SessionInfo,
} from "../shared/types";
import { DEFAULT_SETTINGS } from "../shared/types";
import type { PtyExitInfo } from "../shared/ipc";
import type { AuditStore } from "./store/db";

/**
 * SessionManager — owns every agent session (architecture multi-agent model).
 * One agent = one PTY = one PID; the manager holds many at once, each with its
 * own interpreter + profile. There is exactly one OS process per agent (no
 * double compute, §18); its single stream is teed to all viewers.
 *
 * Viewers & size negotiation: a session can be viewed by several surfaces at
 * once — the native terminal relay AND the GUI mirror. A PTY has only one size,
 * so we set it to the MIN cols/rows across all viewers. That guarantees neither
 * view overflows (the root cause of the scroll/cursor glitches).
 */
export interface SessionSink {
  onData(id: string, chunk: string): void;
  onState(id: string, state: AgentState): void;
  onEvent(id: string, event: FeedEvent): void;
  onSize(id: string, cols: number, rows: number): void;
  onExit(id: string, info: PtyExitInfo): void;
  onListChanged(): void;
  /** A new permission prompt is blocking a session. */
  onPermissionPending(id: string, permission: PendingPermission): void;
  /** A pending permission was cleared without an explicit UI verdict. */
  onPermissionResolved(id: string, permissionId: string): void;
  /** A permission moved to the Responded/audit list. */
  onPermissionResponded(id: string, responded: RespondedPermission): void;
}

export interface CreateOptions {
  command: string;
  args: string[];
  cwd: string;
  cols: number;
  rows: number;
}

interface Session {
  info: SessionInfo;
  pty: PtyManager;
  interpreter: Interpreter;
  viewers: Map<string, { cols: number; rows: number }>;
  pending: Map<string, PendingPermission>;
}

export class SessionManager {
  private readonly sessions = new Map<string, Session>();
  private seq = 0;
  private settings: AppSettings = { ...DEFAULT_SETTINGS };
  /**
   * The viewer whose size wins when present (e.g. "gui" while the dashboard
   * window is focused). When null we fall back to the MIN across all viewers.
   * This fixes agents (gemini) rendering cramped in a big GUI just because a
   * small native terminal relay is also attached.
   */
  private sizeAuthority: string | null = null;

  /**
   * Optional durable audit log (Phase 4). Best-effort: every call is guarded
   * inside the store itself, so persistence can never break a live session.
   */
  constructor(
    private readonly sink: SessionSink,
    private readonly store?: AuditStore,
  ) {}

  /** Emit a feed event to all viewers AND persist it to the audit log. */
  private emitEvent(id: string, event: FeedEvent): void {
    this.sink.onEvent(id, event);
    this.store?.event(id, event);
  }

  list(): SessionInfo[] {
    return [...this.sessions.values()].map((s) => ({ ...s.info }));
  }

  has(id: string): boolean {
    return this.sessions.has(id);
  }

  getSettings(): AppSettings {
    return { ...this.settings };
  }

  updateSettings(next: Partial<AppSettings>): void {
    this.settings = { ...this.settings, ...next };
  }

  /** Spawn a new agent session. `primaryViewerId` is the relay/GUI that requested it. */
  create(opts: CreateOptions, primaryViewerId: string): SessionInfo {
    this.seq += 1;
    const id = `s${this.seq}`;
    const profile = selectProfile(opts.command);
    const commandLine = [opts.command, ...opts.args].join(" ").trim();
    const pty = new PtyManager();

    const interpreter = new Interpreter(profile, {
      onState: (state) => {
        const s = this.sessions.get(id);
        if (s) s.info.state = state;
        this.sink.onState(id, state);
      },
      onEvent: (event) => this.emitEvent(id, event),
      onPermission: (permission) => {
        const s = this.sessions.get(id);
        if (s) {
          permission.sessionId = id;
          s.pending.set(permission.id, permission);
        }
        this.sink.onPermissionPending(id, permission);
      },
      onPermissionResolved: (permissionId) => {
        const s = this.sessions.get(id);
        if (!s) return;
        const p = s.pending.get(permissionId);
        if (!p) return; // already answered via the UI, or cleared on exit
        s.pending.delete(permissionId);
        this.sink.onPermissionResolved(id, permissionId);
        this.recordVerdict(id, p, "answered", "Answered in terminal");
      },
    });

    const nativeAttached = primaryViewerId.startsWith("relay");
    const info: SessionInfo = {
      id,
      command: opts.command,
      args: opts.args,
      commandLine: commandLine || opts.command,
      profile: profile.name,
      pid: -1,
      state: "idle",
      startedAt: Date.now(),
      ended: false,
      nativeAttached,
      cwd: opts.cwd,
      origin: nativeAttached ? "native" : "gui",
    };

    const viewers = new Map<string, { cols: number; rows: number }>();
    viewers.set(primaryViewerId, {
      cols: opts.cols > 0 ? opts.cols : 80,
      rows: opts.rows > 0 ? opts.rows : 30,
    });

    const session: Session = {
      info,
      pty,
      interpreter,
      viewers,
      pending: new Map(),
    };
    this.sessions.set(id, session);

    pty.onData((chunk) => {
      this.sink.onData(id, chunk); // verbatim to every viewer (GUI + relays)
      interpreter.feed(chunk); //      strip-ANSI copy → the words
    });
    pty.onExit((exit) => {
      info.ended = true;
      info.exitCode = exit.code;
      // Clear any pending prompts silently — the process is gone (§25).
      for (const pid of [...session.pending.keys()]) {
        session.pending.delete(pid);
        this.sink.onPermissionResolved(id, pid);
      }
      interpreter.sessionEnd(exit.code, exit.signal);
      interpreter.dispose();
      this.store?.sessionEnded(id, exit.code);
      this.sink.onExit(id, exit);
      this.sink.onListChanged();
    });

    const size = this.negotiate(session);
    const pid = pty.start({
      command: opts.command,
      args: opts.args,
      cwd: opts.cwd,
      cols: size.cols,
      rows: size.rows,
    });
    info.pid = pid;
    interpreter.sessionStart(pid, info.commandLine);
    this.store?.sessionStarted(info);
    this.sink.onListChanged();
    return { ...info };
  }

  write(id: string, data: string): void {
    this.sessions.get(id)?.pty.write(data);
  }

  /**
   * Answer a pending permission from the UI: resolve the action to bytes, write
   * them to the PTY (exactly what typing in the mirror would do), and log the
   * verdict to the Responded/audit list.
   */
  respond(id: string, permissionId: string, action: PermissionAction): void {
    const s = this.sessions.get(id);
    if (!s) return;
    const p = s.pending.get(permissionId);
    if (!p) return;

    const { send, decision, label } = this.resolveAction(p, action);
    s.pty.write(send);
    s.interpreter.acknowledgeResolved(permissionId);
    s.pending.delete(permissionId);
    this.recordVerdict(id, p, decision, label);
  }

  private resolveAction(
    p: PendingPermission,
    action: PermissionAction,
  ): { send: string; decision: RespondedDecision; label: string } {
    switch (action.type) {
      case "allow":
        return {
          send: this.settings.allowInput || p.allowInput,
          decision: "allow",
          label: "Allowed",
        };
      case "deny":
        return {
          send: this.settings.denyInput || p.denyInput,
          decision: "deny",
          label: "Denied",
        };
      case "choice":
        return { send: action.send, decision: "choice", label: action.label };
      case "custom": {
        const text = /[\r\n]$/.test(action.text)
          ? action.text
          : `${action.text}\r`;
        return {
          send: text,
          decision: "custom",
          label: `Sent “${action.text.trim().slice(0, 32)}”`,
        };
      }
    }
  }

  private recordVerdict(
    id: string,
    p: PendingPermission,
    decision: RespondedDecision,
    label: string,
  ): void {
    const responded: RespondedPermission = {
      id: p.id,
      ts: p.ts,
      decidedAt: Date.now(),
      title: p.title,
      source: p.source,
      rawPrompt: p.rawPrompt,
      decision,
      label,
    };
    this.sink.onPermissionResponded(id, responded);
    this.store?.verdict(id, responded);
    this.emitEvent(id, {
      id: `v${Date.now().toString(36)}-${p.id}`,
      ts: Date.now(),
      kind: "verdict",
      state: decision === "deny" ? undefined : "working",
      title: label,
      detail: p.title,
    });
  }

  /** A viewer reported its size; renegotiate the PTY size (min across viewers). */
  setViewerSize(id: string, viewerId: string, cols: number, rows: number): void {
    const s = this.sessions.get(id);
    if (!s || cols <= 0 || rows <= 0) return;
    s.viewers.set(viewerId, { cols, rows });
    this.applySize(s);
  }

  removeViewer(id: string, viewerId: string): void {
    const s = this.sessions.get(id);
    if (!s) return;
    s.viewers.delete(viewerId);
    if (viewerId.startsWith("relay")) {
      s.info.nativeAttached = [...s.viewers.keys()].some((k) =>
        k.startsWith("relay"),
      );
      this.sink.onListChanged();
    }
    if (s.viewers.size > 0) this.applySize(s);
  }

  kill(id: string): void {
    this.sessions.get(id)?.pty.kill();
  }

  /** Remove a session record entirely (after it has ended). */
  remove(id: string): void {
    const s = this.sessions.get(id);
    if (s) {
      // Make sure a still-running process is stopped, and release its timer.
      s.pty.kill();
      s.interpreter.dispose();
    }
    this.sessions.delete(id);
    this.sink.onListChanged();
  }

  killAll(): void {
    for (const s of this.sessions.values()) {
      s.pty.kill();
      s.interpreter.dispose();
    }
  }

  /**
   * Set the viewer whose size is authoritative (e.g. "gui" when the dashboard
   * is focused), or null to fall back to MIN across viewers. Renegotiates every
   * live session so the change takes effect immediately.
   */
  setSizeAuthority(viewerId: string | null): void {
    if (this.sizeAuthority === viewerId) return;
    this.sizeAuthority = viewerId;
    for (const s of this.sessions.values()) {
      if (s.viewers.size > 0) this.applySize(s);
    }
  }

  private negotiate(s: Session): { cols: number; rows: number } {
    // If an authoritative viewer is present for this session, it drives the
    // size outright — so the focused GUI uses its full width even when a small
    // native terminal is also mirroring the agent.
    if (this.sizeAuthority) {
      const authoritative = s.viewers.get(this.sizeAuthority);
      if (authoritative && authoritative.cols > 0 && authoritative.rows > 0) {
        return { cols: authoritative.cols, rows: authoritative.rows };
      }
    }
    let cols = Infinity;
    let rows = Infinity;
    for (const v of s.viewers.values()) {
      cols = Math.min(cols, v.cols);
      rows = Math.min(rows, v.rows);
    }
    if (!Number.isFinite(cols) || cols <= 0) cols = 80;
    if (!Number.isFinite(rows) || rows <= 0) rows = 30;
    return { cols, rows };
  }

  private applySize(s: Session): void {
    const { cols, rows } = this.negotiate(s);
    s.pty.resize(cols, rows);
    this.sink.onSize(s.info.id, cols, rows);
  }
}
