import { join } from "node:path";
import { app } from "electron";
import type BetterSqlite3 from "better-sqlite3";
import type { FeedEvent, SessionInfo } from "../../shared/types";
import type { HistoryFilter, HistoryRow } from "../../shared/ipc";

type Database = BetterSqlite3.Database;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS sessions (
  id         INTEGER PRIMARY KEY,
  session_id TEXT    NOT NULL,
  pid        INTEGER NOT NULL,
  command    TEXT    NOT NULL,
  label      TEXT,
  profile    TEXT,
  started_at INTEGER NOT NULL,
  ended_at   INTEGER,
  exit_code  INTEGER
);
CREATE TABLE IF NOT EXISTS events (
  id         INTEGER PRIMARY KEY,
  session_id INTEGER NOT NULL REFERENCES sessions(id),
  ts         INTEGER NOT NULL,
  kind       TEXT    NOT NULL,
  state      TEXT,
  title      TEXT    NOT NULL,
  detail     TEXT
);
CREATE TABLE IF NOT EXISTS verdicts (
  id            INTEGER PRIMARY KEY,
  session_id    INTEGER NOT NULL REFERENCES sessions(id),
  permission_id TEXT    NOT NULL,
  raw_prompt    TEXT,
  decision      TEXT    NOT NULL,
  ts            INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_session   ON events(session_id, ts);
CREATE INDEX IF NOT EXISTS idx_verdicts_session ON verdicts(session_id, ts);
`;

/**
 * Local-first audit log (architecture doc §23). Native (better-sqlite3), so it
 * is wrapped defensively: if the module fails to load/compile, the store becomes
 * a no-op and the app keeps working — persistence is never allowed to break the
 * mirror or the session lifecycle.
 */
export class Store {
  private db: Database | null = null;
  private readonly rowIds = new Map<string, number>(); // sessionId -> sessions.id

  init(): void {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const Database = require("better-sqlite3") as typeof BetterSqlite3;
      const file = join(app.getPath("userData"), "agentwatch.db");
      this.db = new Database(file);
      this.db.pragma("journal_mode = WAL");
      this.db.exec(SCHEMA);
      console.log(`[agentwatch] audit store at ${file}`);
    } catch (error) {
      console.error("[agentwatch] audit store disabled:", error);
      this.db = null;
    }
  }

  get enabled(): boolean {
    return this.db !== null;
  }

  startSession(info: SessionInfo): void {
    if (!this.db) return;
    try {
      const stmt = this.db.prepare(
        `INSERT INTO sessions (session_id, pid, command, label, profile, started_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      );
      const r = stmt.run(
        info.id,
        info.pid,
        info.commandLine,
        info.label,
        info.profile,
        info.startedAt,
      );
      this.rowIds.set(info.id, Number(r.lastInsertRowid));
    } catch (error) {
      console.error("[agentwatch] startSession persist failed:", error);
    }
  }

  endSession(sessionId: string, code: number): void {
    const rowId = this.rowIds.get(sessionId);
    if (!this.db || rowId == null) return;
    try {
      this.db
        .prepare(`UPDATE sessions SET ended_at = ?, exit_code = ? WHERE id = ?`)
        .run(Date.now(), code, rowId);
    } catch (error) {
      console.error("[agentwatch] endSession persist failed:", error);
    }
  }

  addEvent(sessionId: string, event: FeedEvent): void {
    const rowId = this.rowIds.get(sessionId);
    if (!this.db || rowId == null) return;
    try {
      this.db
        .prepare(
          `INSERT INTO events (session_id, ts, kind, state, title, detail)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          rowId,
          event.ts,
          event.kind,
          event.state ?? null,
          event.title,
          event.detail ?? null,
        );
    } catch {
      /* non-fatal */
    }
  }

  addVerdict(
    sessionId: string,
    permissionId: string,
    rawPrompt: string,
    decision: "allow" | "deny",
    ts: number,
  ): void {
    const rowId = this.rowIds.get(sessionId);
    if (!this.db || rowId == null) return;
    try {
      this.db
        .prepare(
          `INSERT INTO verdicts (session_id, permission_id, raw_prompt, decision, ts)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(rowId, permissionId, rawPrompt, decision, ts);
    } catch {
      /* non-fatal */
    }
  }

  queryHistory(filter: HistoryFilter): HistoryRow[] {
    if (!this.db) return [];
    const limit = Math.min(Math.max(filter.limit ?? 100, 1), 500);
    try {
      const rows = this.db
        .prepare(
          `SELECT s.id AS rowId, s.session_id AS sessionId, s.command, s.label,
                  s.profile, s.pid, s.started_at AS startedAt, s.ended_at AS endedAt,
                  s.exit_code AS exitCode,
                  (SELECT COUNT(*) FROM events e WHERE e.session_id = s.id) AS events,
                  (SELECT COUNT(*) FROM verdicts v WHERE v.session_id = s.id) AS verdicts
           FROM sessions s
           ORDER BY s.started_at DESC
           LIMIT ?`,
        )
        .all(limit) as HistoryRow[];
      return rows;
    } catch (error) {
      console.error("[agentwatch] queryHistory failed:", error);
      return [];
    }
  }

  close(): void {
    try {
      this.db?.close();
    } catch {
      /* ignore */
    }
    this.db = null;
  }
}
