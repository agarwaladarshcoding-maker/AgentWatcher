import { Modal } from "./Modal";
import { useSessions } from "../store/sessions";

/**
 * A lightweight session history: every session this run (running + ended) with
 * its command, pid, status, and how many events / verdicts it accrued. A
 * stepping-stone toward the SQLite audit log (architecture §23, Phase 4).
 */
function duration(startedAt: number): string {
  const secs = Math.max(0, Math.round((Date.now() - startedAt) / 1000));
  if (secs < 60) return `${secs}s`;
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}m ${s}s`;
}

export function HistoryModal({
  onClose,
}: {
  onClose: () => void;
}): JSX.Element {
  const sessions = useSessions((s) => s.sessions);
  const events = useSessions((s) => s.events);
  const responded = useSessions((s) => s.responded);

  return (
    <Modal title="Session history" onClose={onClose}>
      {sessions.length === 0 ? (
        <p className="field-hint">No sessions yet this run.</p>
      ) : (
        sessions
          .slice()
          .reverse()
          .map((s) => {
            const ev = events[s.id]?.length ?? 0;
            const verdicts = responded[s.id]?.length ?? 0;
            return (
              <div key={s.id} className="history-row">
                <span
                  className={`state-dot state-${s.ended ? "done" : s.state}`}
                  aria-hidden="true"
                />
                <div className="history-main">
                  <div className="history-cmd">{s.commandLine}</div>
                  <div className="history-sub">
                    {s.ended
                      ? `exited (${s.exitCode ?? 0})`
                      : `pid ${s.pid} · ${duration(s.startedAt)}`}
                    {" · "}
                    {s.profile} profile · {ev} events · {verdicts} verdicts
                  </div>
                </div>
                <span className={`verdict-chip ${s.ended ? "neutral" : "allow"}`}>
                  {s.ended ? "Ended" : "Running"}
                </span>
              </div>
            );
          })
      )}
    </Modal>
  );
}
