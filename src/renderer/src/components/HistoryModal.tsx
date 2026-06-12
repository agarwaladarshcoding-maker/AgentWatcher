import { useCallback, useEffect, useState } from "react";
import { Modal } from "./Modal";
import type { HistoryDetail, HistorySessionRow } from "../../../shared/types";

/**
 * Session history (Phase 4) — backed by the SQLite audit log in the main
 * process, so it spans every run, not just the current one. Each row expands to
 * its persisted event + verdict timeline.
 */
function fmtWhen(ts: number): string {
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return "—";
  }
}

function fmtDuration(startedAt: number, endedAt: number | null): string {
  const end = endedAt ?? Date.now();
  const secs = Math.max(0, Math.round((end - startedAt) / 1000));
  if (secs < 60) return `${secs}s`;
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  if (m < 60) return `${m}m ${s}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

function fmtTime(ts: number): string {
  try {
    return new Date(ts).toLocaleTimeString();
  } catch {
    return "";
  }
}

export function HistoryModal({
  onClose,
}: {
  onClose: () => void;
}): JSX.Element {
  const [rows, setRows] = useState<HistorySessionRow[] | null>(null);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [detail, setDetail] = useState<HistoryDetail | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);

  const reload = useCallback(() => {
    window.agentwatch
      .queryHistory()
      .then((list) => setRows(list))
      .catch(() => setRows([]));
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const toggle = useCallback(
    (key: string) => {
      if (openKey === key) {
        setOpenKey(null);
        setDetail(null);
        return;
      }
      setOpenKey(key);
      setDetail(null);
      window.agentwatch
        .queryHistoryDetail(key)
        .then((d) => setDetail(d))
        .catch(() => setDetail({ session: null, events: [], verdicts: [] }));
    },
    [openKey],
  );

  const clearAll = useCallback(() => {
    window.agentwatch
      .clearHistory()
      .then(() => {
        setOpenKey(null);
        setDetail(null);
        setConfirmClear(false);
        reload();
      })
      .catch(() => setConfirmClear(false));
  }, [reload]);

  return (
    <Modal title="Session history" onClose={onClose}>
      {rows === null ? (
        <p className="field-hint">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="field-hint">
          No sessions recorded yet. Launch an agent and its timeline is saved
          here automatically.
        </p>
      ) : (
        <>
          {rows.map((s) => {
            const isOpen = openKey === s.key;
            return (
              <div key={s.key} className="history-item">
                <button
                  type="button"
                  className="history-row history-row-btn"
                  onClick={() => toggle(s.key)}
                  aria-expanded={isOpen}
                >
                  <span
                    className={`state-dot state-${s.endedAt ? "done" : "idle"}`}
                    aria-hidden="true"
                  />
                  <div className="history-main">
                    <div className="history-cmd">{s.commandLine}</div>
                    <div className="history-sub">
                      {fmtWhen(s.startedAt)} · {s.profile} profile · pid {s.pid} ·{" "}
                      {fmtDuration(s.startedAt, s.endedAt)} · {s.eventCount}{" "}
                      events · {s.verdictCount} verdicts
                    </div>
                  </div>
                  <span
                    className={`verdict-chip ${s.endedAt ? "neutral" : "allow"}`}
                  >
                    {s.endedAt ? `exit ${s.exitCode ?? 0}` : "Running"}
                  </span>
                </button>

                {isOpen && (
                  <div className="history-detail">
                    <div className="history-export">
                      <span className="field-hint">Export this session:</span>
                      <button
                        className="btn"
                        onClick={() =>
                          window.agentwatch.exportHistory(s.key, "json")
                        }
                      >
                        JSON
                      </button>
                      <button
                        className="btn"
                        onClick={() =>
                          window.agentwatch.exportHistory(s.key, "md")
                        }
                      >
                        Markdown
                      </button>
                    </div>
                    {detail === null ? (
                      <p className="field-hint">Loading timeline…</p>
                    ) : detail.events.length === 0 &&
                      detail.verdicts.length === 0 ? (
                      <p className="field-hint">No recorded activity.</p>
                    ) : (
                      <>
                        {detail.verdicts.length > 0 && (
                          <div className="history-section">
                            <div className="history-section-title">
                              Verdicts
                            </div>
                            {detail.verdicts.map((v) => (
                              <div key={v.id} className="history-line">
                                <span
                                  className={`verdict-chip ${
                                    v.decision === "deny" ? "deny" : "allow"
                                  }`}
                                >
                                  {v.label}
                                </span>
                                <span className="history-line-title">
                                  {v.title}
                                </span>
                                <span className="history-line-time">
                                  {fmtTime(v.decidedAt)}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                        <div className="history-section">
                          <div className="history-section-title">Events</div>
                          {detail.events.map((e) => (
                            <div key={e.id} className="history-line">
                              <span className="history-line-title">
                                {e.title}
                              </span>
                              {e.detail && (
                                <span className="history-line-detail">
                                  {e.detail}
                                </span>
                              )}
                              <span className="history-line-time">
                                {fmtTime(e.ts)}
                              </span>
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          <div className="field history-actions">
            {confirmClear ? (
              <>
                <span className="field-hint">Clear all saved history?</span>
                <button className="btn danger" onClick={clearAll}>
                  Yes, clear
                </button>
                <button className="btn" onClick={() => setConfirmClear(false)}>
                  Cancel
                </button>
              </>
            ) : (
              <button className="btn" onClick={() => setConfirmClear(true)}>
                Clear history
              </button>
            )}
          </div>
        </>
      )}
    </Modal>
  );
}
