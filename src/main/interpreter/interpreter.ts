import stripAnsi from "strip-ansi";
import type {
  AgentState,
  FeedEvent,
  PendingPermission,
  PermissionChoice,
} from "../../shared/types";
import type { AgentProfile } from "./profiles/types";

/**
 * The interpreter turns a tee'd, ANSI-stripped copy of the PTY stream into
 * structured state + feed events + permission prompts — "the words"
 * (architecture doc §4.2, §4.3, §20).
 *
 * Invariants it must honor (§18):
 *   - Runs on a COPY only. Never mutates, delays, buffers, or reorders the
 *     mirror stream — feed() is called after the verbatim bytes already left.
 *   - If anything throws, the mirror keeps working: feed() swallows its errors.
 *
 * State resolution is most-specific-wins (§21):
 *   permission > waiting > writing > thinking > reading > done > idle
 *
 * Permission handling (Phase 3): when a permission/choice prompt is detected it
 * emits a structured PendingPermission (with parsed options when it's a menu).
 * It resolves the pending one when the agent visibly moves on (a non-waiting
 * state), so a prompt answered directly in the terminal also clears the panel.
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

// A numbered menu option line, e.g. "  1. Full Search", "❯ 2. Yes", "● 3. …".
// Leading box/markers are stripped before matching.
const CHOICE_LINE = /^[●❯>*\-]?\s*(\d{1,2})[.)]\s+(\S.*)$/;

export interface InterpreterEmit {
  onState: (state: AgentState) => void;
  onEvent: (event: FeedEvent) => void;
  /** A new permission prompt is blocking the agent. */
  onPermission: (permission: PendingPermission) => void;
  /** The active permission was cleared without an explicit UI verdict. */
  onPermissionResolved: (permissionId: string) => void;
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
  private activePermission: PendingPermission | null = null;
  private activePermissionHash: string | null = null;
  private static readonly MAX_BUFFER = 8192;

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
        this.transition("waiting");
        return;
      }

      const line = this.lastNonEmptyLine();
      const next = line ? this.classify(line) : null;

      // A concrete non-waiting state means the agent moved on → the prompt it
      // was blocking on has been answered (in the terminal or by us).
      if (next && next !== "waiting" && this.activePermission) {
        this.resolveActivePermission();
      }

      if (next) {
        const target =
          (next === "reading" || next === "writing") && line
            ? this.extractTarget(line)
            : undefined;
        this.transition(next, target);
      }
    } catch {
      // Interpretation must never break the mirror.
    }
  }

  sessionStart(pid: number, command: string): void {
    this.buffer = "";
    this.currentState = null;
    this.lastTarget = null;
    this.activePermission = null;
    this.activePermissionHash = null;
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
    if (this.activePermission) this.resolveActivePermission();
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

  /** Pull the most likely file path out of a line, if any. */
  private extractTarget(line: string): string | undefined {
    const tokens = line.match(FILE_TOKEN);
    if (!tokens || tokens.length === 0) return undefined;
    // The last token is usually the operand (e.g. "Reading file src/app.ts").
    return tokens[tokens.length - 1];
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
      // Trim long descriptions/hints so buttons stay compact.
      const label = m[2].replace(/\s{2,}.*$/, "").replace(/\s+\(esc\)$/i, "").trim();
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
    const choices = this.parseChoices();
    const snapshot = this.promptSnapshot();
    const hash = `${raw.trim().slice(0, 120)}::${choices.length}`;
    if (hash === this.activePermissionHash) return; // same prompt still showing
    if (this.activePermission) this.resolveActivePermission(); // a new prompt replaced it
    this.activePermissionHash = hash;

    const kind: PendingPermission["kind"] = choices.length >= 2 ? "choice" : "confirm";
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
