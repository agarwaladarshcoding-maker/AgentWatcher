import stripAnsi from "strip-ansi";
import type { AgentState, FeedEvent } from "../../shared/types";
import type { AgentProfile } from "./profiles/types";

/**
 * The interpreter turns a tee'd, ANSI-stripped copy of the PTY stream into
 * structured state + feed events — "the words" (architecture doc §4.2, §20).
 *
 * Invariants it must honor (§18):
 *   - Runs on a COPY only. Never mutates, delays, buffers, or reorders the
 *     mirror stream — feed() is called after the verbatim bytes already left.
 *   - If anything throws, the mirror keeps working: feed() swallows its errors.
 *
 * State resolution is most-specific-wins (§21):
 *   permission > waiting > writing > thinking > reading > done > idle
 *
 * For reading/writing it also extracts the file being touched so the event feed
 * can say *which* file (e.g. "Reading · src/auth/login.js").
 */
const STATE_PRIORITY: AgentState[] = [
  "waiting",
  "writing",
  "thinking",
  "reading",
  "done",
  "idle",
];

const STATE_TITLES: Record<AgentState, string> = {
  idle: "Idle",
  reading: "Reading",
  thinking: "Thinking",
  writing: "Writing",
  waiting: "Waiting for input",
  done: "Done",
};

// A path-ish token: optional dirs, a name, and a letter-initial extension
// (so version numbers like "v1.0" are not mistaken for files).
const FILE_TOKEN = /[^\s"'`()[\]]+\.[A-Za-z][A-Za-z0-9]{0,7}\b/g;

export interface InterpreterEmit {
  onState: (state: AgentState) => void;
  onEvent: (event: FeedEvent) => void;
  /** A permission prompt was detected; raw is the matched prompt text. */
  onPermission: (raw: string) => void;
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
  private currentState: AgentState | null = null;
  private lastTarget: string | null = null;
  private lastPermissionHash: string | null = null;
  private static readonly MAX_BUFFER = 8192;
  private static readonly SCAN_LINES = 10;
  private static readonly PERM_TAIL = 400;

  constructor(
    private readonly profile: AgentProfile,
    private readonly emit: InterpreterEmit,
  ) {}

  /** Feed a tee'd copy of a raw PTY chunk. Strips ANSI internally. */
  feed(chunk: string): void {
    try {
      this.buffer = (this.buffer + stripAnsi(chunk)).slice(
        -Interpreter.MAX_BUFFER,
      );

      // Permission is the most specific signal. Only treat it as LIVE when the
      // prompt is at the tail of the buffer (the agent just printed it). Once
      // output appears after it (answered / scrolled), it's stale — we clear the
      // de-dupe key so a later, genuine re-ask fires again.
      const tail = this.buffer.slice(-Interpreter.PERM_TAIL);
      let permissionMatch: string | null = null;
      for (const re of this.profile.match.permission) {
        const m = tail.match(re);
        if (m) {
          permissionMatch = m[0];
          break;
        }
      }

      if (permissionMatch) {
        this.transition("waiting");
        this.notePermission(permissionMatch);
        return;
      }
      this.lastPermissionHash = null;

      // Otherwise scan the most RECENT classifiable line (newest-first). The very
      // last line is often a prompt box / spinner frame with no signal; skipping
      // to the newest meaningful line tracks TUI agents far better than only
      // looking at the final line.
      const recent = this.recentLines(Interpreter.SCAN_LINES);
      for (const line of recent) {
        const state = this.classify(line);
        if (state) {
          const target =
            (state === "reading" || state === "writing") && line
              ? this.extractTarget(line)
              : undefined;
          this.transition(state, target);
          break;
        }
      }
    } catch {
      // Interpretation must never break the mirror.
    }
  }

  /** Discard the permission de-dupe key (after a verdict, so a repeat re-fires). */
  clearPermission(): void {
    this.lastPermissionHash = null;
  }

  /** Emit the session-start event and reset to idle. */
  sessionStart(pid: number, command: string): void {
    this.buffer = "";
    this.currentState = null;
    this.lastTarget = null;
    this.lastPermissionHash = null;
    this.emit.onEvent(
      makeEvent({
        kind: "session_start",
        title: "Session started",
        detail: `pid ${pid} · ${command}`,
      }),
    );
    this.transition("idle");
  }

  sessionEnd(code: number, signal?: number): void {
    const sig = signal ? `, signal ${signal}` : "";
    this.emit.onEvent(
      makeEvent({
        kind: "session_end",
        title: "Session ended",
        detail: `exit code ${code}${sig}`,
      }),
    );
    this.transition("done");
  }

  /** The last `limit` non-empty lines, newest first. */
  private recentLines(limit: number): string[] {
    const out: string[] = [];
    const lines = this.buffer.split(/\r?\n/);
    for (let i = lines.length - 1; i >= 0 && out.length < limit; i -= 1) {
      const trimmed = lines[i].trim();
      if (trimmed !== "") out.push(trimmed);
    }
    return out;
  }

  private classify(line: string): AgentState | null {
    for (const state of STATE_PRIORITY) {
      const regexes = this.profile.match.state[state];
      if (regexes && regexes.some((r) => r.test(line))) return state;
    }
    return null;
  }

  /** Pull the most likely file path out of a line, if any. */
  private extractTarget(line: string): string | undefined {
    const tokens = line.match(FILE_TOKEN);
    if (!tokens || tokens.length === 0) return undefined;
    // The last token is usually the operand (e.g. "Reading file src/app.ts").
    return tokens[tokens.length - 1];
  }

  /**
   * Move to a state and/or a new target. Emits a state event when the state
   * changes OR when the same state touches a new file, so the feed lists each
   * file (e.g. several "Reading" entries with different detail).
   */
  private transition(state: AgentState, target?: string): void {
    const stateChanged = state !== this.currentState;
    const targetChanged = Boolean(target) && target !== this.lastTarget;
    if (!stateChanged && !targetChanged) return;

    this.currentState = state;
    if (target) this.lastTarget = target;

    if (stateChanged) this.emit.onState(state);

    this.emit.onEvent(
      makeEvent({
        kind: "state_change",
        state,
        title: STATE_TITLES[state],
        detail: target,
      }),
    );
  }

  private notePermission(raw: string): void {
    const hash = raw.trim().slice(0, 120);
    if (hash === this.lastPermissionHash) return;
    this.lastPermissionHash = hash;
    this.emit.onEvent(
      makeEvent({
        kind: "permission_needed",
        state: "waiting",
        title: "Permission needed",
        detail: hash,
      }),
    );
    this.emit.onPermission(raw);
  }
}
