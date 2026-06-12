import { useState } from "react";
import { useSessions } from "../store/sessions";
import type {
  PendingPermission,
  RespondedPermission,
} from "../../../shared/types";

/**
 * The permission control plane (architecture doc §16.5 right column, Phase 3).
 * Pending tab: answer the agent's own blocking prompt from a friendlier surface
 * — Allow/Deny for confirms, one button per parsed option for menus, plus a
 * free-text field to send a custom response (all of which just write to the
 * PTY, exactly like typing in the mirror). Responded tab: the audit trail.
 */
function formatTime(ts: number): string {
  const d = new Date(ts);
  const p = (n: number): string => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

function respond(
  sessionId: string,
  permissionId: string,
  action: Parameters<typeof window.agentwatch.respondPermission>[2],
): void {
  window.agentwatch.respondPermission(sessionId, permissionId, action);
  // Optimistic: main removes it from its pending set on respond and emits the
  // verdict separately, so drop it locally now for a snappy UI.
  useSessions.getState().removePending(sessionId, permissionId);
}

function PendingCard({
  sessionId,
  permission,
  isTop,
}: {
  sessionId: string;
  permission: PendingPermission;
  isTop: boolean;
}): JSX.Element {
  const [custom, setCustom] = useState("");

  const sendCustom = (): void => {
    const text = custom.trim();
    if (!text) return;
    respond(sessionId, permission.id, { type: "custom", text });
    setCustom("");
  };

  return (
    <li className={`pending-card ${isTop ? "is-top" : ""}`}>
      <div className="pending-head">
        <span className="pending-icon" aria-hidden="true" />
        <span className="pending-title">{permission.title}</span>
        <span className="pending-source">{permission.source}</span>
      </div>

      {permission.rawPrompt && (
        <pre className="pending-body">{permission.rawPrompt}</pre>
      )}

      <div className="pending-actions">
        {permission.kind === "choice" && permission.choices ? (
          permission.choices.map((choice) => (
            <button
              key={choice.send}
              className="btn btn-choice"
              onClick={() =>
                respond(sessionId, permission.id, {
                  type: "choice",
                  send: choice.send,
                  label: choice.label,
                })
              }
            >
              {choice.label}
            </button>
          ))
        ) : (
          <>
            <button
              className="btn btn-allow"
              onClick={() =>
                respond(sessionId, permission.id, { type: "allow" })
              }
            >
              Allow
            </button>
            <button
              className="btn btn-deny"
              onClick={() =>
                respond(sessionId, permission.id, { type: "deny" })
              }
            >
              Deny
            </button>
          </>
        )}
      </div>

      <div className="pending-custom">
        <input
          className="pending-custom-input"
          value={custom}
          placeholder="Type a custom response…"
          onChange={(e) => setCustom(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              sendCustom();
            }
          }}
          aria-label="Custom response"
        />
        <button className="btn" onClick={sendCustom} disabled={!custom.trim()}>
          Send
        </button>
      </div>
      <p className="pending-hint">
        Or just answer in the terminal — both paths work.
      </p>
    </li>
  );
}

function RespondedCard({
  responded,
}: {
  responded: RespondedPermission;
}): JSX.Element {
  const chip =
    responded.decision === "allow"
      ? "allow"
      : responded.decision === "deny"
        ? "deny"
        : "neutral";
  return (
    <li className="responded-card">
      <div className="responded-main">
        <div className="responded-title">{responded.title}</div>
        <div className="responded-sub">{responded.source}</div>
      </div>
      <span className={`verdict-chip ${chip}`}>{responded.label}</span>
      <time className="responded-time">{formatTime(responded.decidedAt)}</time>
    </li>
  );
}

export function NotificationPanel(): JSX.Element {
  const activeId = useSessions((s) => s.activeId);
  const pending = useSessions((s) =>
    activeId ? (s.pending[activeId] ?? []) : [],
  );
  const responded = useSessions((s) =>
    activeId ? (s.responded[activeId] ?? []) : [],
  );
  const [tab, setTab] = useState<"pending" | "responded">("pending");

  return (
    <section className="notif-panel" aria-label="Notifications">
      <div className="notif-tabs" role="tablist">
        <button
          role="tab"
          aria-selected={tab === "pending"}
          className={`notif-tab ${tab === "pending" ? "active" : ""}`}
          onClick={() => setTab("pending")}
        >
          Pending
          {pending.length > 0 && (
            <span className="tab-count">{pending.length}</span>
          )}
        </button>
        <button
          role="tab"
          aria-selected={tab === "responded"}
          className={`notif-tab ${tab === "responded" ? "active" : ""}`}
          onClick={() => setTab("responded")}
        >
          Responded
          {responded.length > 0 && (
            <span className="tab-count">{responded.length}</span>
          )}
        </button>
      </div>

      {tab === "pending" ? (
        <ul className="notif-list" aria-live="polite">
          {pending.length === 0 ? (
            <li className="notif-empty">No pending notifications.</li>
          ) : (
            pending.map((p, i) => (
              <PendingCard
                key={p.id}
                sessionId={activeId as string}
                permission={p}
                isTop={i === 0}
              />
            ))
          )}
        </ul>
      ) : (
        <ul className="notif-list">
          {responded.length === 0 ? (
            <li className="notif-empty">Nothing responded yet.</li>
          ) : (
            responded.map((r) => <RespondedCard key={r.id} responded={r} />)
          )}
        </ul>
      )}
    </section>
  );
}
