import { useEffect, useState } from "react";
import { Modal } from "./Modal";
import type { HistoryRow } from "../../../shared/ipc";

interface HistoryModalProps {
  onClose: () => void;
}

/** Read-only view of the SQLite audit log (Phase 4, architecture §23). */
export function HistoryModal({ onClose }: HistoryModalProps): JSX.Element {
  const [rows, setRows] = useState<HistoryRow[] | null>(null);

  useEffect(() => {
    let active = true;
    window.agentwatch
      .getHistory({ limit: 100 })
      .then((r) => active && setRows(r))
      .catch(() => active && setRows([]));
    return () => {
      active = false;
    };
  }, []);

  const fmt = (ts: number | null): string =>
    ts ? new Date(ts).toLocaleString() : "—";
  const dur = (a: number, b: number | null): string =>
    b ? `${Math.max(0, Math.round((b - a) / 1000))}s` : "running";

  return (
    <Modal title="Session history" onClose={onClose}>
      {rows === null ? (
        <p className="modal-empty">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="modal-empty">
          No history yet, or the audit store is unavailable.
        </p>
      ) : (
        <table className="history-table">
          <thead>
            <tr>
              <th>Command</th>
              <th>Profile</th>
              <th>PID</th>
              <th>Started</th>
              <th>Duration</th>
              <th>Exit</th>
              <th>Events</th>
              <th>Verdicts</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.rowId}>
                <td className="mono" title={r.command}>
                  {r.label || r.command}
                </td>
                <td>{r.profile}</td>
                <td className="mono">{r.pid}</td>
                <td>{fmt(r.startedAt)}</td>
                <td>{dur(r.startedAt, r.endedAt)}</td>
                <td>{r.endedAt ? (r.exitCode ?? 0) : "—"}</td>
                <td>{r.events}</td>
                <td>{r.verdicts}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Modal>
  );
}
