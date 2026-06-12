import { useWords } from "../store/words";
import type { AgentState, FeedEvent } from "../../../shared/types";

/** Map a feed entry to a semantic color class (architecture doc §16.2). */
function toneFor(event: FeedEvent): string {
  if (event.kind === "permission_needed") return "tone-warn";
  if (event.kind === "session_end") return "tone-neutral";
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
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

/**
 * The live event feed (architecture doc §12, §16.6). Reads from the words store;
 * never touches the terminal stream.
 */
export function EventFeed(): JSX.Element {
  const events = useWords((s) => s.events);

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
              <span className={`feed-dot ${toneFor(event)}`} aria-hidden="true" />
              <div className="feed-body">
                <div className="feed-title">{event.title}</div>
                {event.detail && <div className="feed-detail">{event.detail}</div>}
              </div>
              <time className="feed-time">{formatTime(event.ts)}</time>
            </li>
          ))
        )}
      </ol>
    </section>
  );
}
