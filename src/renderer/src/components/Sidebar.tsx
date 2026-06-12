import { useState } from "react";
import { useSessions } from "../store/sessions";
import { ConfirmDialog } from "./ConfirmDialog";
import type { AgentState, SessionInfo } from "../../../shared/types";

const STATE_LABEL: Record<AgentState, string> = {
  idle: "Idle",
  reading: "Reading",
  thinking: "Thinking",
  writing: "Writing",
  waiting: "Waiting",
  done: "Done",
};

/**
 * Left sidebar: every running/finished agent, a search box to filter by the CLI
 * tool's name, one-click switching, a "+" to start a new terminal, a pending
 * pip per agent, and a safe close button (warns before terminating a live
 * session; just dismisses an ended one).
 */
export function Sidebar({
  onNewTerminal,
}: {
  onNewTerminal: () => void;
}): JSX.Element {
  const sessions = useSessions((s) => s.sessions);
  const activeId = useSessions((s) => s.activeId);
  const states = useSessions((s) => s.states);
  const pending = useSessions((s) => s.pending);
  const setActive = useSessions((s) => s.setActive);

  const [query, setQuery] = useState("");
  const [confirm, setConfirm] = useState<SessionInfo | null>(null);

  const q = query.trim().toLowerCase();
  const filtered = q
    ? sessions.filter(
        (s) =>
          s.commandLine.toLowerCase().includes(q) ||
          s.command.toLowerCase().includes(q) ||
          s.profile.toLowerCase().includes(q),
      )
    : sessions;

  // Ended → dismiss (remove the record). Running → confirm before terminating.
  const onClose = (s: SessionInfo): void => {
    if (s.ended) window.agentwatch.remove(s.id);
    else setConfirm(s);
  };

  return (
    <nav className="sidebar" aria-label="Agents">
      <div className="sidebar-head">
        <span className="sidebar-title">Agents</span>
        <span className="sidebar-count">{sessions.length}</span>
        <button
          className="new-terminal-btn"
          onClick={onNewTerminal}
          aria-label="New terminal"
          title="New terminal"
        >
          +
        </button>
      </div>

      <div className="search">
        <span className="search-icon" aria-hidden="true">
          ⌕
        </span>
        <input
          className="search-input"
          type="search"
          placeholder="Search CLI…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search agents by name"
        />
        {query && (
          <button
            className="search-clear"
            onClick={() => setQuery("")}
            aria-label="Clear search"
          >
            ×
          </button>
        )}
      </div>

      <ul className="agent-list">
        {filtered.length === 0 ? (
          <li className="agent-empty">
            {sessions.length === 0 ? "No agents running." : "No matches."}
          </li>
        ) : (
          filtered.map((s) => {
            const state: AgentState = s.ended
              ? "done"
              : (states[s.id] ?? s.state);
            const live = !s.ended && state !== "idle";
            const pendingCount = pending[s.id]?.length ?? 0;
            return (
              <li
                key={s.id}
                className={`agent-item ${s.id === activeId ? "active" : ""} ${
                  s.ended ? "ended" : ""
                }`}
              >
                <button
                  className="agent-item-btn"
                  onClick={() => setActive(s.id)}
                  title={s.commandLine}
                >
                  <span
                    className={`state-dot state-${state} ${live ? "pulse" : ""}`}
                    aria-hidden="true"
                  />
                  <span className="agent-item-main">
                    <span className="agent-item-name">{s.command}</span>
                    <span className="agent-item-sub">
                      {s.ended ? `exited (${s.exitCode ?? 0})` : `pid ${s.pid}`}
                    </span>
                  </span>
                  <span className="agent-item-badges">
                    {pendingCount > 0 && (
                      <span
                        className="pending-pip"
                        title={`${pendingCount} pending`}
                      >
                        {pendingCount}
                      </span>
                    )}
                    <span className={`state-pill state-${state}`}>
                      {s.ended ? "Done" : STATE_LABEL[state]}
                    </span>
                  </span>
                </button>
                <button
                  className="agent-close"
                  onClick={() => onClose(s)}
                  aria-label={s.ended ? `Dismiss ${s.command}` : `Close ${s.command}`}
                  title={s.ended ? "Dismiss from list" : "Terminate session"}
                >
                  ×
                </button>
              </li>
            );
          })
        )}
      </ul>

      {confirm && (
        <ConfirmDialog
          title="Terminate session?"
          message={`This will stop "${confirm.commandLine}" (pid ${confirm.pid}).`}
          warn={
            confirm.nativeAttached
              ? "It is also mirrored in a native terminal — that terminal will end too."
              : undefined
          }
          confirmLabel="Terminate"
          onConfirm={() => window.agentwatch.close(confirm.id)}
          onClose={() => setConfirm(null)}
        />
      )}
    </nav>
  );
}
