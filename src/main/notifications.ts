import { Notification } from "electron";
import type {
  AppSettings,
  PendingPermission,
  PermissionAction,
} from "../shared/types";

/**
 * OS-level notifications for the permission control plane (Phase 3 + user ask).
 *
 * Two notification families, so the user always understands what happened at a
 * glance:
 *
 *   • PERMISSION ("⚠ needs you") — an agent is blocked waiting for a decision.
 *     On macOS it exposes Allow / Deny buttons and an inline reply field so the
 *     user can answer without opening the window. A single click focuses the
 *     app and switches to that session.
 *
 *   • COMPLETED ("✓ finished") — an agent's session ended. Informational; a
 *     click focuses the session so the user can review the result.
 *
 * Robustness (user asks):
 *   - DEDUPE: at most one live notification per (session, kind, subject). A
 *     repeat of the same prompt never stacks a second toast.
 *   - SIMILAR-TYPE GROUPING: notifications carry a stable per-session/kind tag,
 *     so a new one of the same family replaces the previous instead of piling
 *     up — the user is never buried in near-identical toasts.
 *   - AUTO-CLOSE: when a prompt is answered (here, in the panel, or in the
 *     terminal) we close its notification so nothing stale lingers.
 *   - NEVER MISS: every permission landing also fires a fallback attention cue
 *     (dock bounce + window flash + badge) so it is noticed even if the OS
 *     suppresses toasts (unsigned dev builds, Focus/Do-Not-Disturb, unsupported
 *     platforms).
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
  /** Bring the dashboard window to the front (used for browser-tab completions). */
  focusWindow?(): void;
}

export class NotificationCenter {
  /** Live notifications keyed by a stable tag (dedupe + group + close). */
  private readonly active = new Map<string, Notification>();

  constructor(
    private readonly deps: NotificationDeps,
    private settings: AppSettings,
  ) {}

  updateSettings(settings: AppSettings): void {
    this.settings = settings;
  }

  /** Stable tag for a permission prompt (one per session+permission). */
  private permissionKey(sessionId: string, permissionId: string): string {
    return `perm:${sessionId}:${permissionId}`;
  }

  /** Stable tag for a completion toast (one per session — replaces, never stacks). */
  private completedKey(sessionId: string): string {
    return `done:${sessionId}`;
  }

  /**
   * Raise (or replace) a notification under a stable tag. Replacing means a new
   * toast of the same family supersedes the old one rather than stacking.
   * Returns true if a toast was actually shown (false when the OS can't).
   */
  private raise(
    tag: string,
    opts: Electron.NotificationConstructorOptions,
    handlers: {
      onClick?: () => void;
      onAction?: (index: number) => void;
      onReply?: (reply: string) => void;
    },
  ): boolean {
    let supported = false;
    try {
      supported = Notification.isSupported();
    } catch {
      supported = false;
    }
    if (!supported) return false;

    // Replace any live toast under the same tag (grouping / no stacking).
    const existing = this.active.get(tag);
    if (existing) {
      this.active.delete(tag);
      try {
        existing.close();
      } catch {
        /* already gone */
      }
    }

    const n = new Notification(opts);
    const done = (): void => {
      if (this.active.get(tag) === n) this.active.delete(tag);
    };
    if (handlers.onClick) n.on("click", () => (handlers.onClick!(), done()));
    if (handlers.onAction)
      n.on("action", (_e, index) => (handlers.onAction!(index), done()));
    if (handlers.onReply)
      n.on("reply", (_e, reply) => (handlers.onReply!(reply), done()));
    n.on("close", done);

    this.active.set(tag, n);
    n.show();
    return true;
  }

