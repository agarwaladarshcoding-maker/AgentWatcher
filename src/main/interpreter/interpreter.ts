import stripAnsi from "strip-ansi";
import type {
  AgentState,
  FeedEvent,
  PendingPermission,
  PermissionChoice,
} from "../../shared/types";
import type { AgentProfile } from "./profiles/types";

/**
 * The interpreter turns a tee'd copy of the PTY stream into a SIMPLE, robust
 * state — plus permission prompts — "the words" (architecture doc §4.2, §4.3).
 *
 * State is derived from the FLOW of output, not fragile per-CLI regexes:
 *
 *   - Output is streaming            → working
 *   - Output went quiet after work   → completed  (a "finished a turn" pulse)
 *   - …and stays quiet a bit longer  → idle
 *   - A permission prompt is detected → waiting   (overrides; control plane)
 *
 * This works for ANY agent (gemini, claude, kiro, bash, …) because every agent
 * produces output while busy and falls silent when it hands control back. No
 * profile tuning is needed for state; profiles only describe permission prompts.
 *
 * Invariants (§18): runs on a COPY only, never mutates/delays/reorders the
 * mirror, and swallows its own errors so interpretation can never break the
 * terminal.
 */

const STATE_TITLES: Record<AgentState, string> = {
  idle: "Idle",
  working: "Working",
  waiting: "Waiting for input",
  completed: "Completed",
};

// A numbered menu option line, e.g. "  1. Full Search", "❯ 2. Yes", "● 3. …".
const CHOICE_LINE = /^[●❯>*\-]?\s*(\d{1,2})[.)]\s+(\S.*)$/;

export interface InterpreterEmit {
  onState: (state: AgentState) => void;
  onEvent: (event: FeedEvent) => void;
  /** A new permission prompt is blocking the agent. */
  onPermission: (permission: PendingPermission) => void;
  /** The active permission was cleared without an explicit UI verdict. */
  onPermissionResolved: (permissionId: string) => void;
}

/** Timing thresholds for the activity-based state machine (overridable for tests). */
export interface InterpreterOptions {
  /** Quiet time after output stops before a working burst is "completed". */
  quietMs?: number;
  /** Quiet time after "completed" before settling back to "idle". */
  idleMs?: number;
  /** A burst shorter than this AND smaller than minWorkBytes won't fire "completed". */
  minWorkMs?: number;
  minWorkBytes?: number;
  /** How often the timer re-evaluates the state. */
  tickMs?: number;
}

