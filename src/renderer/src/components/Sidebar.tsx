import { useState } from "react";
import { useSessions } from "../store/sessions";
import type { AgentState } from "../../../shared/types";

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
 * tool's name, one-click switching, inline rename, and close.
 */
export function Sidebar(): JSX.Element {
  const sessions = useSessions((s) => s.sessions);
  const activeId = useSessions((s) => s.activeId);
  const states = useSessions((s) => s.states);
  const setActive = useSessions((s) => s.setActive);

  const [query, setQuery] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  const q = query.trim().toLowerCase();
  const filtered = q
    ? sessions.filter(
        (s) =>
          s.label.toLowerCase().includes(q) ||
          s.commandLine.toLowerCase().includes(q) ||
          s.command.toLowerCase().includes(q) ||
          s.profile.toLowerCase().includes(q),
      )
    : sessions;

  const beginRename = (id: string, current: string): void => {
    setEditingId(id);
    setDraft(current);
  };
  const commitRename = (id: string): void => {
    window.agentwatch.rename(id, draft);
    setEditingId(null);
  };
  const close = (id: string): void => window.agentwatch.close(id);

  return (
    <nav className="sidebar" aria-label="Agents">
      <div className="sidebar-head">
        <span className="sidebar-title">Agents</span>
        <span className="sidebar-count">{sessions.length}</span>
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
            const editing = editingId === s.id;
            return (
              <li
                key={s.id}
                className={`agent-item ${s.id === activeId ? "active" : ""}`}
              >
                {editing ? (
                  <input
                    className="rename-input"
                    autoFocus
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onBlur={() => commitRename(s.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitRename(s.id);
                      if (e.key === "Escape") setEditingId(null);
                    }}
                    aria-label="Rename agent"
                  />
                ) : (
                  <>
                    <button
                      className="agent-item-btn"
                      onClick={() => setActive(s.id)}
                      onDoubleClick={() => beginRename(s.id, s.label)}
                      title={s.commandLine}
                    >
                      <span
                        className={`state-dot state-${state} ${live ? "pulse" : ""}`}
                        aria-hidden="true"
                      />
                      <span className="agent-item-main">
                        <span className="agent-item-name">{s.label}</span>
                        <span className="agent-item-sub">
                          {s.ended
                            ? `exited (${s.exitCode ?? 0})`
                            : `pid ${s.pid}`}
                        </span>
                      </span>
                      <span className={`state-pill state-${state}`}>
                        {s.ended ? "Done" : STATE_LABEL[state]}
                      </span>
                    </button>
                    <button
                      className="agent-icon-btn"
                      onClick={() => beginRename(s.id, s.label)}
                      aria-label={`Rename ${s.label}`}
                      title="Rename"
                    >
                      ✎
                    </button>
                    <button
                      className="agent-icon-btn close"
                      onClick={() => close(s.id)}
                      aria-label={`Close ${s.label}`}
                      title="Close session"
                    >
                      ×
                    </button>
                  </>
                )}
              </li>
            );
          })
        )}
      </ul>
    </nav>
  );
}