  /**
   * An agent is blocked on a permission/decision prompt — alert the user.
   * Returns a status so the self-test can verify dedupe/grouping behaviour.
   */
  notify(
    sessionId: string,
    permission: PendingPermission,
  ): "raised" | "deduped" | "disabled" | "unsupported" {
    if (!this.settings.notifications) return "disabled";

    const tag = this.permissionKey(sessionId, permission.id);
    // DEDUPE: a live toast for this exact prompt already exists.
    if (this.active.has(tag)) return "deduped";

    // NEVER MISS: always raise a fallback cue, even if OS toasts are suppressed.
    try {
      this.deps.flashAttention();
    } catch {
      /* fallback is best-effort */
    }

    const confirm = permission.kind === "confirm";
    const actions = confirm
      ? [
          { type: "button" as const, text: "Allow" },
          { type: "button" as const, text: "Deny" },
        ]
      : [{ type: "button" as const, text: "Open" }];

    const shown = this.raise(
      tag,
      {
        title: `⚠ ${permission.title}`,
        subtitle: this.deps.label(sessionId),
        body:
          permission.rawPrompt.slice(0, 200) ||
          "An agent is waiting for your decision.",
        actions,
        hasReply: true,
        replyPlaceholder: "Type a response and press enter…",
        timeoutType: "never",
        urgency: "critical",
        silent: !this.settings.sound,
      },
      {
        // Single click → focus the app and switch to this session. Nothing else.
        onClick: () => this.deps.focus(sessionId),
        onAction: (index) => {
          this.deps.focus(sessionId);
          if (confirm) {
            if (index === 0)
              this.deps.respond(sessionId, permission.id, { type: "allow" });
            else if (index === 1)
              this.deps.respond(sessionId, permission.id, { type: "deny" });
          }
        },
        onReply: (reply) => {
          this.deps.focus(sessionId);
          if (reply && reply.trim().length > 0)
            this.deps.respond(sessionId, permission.id, {
              type: "custom",
              text: reply,
            });
        },
      },
    );
    return shown ? "raised" : "unsupported";
  }

  /** An agent finished a turn and is waiting for the user — a gentle "ready" toast. */
  notifyReady(
    sessionId: string,
    info: { commandLine: string },
  ): "raised" | "disabled" | "unsupported" {
    if (!this.settings.notifications || !this.settings.notifyOnComplete)
      return "disabled";

    const shown = this.raise(
      this.completedKey(sessionId),
      {
        title: "✓ Ready for you",
        subtitle: info.commandLine,
        body: "The agent finished and is waiting. Click to jump back to it.",
        timeoutType: "default",
        silent: !this.settings.sound,
      },
      { onClick: () => this.deps.focus(sessionId) },
    );
    return shown ? "raised" : "unsupported";
  }

  /**
   * A browser-based agent (watched by the Chrome extension) finished. Mirrors
   * the "ready" toast but for a tab; clicking it brings the app window forward
   * so the user can see the Chrome section. The actual jump-to-tab happens via
   * the card's "go to" button (which drives the bridge).
   */
  notifyBrowserCompleted(info: {
    tabId: number;
    label: string;
    snippet?: string;
  }): "raised" | "disabled" | "unsupported" {
    if (!this.settings.notifications || !this.settings.notifyOnComplete)
      return "disabled";
    const shown = this.raise(
      `browser-done:${info.tabId}`,
      {
        title: `✓ ${info.label} finished`,
        body: info.snippet?.slice(0, 120) || "The browser agent is done. Click to review it.",
        timeoutType: "default",
        silent: !this.settings.sound,
      },
      { onClick: () => this.deps.focusWindow?.() },
    );
    return shown ? "raised" : "unsupported";
  }

  /** An agent finished — a friendly "completed" toast (informational). */
  notifyCompleted(
    sessionId: string,
    info: { commandLine: string; exitCode: number },
  ): "raised" | "disabled" | "unsupported" {
    if (!this.settings.notifications || !this.settings.notifyOnComplete)
      return "disabled";

    const ok = info.exitCode === 0;
    const shown = this.raise(
      this.completedKey(sessionId),
      {
        title: `${ok ? "✓" : "✗"} Agent finished`,
        subtitle: info.commandLine,
        body: ok
          ? "The session completed successfully. Click to review it."
          : `The session exited with code ${info.exitCode}. Click to review it.`,
        timeoutType: "default",
        silent: !this.settings.sound,
      },
      { onClick: () => this.deps.focus(sessionId) },
    );
    return shown ? "raised" : "unsupported";
  }

  /** A prompt was answered (anywhere) or the session ended — close its toast. */
  resolve(sessionId: string, permissionId: string): void {
    const tag = this.permissionKey(sessionId, permissionId);
    const n = this.active.get(tag);
    if (!n) return;
    this.active.delete(tag);
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
