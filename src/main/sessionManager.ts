import { PtyManager } from "./pty/ptyManager";
import { Interpreter } from "./interpreter/interpreter";
import { selectProfile } from "./interpreter/profiles";
import type { AgentProfile } from "./interpreter/profiles/types";
import type {
  AgentState,
  FeedEvent,
  SessionInfo,
  PendingPermission,
  Verdict,
} from "../shared/types";
import type { PtyExitInfo } from "../shared/ipc";

/**
 * SessionManager — owns every agent session (architecture multi-agent model).
 * One agent = one PTY = one PID; the manager holds many at once, each with its
 * own interpreter + profile. One OS process per agent (no double compute, §18);
 * its single stream is teed to all viewers.
 *
 * Size negotiation: a session can be viewed by the native terminal relay AND the
 * GUI mirror. A PTY has one size, so we make the GUI (the visible panel) the
 * authority when present — that keeps the on-screen mirror filling its panel —
 * falling back to the relay's native size before the GUI has reported.
 */
export interface SessionSink {
  onStart(info: SessionInfo): void;
  onData(id: string, chunk: string): void;
  onState(id: string, state: AgentState): void;
  onEvent(id: string, event: FeedEvent): void;
  onSize(id: string, cols: number, rows: number): void;
  onExit(id: string, info: PtyExitInfo): void;
  onPermission(id: string, permission: PendingPermission): void;
  onVerdict(id: string, verdict: Verdict): void;
  onListChanged(): void;
}

export interface CreateOptions {
  command: string;
  args: string[];
  cwd: string;
  cols: number;
  rows: number;
}

const GUI_VIEWER = "gui";

interface Session {
  info: SessionInfo;
  pty: PtyManager;
  interpreter: Interpreter;
  profile: AgentProfile;
  viewers: Map<string, { cols: number; rows: number }>;
  pending: Map<string, PendingPermission>;
}

export class SessionManager {
  private readonly sessions = new Map<string, Session>();
  private seq = 0;
  private permSeq = 0;
  private defaultResponses: { allow: string; deny: string } | null = null;

  constructor(private readonly sink: SessionSink) {}

  /** Override the per-profile allow/deny bytes from user settings (Phase 4). */
  setDefaultResponses(allow: string, deny: string): void {
    this.defaultResponses = { allow, deny };
  }

  list(): SessionInfo[] {
    return [...this.sessions.values()].map((s) => ({ ...s.info }));
  }

  has(id: string): boolean {
    return this.sessions.has(id);
  }

  /** Spawn a new agent session. `primaryViewerId` is the relay that requested it. */
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
      onEvent: (event) => this.sink.onEvent(id, event),
      onPermission: (raw) => this.handlePermission(id, raw),
    });

    const info: SessionInfo = {
      id,
      command: opts.command,
      args: opts.args,
      commandLine: commandLine || opts.command,
      label: commandLine || opts.command,
      profile: profile.name,
      pid: -1,
      state: "idle",
      startedAt: Date.now(),
      ended: false,
      nativeAttached: true,
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
      profile,
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
      session.pending.clear(); // agent gone: drop any unanswered prompts (§25)
      interpreter.sessionEnd(exit.code, exit.signal);
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
    this.sink.onStart({ ...info });
    this.sink.onListChanged();
    return { ...info };
  }

  write(id: string, data: string): void {
    this.sessions.get(id)?.pty.write(data);
  }

  /** A viewer reported its size; renegotiate the PTY size. */
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

  /** Answer a pending permission: write the profile's allow/deny bytes to stdin. */
  respond(id: string, permissionId: string, decision: "allow" | "deny"): void {
    const s = this.sessions.get(id);
    if (!s) return;
    const pending = s.pending.get(permissionId);
    if (!pending) return;
    s.pending.delete(permissionId);

    // No OS-level interception — the agent's own prompt is blocking; we only
    // write bytes to stdin (§18). Manual typing in either terminal still works.
    s.pty.write(decision === "allow" ? pending.allowInput : pending.denyInput);
    // The interpreter's tail-based detection clears itself once the answered
    // prompt scrolls past, so a genuine re-ask later still fires.

    const verdict: Verdict = {
      permissionId,
      decision,
      ts: Date.now(),
      rawPrompt: pending.rawPrompt,
    };
    this.sink.onVerdict(id, verdict);
    this.sink.onEvent(id, {
      id: `v${permissionId}`,
      ts: verdict.ts,
      kind: "verdict",
      title: decision === "allow" ? "Allowed" : "Denied",
      detail: pending.rawPrompt,
      state: decision === "allow" ? "writing" : undefined,
    });
  }

  /** Rename a session's user-facing label. */
  rename(id: string, name: string): void {
    const s = this.sessions.get(id);
    if (!s) return;
    const trimmed = name.trim();
    s.info.label = trimmed || s.info.commandLine;
    this.sink.onListChanged();
  }

  kill(id: string): void {
    this.sessions.get(id)?.pty.kill();
  }

  remove(id: string): void {
    this.sessions.delete(id);
    this.sink.onListChanged();
  }

  killAll(): void {
    for (const s of this.sessions.values()) s.pty.kill();
  }

  private handlePermission(id: string, raw: string): void {
    const s = this.sessions.get(id);
    if (!s) return;
    this.permSeq += 1;
    const norm = (v: string): string => (v.endsWith("\n") ? v : `${v}\n`);
    const allow = norm(this.defaultResponses?.allow ?? s.profile.responses.allow);
    const deny = norm(this.defaultResponses?.deny ?? s.profile.responses.deny);
    const permission: PendingPermission = {
      id: `p${this.permSeq}`,
      ts: Date.now(),
      title: "Permission requested",
      source: s.info.label,
      rawPrompt: raw.trim().slice(0, 240),
      allowInput: allow,
      denyInput: deny,
    };
    s.pending.set(permission.id, permission);
    this.sink.onPermission(id, permission);
  }

  /** GUI panel is the size authority when present; else the min of relays. */
  private negotiate(s: Session): { cols: number; rows: number } {
    const gui = s.viewers.get(GUI_VIEWER);
    if (gui && gui.cols > 0 && gui.rows > 0) return { ...gui };

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
