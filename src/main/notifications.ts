import { Notification } from "electron";
import type {
  AppSettings,
  PendingPermission,
  PermissionAction,
} from "../shared/types";

/**
 * OS-level notifications for the permission control plane (Phase 3 + user ask).
 *
 * When a permission lands we raise a native notification that:
 *   - on a single click, focuses the app and switches to the relevant session;
 *   - on macOS, exposes Allow / Deny action buttons and an inline reply field
 *     so the user can answer (button) OR write a custom response — mirroring the
 *     terminal prompt without opening the window.
 *
 * Robustness (user asks):
 *   - DEDUPE: at most one live notification per (session, permission). A repeat
 *     of the same prompt never stacks a second toast.
 *   - AUTO-CLOSE: when a prompt is answered (here, in the panel, or in the
 *     terminal) we close its notification so nothing stale lingers.
 *   - NEVER MISS: every landing also fires a fallback attention cue (dock bounce
 *     + window flash + badge) so it is noticed even if the OS suppresses toasts
 *     (unsigned dev builds, Focus/Do-Not-Disturb, unsupported platforms).
 */
export interface NotificationDeps {
  /** Focus the window and switch to the given session. */
  focus(sessionId: string): void;
  /** Answer a pending permission (writes to the PTY + logs the verdict). */
  respond(
    sessionId: string,
    permissionId: string,
    action: PermissionAction,
  ): void;
  /** A short human label for the session (e.g. the command line). */
  label(sessionId: string): string;
  /** Fallback attention cue (dock bounce / window flash) so a prompt is never missed. */
  flashAttention(): void;
}

export class NotificationCenter {
  /** Live notifications keyed by `${sessionId}:${permissionId}` (dedupe + close). */
  private readonly active = new Map<string, Notification>();

  constructor(
    private readonly deps: NotificationDeps,
    private settings: AppSettings,
  ) {}

  updateSettings(settings: AppSettings): void {
    this.settings = settings;
  }

  private key(sessionId: string, permissionId: string): string {
    return `${sessionId}:${permissionId}`;
  }

  notify(sessionId: string, permission: PendingPermission): void {
    if (!this.settings.notifications) return;

    const key = this.key(sessionId, permission.id);
    // DEDUPE: a live toast for this exact prompt already exists.
    if (this.active.has(key)) return;

    // NEVER MISS: always raise a fallback cue, even if OS toasts are suppressed.
    try {
      this.deps.flashAttention();
    } catch {
      /* fallback is best-effort */
    }

    let supported = false;
    try {
      supported = Notification.isSupported();
    } catch {
      supported = false;
    }
    if (!supported) return; // the in-app panel + flash still surface it

    const confirm = permission.kind === "confirm";
    const actions = confirm
      ? [
          { type: "button" as const, text: "Allow" },
          { type: "button" as const, text: "Deny" },
        ]
      : [{ type: "button" as const, text: "Open" }];

    const n = new Notification({
      title: `${permission.title} — ${this.deps.label(sessionId)}`,
      body: permission.rawPrompt.slice(0, 200) || "An agent is waiting for you.",
      actions,
      hasReply: true,
      replyPlaceholder: "Type a response and press enter…",
      timeoutType: "never",
      silent: !this.settings.sound,
    });

    const done = (): void => {
      this.active.delete(key);
    };

    // Single click → focus the app and switch to this session. Nothing else.
    n.on("click", () => {
      this.deps.focus(sessionId);
      done();
    });

    n.on("action", (_event, index) => {
      this.deps.focus(sessionId);
      if (confirm) {
        if (index === 0) {
          this.deps.respond(sessionId, permission.id, { type: "allow" });
        } else if (index === 1) {
          this.deps.respond(sessionId, permission.id, { type: "deny" });
        }
      }
      done();
    });

    n.on("reply", (_event, reply) => {
      this.deps.focus(sessionId);
      if (reply && reply.trim().length > 0) {
        this.deps.respond(sessionId, permission.id, {
          type: "custom",
          text: reply,
        });
      }
      done();
    });

    n.on("close", done);

    this.active.set(key, n);
    n.show();
  }

  /** A prompt was answered (anywhere) or the session ended — close its toast. */
  resolve(sessionId: string, permissionId: string): void {
    const key = this.key(sessionId, permissionId);
    const n = this.active.get(key);
    if (!n) return;
    this.active.delete(key);
    try {
      n.close();
    } catch {
      /* already gone */
    }
  }

  /** Close every live notification (e.g. on shutdown). */
  clearAll(): void {
    for (const n of this.active.values()) {
      try {
        n.close();
      } catch {
        /* ignore */
      }
    }
    this.active.clear();
  }
}
