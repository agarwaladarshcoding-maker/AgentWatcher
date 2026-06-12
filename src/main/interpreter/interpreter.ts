import stripAnsi from "strip-ansi";
import type { AgentState, FeedEvent } from "../../shared/types";
import type { AgentProfile } from "./profiles/types";

/**
 * The interpreter turns a tee'd, ANSI-stripped copy of the PTY stream into
 * structured state + feed events — "the words" (architecture doc §4.2, §20).
 *
 * Invariants it must honor (§18):
 *   - It runs on a COPY only. It never mutates, delays, buffers, or reorders the
 *     mirror stream — `feed()` is called after the verbatim bytes have already
 *     gone to the mirror.
 *   - If anything throws, the mirror keeps working: feed() swallows its errors.
 *
 * State resolution is most-specific-wins (§21):
 *   permission > waiting > writing > thinking > reading > done > idle
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

export interface InterpreterEmit {
  onState: (state: AgentState) => void;
  onEvent: (event: FeedEvent) => void;
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
  private lastPermissionHash: string | null = null;
  private static readonly MAX_BUFFER = 8192;

  constructor(
    private readonly profile: AgentProfile,
    private readonly emit: InterpreterEmit,
  ) {}

  /** Feed a tee'd copy of a raw PTY chunk. Strips ANSI internally. */
  feed(chunk: string): void {
    try {
      // Keep a bounded tail so memory never grows; lines may arrive split.
      this.buffer = (this.buffer + stripAnsi(chunk)).slice(
        -Interpreter.MAX_BUFFER,
      );

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

      // Resolve the next state: a live permission prompt means "waiting";
      // otherwise classify the last non-empty line.
      let next: AgentState | null = null;
      if (permissionMatch) {
        next = "waiting";
      } else {
        const line = this.lastNonEmptyLine();
        if (line) next = this.classify(line);
      }
      if (next) this.setState(next);

      // Emit a permission_needed feed entry (de-duplicated). The full pending
      // card + Allow/Deny loop is the Phase 3 control plane.
      if (permissionMatch) this.notePermission(permissionMatch);
    } catch {
      // Interpretation must never break the mirror.
    }
  }

  /** Emit the session-start event and reset to idle. */
  sessionStart(pid: number, command: string): void {
    this.buffer = "";
    this.currentState = null;
    this.lastPermissionHash = null;
    this.emit.onEvent(
      makeEvent({
        kind: "session_start",
        title: "Session started",
        detail: `pid ${pid} · ${command}`,
      }),
    );
    this.setState("idle");
  }

  /** Emit the session-end event and move to done. */
  sessionEnd(code: number, signal?: number): void {
    const sig = signal ? `, signal ${signal}` : "";
    this.emit.onEvent(
      makeEvent({
        kind: "session_end",
        title: "Session ended",
        detail: `exit code ${code}${sig}`,
      }),
    );
    this.setState("done");
  }

  private lastNonEmptyLine(): string | null {
    const lines = this.buffer.split(/\r?\n/);
    for (let i = lines.length - 1; i >= 0; i -= 1) {
      if (lines[i].trim() !== "") return lines[i];
    }
    return null;
  }

  private classify(line: string): AgentState | null {
    for (const state of STATE_PRIORITY) {
      const regexes = this.profile.match.state[state];
      if (regexes && regexes.some((r) => r.test(line))) return state;
    }
    return null;
  }

  private setState(state: AgentState): void {
    if (state === this.currentState) return;
    this.currentState = state;
    this.emit.onState(state);
    this.emit.onEvent(
      makeEvent({ kind: "state_change", state, title: STATE_TITLES[state] }),
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
  }
}
