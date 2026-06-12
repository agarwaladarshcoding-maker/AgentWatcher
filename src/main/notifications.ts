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
 *   - on click, focuses the app and switches to the relevant session;
 *   - on macOS, exposes Allow / Deny action buttons and an inline reply field
 *     so the user can answer (button) OR write a custom response — mirroring the
 *     terminal prompt without opening the window.
 *
 * Action buttons + inline reply are macOS-only in Electron; elsewhere the basic
 * clickable notification still works, and the in-app panel always does. We
 * degrade gracefully and never assume support.
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
}

export class NotificationCenter {
  constructor(
    private readonly deps: NotificationDeps,
    private settings: AppSettings,
  ) {}

  updateSettings(settings: AppSettings): void {
    this.settings = settings;
  }

  notify(sessionId: string, permission: PendingPermission): void {
    if (!this.settings.notifications) return;
    try {
      if (!Notification.isSupported()) return;
    } catch {
      return;
    }

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
    });

    n.on("click", () => this.deps.focus(sessionId));

    n.on("action", (_event, index) => {
      this.deps.focus(sessionId);
      if (!confirm) return; // "Open" just focuses
      if (index === 0) {
        this.deps.respond(sessionId, permission.id, { type: "allow" });
      } else if (index === 1) {
        this.deps.respond(sessionId, permission.id, { type: "deny" });
      }
    });

    n.on("reply", (_event, reply) => {
      this.deps.focus(sessionId);
      if (reply && reply.trim().length > 0) {
        this.deps.respond(sessionId, permission.id, {
          type: "custom",
          text: reply,
        });
      }
    });

    n.show();
  }
}
