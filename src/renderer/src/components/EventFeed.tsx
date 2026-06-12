import { useSessions } from "../store/sessions";
import type { AgentState, FeedEvent } from "../../../shared/types";

/** Map a feed entry to a semantic color class (architecture doc §16.2). */
function toneFor(event: FeedEvent): string {
  if (event.kind === "permission_needed") return "tone-amber";
  if (event.kind === "session_end") return "tone-neutral";
  if (event.kind === "verdict") return event.state ? "tone-green" : "tone-red";
  const state: AgentState | undefined = event.state;
  switch (state) {
    case "reading":
    case "waiting":
      return "tone-blue";
    case "thinking":
      return "tone-amber";
    case "writing":
    case "done":
      return "tone-green";
    default:
      return "tone-neutral";
  }
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  const p = (n: number): string => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** Live event feed for the active session. Never touches the terminal stream. */
export function EventFeed(): JSX.Element {
  const activeId = useSessions((s) => s.activeId);
  const events = useSessions((s) => (activeId ? (s.events[activeId] ?? []) : []));

  return (
    <section className="feed-panel" aria-label="Event feed">
      <header className="panel-header">
        <span className="panel-title">Event feed</span>
        <span className="panel-live" aria-hidden="true">
          live
        </span>
      </header>
      <ol className="feed-list" aria-live="polite">
        {events.length === 0 ? (
          <li className="feed-empty">No events yet.</li>
        ) : (
          events.map((event) => (
            <li key={event.id} className="feed-item">
              <span
                className={`feed-dot ${toneFor(event)}`}
                aria-hidden="true"
              />
              <div className="feed-body">
                <div className="feed-title">{event.title}</div>
                {event.detail && (
                  <div className="feed-detail">{event.detail}</div>
                )}
              </div>
              <time className="feed-time">{formatTime(event.ts)}</time>
            </li>
          ))
        )}
      </ol>
    </section>
  );
}
