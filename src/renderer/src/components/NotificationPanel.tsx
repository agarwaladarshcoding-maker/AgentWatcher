import { useState } from "react";
import { useSessions } from "../store/sessions";

/**
 * The permission control plane (architecture doc §3, §12). Surfaces the agent's
 * OWN blocking prompt as a friendly card; Allow/Deny just writes y/n bytes to
 * the PTY (no OS interception, §18). Verdicts move to the Responded tab.
 */
export function NotificationPanel(): JSX.Element {
  const activeId = useSessions((s) => s.activeId);
  const pending = useSessions((s) =>
    activeId ? (s.pending[activeId] ?? []) : [],
  );
  const responded = useSessions((s) =>
    activeId ? (s.responded[activeId] ?? []) : [],
  );
  const [tab, setTab] = useState<"pending" | "responded">("pending");

  const respond = (permissionId: string, decision: "allow" | "deny"): void => {
    if (activeId) window.agentwatch.respond(activeId, permissionId, decision);
  };

  const time = (ts: number): string => {
    const d = new Date(ts);
    const p = (n: number): string => String(n).padStart(2, "0");
    return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  };

  return (
    <section className="notif-panel" aria-label="Notifications">
      <header className="panel-header notif-tabs">
        <button
          className={`notif-tab ${tab === "pending" ? "active" : ""}`}
          onClick={() => setTab("pending")}
        >
          Pending
          {pending.length > 0 && (
            <span className="tab-count warn">{pending.length}</span>
          )}
        </button>
        <button
          className={`notif-tab ${tab === "responded" ? "active" : ""}`}
          onClick={() => setTab("responded")}
        >
          Responded
          {responded.length > 0 && (
            <span className="tab-count">{responded.length}</span>
          )}
        </button>
      </header>

      <div className="notif-body">
        {tab === "pending" ? (
          pending.length === 0 ? (
            <p className="notif-empty">No pending notifications.</p>
          ) : (
            pending.map((p) => (
              <div key={p.id} className="pending-card">
                <div className="pending-head">
                  <span className="pending-icon" aria-hidden="true">
                    !
                  </span>
                  <span className="pending-title">{p.title}</span>
                  <span className="pending-source">{p.source}</span>
                </div>
                <pre className="pending-body">{p.rawPrompt}</pre>
                <div className="pending-actions">
                  <button
                    className="btn-allow"
                    onClick={() => respond(p.id, "allow")}
                  >
                    Allow
                  </button>
                  <button
                    className="btn-deny"
                    onClick={() => respond(p.id, "deny")}
                  >
                    Deny
                  </button>
                </div>
              </div>
            ))
          )
        ) : responded.length === 0 ? (
          <p className="notif-empty">Nothing responded yet.</p>
        ) : (
          responded.map((item) => (
            <div key={item.permission.id} className="responded-card">
              <span
                className={`verdict-chip ${item.verdict.decision}`}
                aria-hidden="true"
              >
                {item.verdict.decision === "allow" ? "✓ Allowed" : "✕ Denied"}
              </span>
              <span className="responded-prompt">
                {item.permission.rawPrompt || "permission"}
              </span>
              <time className="responded-time">{time(item.verdict.ts)}</time>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