function envNum(key: string, fallback: number): number {
  const v = Number(process.env[key]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

let sequence = 0;
function nextId(): string {
  sequence += 1;
  return `e${Date.now().toString(36)}-${sequence.toString(36)}`;
}

function makeEvent(partial: Omit<FeedEvent, "id" | "ts">): FeedEvent {
  return { id: nextId(), ts: Date.now(), ...partial };
}

export class Interpreter {
  private buffer = "";
  private state: AgentState = "idle";
  private activePermission: PendingPermission | null = null;
  private activePermissionHash: string | null = null;

  // Activity tracking for the timing-based state machine.
  private lastOutputAt = 0;
  private workStartedAt = 0;
  private workBytes = 0;
  private timer: ReturnType<typeof setInterval> | null = null;

  private static readonly MAX_BUFFER = 8192;
  private readonly quietMs: number;
  private readonly idleMs: number;
  private readonly minWorkMs: number;
  private readonly minWorkBytes: number;
  private readonly tickMs: number;

  constructor(
    private readonly profile: AgentProfile,
    private readonly emit: InterpreterEmit,
    options?: InterpreterOptions,
  ) {
    this.quietMs = options?.quietMs ?? envNum("AGENTWATCH_QUIET_MS", 700);
    this.idleMs = options?.idleMs ?? envNum("AGENTWATCH_IDLE_MS", 1500);
    this.minWorkMs = options?.minWorkMs ?? envNum("AGENTWATCH_MIN_WORK_MS", 350);
    this.minWorkBytes =
      options?.minWorkBytes ?? envNum("AGENTWATCH_MIN_WORK_BYTES", 24);
    this.tickMs = options?.tickMs ?? envNum("AGENTWATCH_TICK_MS", 200);
  }

  /** Feed a tee'd copy of a raw PTY chunk. Strips ANSI internally. */
  feed(chunk: string): void {
    try {
      const clean = stripAnsi(chunk);
      this.buffer = (this.buffer + clean).slice(-Interpreter.MAX_BUFFER);
      const now = Date.now();

      // Permission is the most specific signal; test the whole tail since a
      // prompt can span chunk boundaries.
      let permissionMatch: string | null = null;
      for (const re of this.profile.match.permission) {
        const m = this.buffer.match(re);
        if (m) {
          permissionMatch = m[0];
          break;
        }
      }
      if (permissionMatch) {
        this.notePermission(permissionMatch);
        this.setState("waiting");
        return;
      }

      // Any output at all is "activity". The agent visibly moved on, so a prompt
      // it was blocking on has been answered (in the terminal or by us).
      if (clean.length > 0) {
        if (this.activePermission && clean.trim().length > 0) {
          this.resolveActivePermission();
        }
        this.lastOutputAt = now;
        if (this.state === "working") {
          this.workBytes += clean.length;
        } else {
          this.workStartedAt = now;
          this.workBytes = clean.length;
          this.setState("working");
        }
        this.ensureTimer();
      }
    } catch {
      // Interpretation must never break the mirror.
    }
  }

  /** Periodic re-evaluation: working → completed → idle based on quiet time. */
  private tick(): void {
    try {
      const now = Date.now();
      const quietFor = now - this.lastOutputAt;

      if (this.state === "working" && quietFor >= this.quietMs) {
        const burstMs = this.lastOutputAt - this.workStartedAt;
        const meaningful =
          this.workBytes >= this.minWorkBytes || burstMs >= this.minWorkMs;
        this.workBytes = 0;
        if (meaningful) {
          this.setState("completed");
        } else {
          // Trivial blip (e.g. a couple of echoed keystrokes) → just rest.
          this.setState("idle", false);
          this.stopTimerIfResting();
        }
      } else if (this.state === "completed" && quietFor >= this.idleMs) {
        this.setState("idle", false);
        this.stopTimerIfResting();
      } else if (this.state === "idle" || this.state === "waiting") {
        this.stopTimerIfResting();
      }
    } catch {
      /* never break the mirror */
    }
  }

  sessionStart(pid: number, command: string): void {
    this.buffer = "";
    this.state = "idle";
    this.activePermission = null;
    this.activePermissionHash = null;
    this.workBytes = 0;
    this.emit.onEvent(
      makeEvent({
        kind: "session_start",
        title: "Session started",
        detail: `pid ${pid} · ${command}`,
      }),
    );
    this.emit.onState("idle");
  }

  sessionEnd(code: number, signal?: number): void {
    if (this.activePermission) this.resolveActivePermission();
    this.stopTimer();
    const sig = signal ? `, signal ${signal}` : "";
    this.emit.onEvent(
      makeEvent({
        kind: "session_end",
        title: "Session ended",
        detail: `exit code ${code}${sig}`,
      }),
    );
    this.state = "completed";
    this.emit.onState("completed");
  }

  /** Release the timer (call when the session is gone). */
  dispose(): void {
    this.stopTimer();
  }

  /**
   * Called when the UI (or terminal) has answered the active permission, so the
   * interpreter forgets it and can detect the next prompt cleanly.
   */
  acknowledgeResolved(permissionId: string): void {
    if (this.activePermission && this.activePermission.id === permissionId) {
      this.activePermission = null;
      this.activePermissionHash = null;
    }
  }

  private resolveActivePermission(): void {
    const p = this.activePermission;
    if (!p) return;
    this.activePermission = null;
    this.activePermissionHash = null;
    this.emit.onPermissionResolved(p.id);
  }

  private ensureTimer(): void {
    if (!this.timer) {
      this.timer = setInterval(() => this.tick(), this.tickMs);
      // Don't keep the event loop alive just for interpretation.
      (this.timer as { unref?: () => void }).unref?.();
    }
  }

  private stopTimer(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private stopTimerIfResting(): void {
    if (this.state === "idle") this.stopTimer();
  }

  /** Move to a state; emit onState always, and a feed event for non-idle states. */
  private setState(next: AgentState, emitEvent = true): void {
    if (next === this.state) return;
    this.state = next;
    this.emit.onState(next);
    if (emitEvent && next !== "idle") {
      this.emit.onEvent(
        makeEvent({
          kind: "state_change",
          state: next,
          title: STATE_TITLES[next],
        }),
      );
    }
  }

  /** Parse a numbered menu out of the buffer tail (for "choice" prompts). */
  private parseChoices(): PermissionChoice[] {
    const lines = this.buffer.split(/\r?\n/);
    const byNum = new Map<number, string>();
    for (const raw of lines) {
      const cleaned = raw.replace(/[│|┃╮╯╰╭┌┐└┘]/g, " ").trim();
      const m = cleaned.match(CHOICE_LINE);
      if (!m) continue;
      const n = Number.parseInt(m[1], 10);
      if (n < 1 || n > 12) continue;
      const label = m[2]
        .replace(/\s{2,}.*$/, "")
        .replace(/\s+\(esc\)$/i, "")
        .trim();
      if (label) byNum.set(n, label.slice(0, 64));
    }
    if (byNum.size < 2) return [];
    return [...byNum.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([n, label]) => ({ label: `${n}. ${label}`, send: `${n}\r` }));
  }

  /** A short, human-readable snapshot of the prompt for the card body. */
  private promptSnapshot(): string {
    const lines = this.buffer
      .split(/\r?\n/)
      .map((l) => l.replace(/[│|┃╮╯╰╭┌┐└┘]/g, "").trimEnd())
      .filter((l) => l.trim() !== "");
    return lines.slice(-6).join("\n").trim().slice(0, 600);
  }

  private notePermission(raw: string): void {
    const choices = this.parseChoices();
    const snapshot = this.promptSnapshot();
    const hash = `${raw.trim().slice(0, 120)}::${choices.length}`;
    if (hash === this.activePermissionHash) return; // same prompt still showing
    if (this.activePermission) this.resolveActivePermission(); // a new prompt replaced it
    this.activePermissionHash = hash;

    const kind: PendingPermission["kind"] =
      choices.length >= 2 ? "choice" : "confirm";
    const permission: PendingPermission = {
      id: nextId(),
      ts: Date.now(),
      title: this.permissionTitle(raw, kind),
      source: this.profile.name,
      rawPrompt: snapshot || raw.trim(),
      kind,
      choices: kind === "choice" ? choices : undefined,
      allowInput: this.profile.responses.allow,
      denyInput: this.profile.responses.deny,
    };
    this.activePermission = permission;

    this.emit.onPermission(permission);
    this.emit.onEvent(
      makeEvent({
        kind: "permission_needed",
        state: "waiting",
        title: permission.title,
        detail: raw.trim().slice(0, 120),
      }),
    );
  }

  private permissionTitle(raw: string, kind: PendingPermission["kind"]): string {
    const lower = raw.toLowerCase();
    if (/\b(write|edit|create|replace|patch|apply)\b/.test(lower))
      return "Write permission needed";
    if (/\b(run|execute|exec|command|shell)\b/.test(lower))
      return "Run permission needed";
    if (/\bdelete|remove\b/.test(lower)) return "Delete permission needed";
    if (kind === "choice") return "Agent needs a decision";
    return "Permission needed";
  }
}
