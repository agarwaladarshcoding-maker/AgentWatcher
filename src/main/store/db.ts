import { join } from "node:path";
import type {
  FeedEvent,
  HistoryDetail,
  HistorySessionRow,
  RespondedPermission,
  SessionInfo,
} from "../../shared/types";

/**
 * Local-first audit log + session history (architecture §5, §9; Phase 4).
 *
 * SQLite via better-sqlite3, stored under the OS userData dir so it survives
 * across runs and across app updates. This is the durable backing for the
 * Session-history view and the permission audit trail.
 *
 * Hard invariant (§18): the audit log is BEST-EFFORT. It must never break the
 * mirror or the control plane. Every method swallows its own errors, and if the
 * native module fails to load (ABI mismatch, missing prebuild, etc.) we fall
 * back to a no-op store so the app still runs perfectly — just without history.
 */

export type { HistoryDetail, HistorySessionRow };

/** What the SessionManager records into; see SqliteAuditStore + NoopAuditStore. */
export interface AuditStore {
  sessionStarted(info: SessionInfo): void;
  sessionEnded(id: string, exitCode: number): void;
  event(id: string, event: FeedEvent): void;
  verdict(id: string, responded: RespondedPermission): void;
  recentSessions(limit?: number): HistorySessionRow[];
  sessionDetail(key: string): HistoryDetail;
  clear(): void;
  close(): void;
}

/** Used when SQLite is unavailable — the app runs, just without persistence. */
class NoopAuditStore implements AuditStore {
  sessionStarted(): void {}
  sessionEnded(): void {}
  event(): void {}
  verdict(): void {}
  recentSessions(): HistorySessionRow[] {
    return [];
  }
  sessionDetail(): HistoryDetail {
    return { session: null, events: [], verdicts: [] };
  }
  clear(): void {}
  close(): void {}
}

/* eslint-disable @typescript-eslint/no-explicit-any */
class SqliteAuditStore implements AuditStore {
  private readonly db: any;
  /** Unique per app launch so re-used session ids (s1, s2…) never collide. */
  private readonly runId = `${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 6)}`;

  constructor(Database: any, dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.migrate();
  }

  private key(id: string): string {
    return `${this.runId}:${id}`;
  }

  private migrate(): void {
    // Versioned schema. If a DB from a different/older schema exists (e.g. a
    // prior build wrote different columns), rebuild our tables cleanly rather
    // than fail every query with "no such column".
    const SCHEMA_VERSION = 1;
    let current = 0;
    try {
      current = this.db.pragma("user_version", { simple: true }) as number;
    } catch {
      current = 0;
    }

    const expected = this.tablesMatchExpected();
    if (current !== SCHEMA_VERSION || !expected) {
      this.db.exec(`
        DROP TABLE IF EXISTS verdicts;
        DROP TABLE IF EXISTS events;
        DROP TABLE IF EXISTS sessions;
      `);
    }

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        key          TEXT PRIMARY KEY,
        session_id   TEXT NOT NULL,
        command_line TEXT NOT NULL,
        profile      TEXT NOT NULL,
        pid          INTEGER NOT NULL,
        started_at   INTEGER NOT NULL,
        ended_at     INTEGER,
        exit_code    INTEGER
      );
      CREATE TABLE IF NOT EXISTS events (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        session_key TEXT NOT NULL,
        event_id    TEXT NOT NULL,
        ts          INTEGER NOT NULL,
        kind        TEXT NOT NULL,
        state       TEXT,
        title       TEXT NOT NULL,
        detail      TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_events_skey ON events(session_key);
      CREATE TABLE IF NOT EXISTS verdicts (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        session_key   TEXT NOT NULL,
        permission_id TEXT NOT NULL,
        ts            INTEGER NOT NULL,
        decided_at    INTEGER NOT NULL,
        title         TEXT NOT NULL,
        source        TEXT NOT NULL,
        raw_prompt    TEXT NOT NULL,
        decision      TEXT NOT NULL,
        label         TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_verdicts_skey ON verdicts(session_key);
    `);

    try {
      this.db.pragma(`user_version = ${SCHEMA_VERSION}`);
    } catch {
      /* best-effort */
    }
  }

  /** True only if the `sessions` table already has our expected columns. */
  private tablesMatchExpected(): boolean {
    try {
      const cols: Array<{ name: string }> = this.db
        .prepare(`PRAGMA table_info(sessions)`)
        .all();
      if (cols.length === 0) return true; // fresh DB; nothing to reconcile
      const names = new Set(cols.map((c) => c.name));
      return ["key", "session_id", "command_line", "started_at"].every((c) =>
        names.has(c),
      );
    } catch {
      return false;
    }
  }

  sessionStarted(info: SessionInfo): void {
    try {
      this.db
        .prepare(
          `INSERT OR REPLACE INTO sessions
             (key, session_id, command_line, profile, pid, started_at, ended_at, exit_code)
           VALUES (@key, @sessionId, @commandLine, @profile, @pid, @startedAt, NULL, NULL)`,
        )
        .run({
          key: this.key(info.id),
          sessionId: info.id,
          commandLine: info.commandLine,
          profile: info.profile,
          pid: info.pid,
          startedAt: info.startedAt,
        });
    } catch {
      /* best-effort */
    }
  }

  sessionEnded(id: string, exitCode: number): void {
    try {
      this.db
        .prepare(
          `UPDATE sessions SET ended_at = @endedAt, exit_code = @exitCode WHERE key = @key`,
        )
        .run({ key: this.key(id), endedAt: Date.now(), exitCode });
    } catch {
      /* best-effort */
    }
  }

  event(id: string, event: FeedEvent): void {
    try {
      this.db
        .prepare(
          `INSERT INTO events (session_key, event_id, ts, kind, state, title, detail)
           VALUES (@sessionKey, @eventId, @ts, @kind, @state, @title, @detail)`,
        )
        .run({
          sessionKey: this.key(id),
          eventId: event.id,
          ts: event.ts,
          kind: event.kind,
          state: event.state ?? null,
          title: event.title,
          detail: event.detail ?? null,
        });
    } catch {
      /* best-effort */
    }
  }

  verdict(id: string, r: RespondedPermission): void {
    try {
      this.db
        .prepare(
          `INSERT INTO verdicts
             (session_key, permission_id, ts, decided_at, title, source, raw_prompt, decision, label)
           VALUES (@sessionKey, @permissionId, @ts, @decidedAt, @title, @source, @rawPrompt, @decision, @label)`,
        )
        .run({
          sessionKey: this.key(id),
          permissionId: r.id,
          ts: r.ts,
          decidedAt: r.decidedAt,
          title: r.title,
          source: r.source,
          rawPrompt: r.rawPrompt,
          decision: r.decision,
          label: r.label,
        });
    } catch {
      /* best-effort */
    }
  }

  recentSessions(limit = 100): HistorySessionRow[] {
    try {
      const rows = this.db
        .prepare(
          `SELECT
             s.key, s.session_id, s.command_line, s.profile, s.pid,
             s.started_at, s.ended_at, s.exit_code,
             (SELECT COUNT(*) FROM events e WHERE e.session_key = s.key)   AS event_count,
             (SELECT COUNT(*) FROM verdicts v WHERE v.session_key = s.key) AS verdict_count
           FROM sessions s
           ORDER BY s.started_at DESC
           LIMIT ?`,
        )
        .all(limit);
      return rows.map(mapSessionRow);
    } catch {
      return [];
    }
  }

  sessionDetail(key: string): HistoryDetail {
    try {
      const row = this.db
        .prepare(
          `SELECT
             s.key, s.session_id, s.command_line, s.profile, s.pid,
             s.started_at, s.ended_at, s.exit_code,
             (SELECT COUNT(*) FROM events e WHERE e.session_key = s.key)   AS event_count,
             (SELECT COUNT(*) FROM verdicts v WHERE v.session_key = s.key) AS verdict_count
           FROM sessions s WHERE s.key = ?`,
        )
        .get(key);
      const events: FeedEvent[] = this.db
        .prepare(
          `SELECT event_id, ts, kind, state, title, detail
             FROM events WHERE session_key = ? ORDER BY ts ASC, id ASC`,
        )
        .all(key)
        .map((e: any) => ({
          id: e.event_id,
          ts: e.ts,
          kind: e.kind,
          state: e.state ?? undefined,
          title: e.title,
          detail: e.detail ?? undefined,
        }));
      const verdicts: RespondedPermission[] = this.db
        .prepare(
          `SELECT permission_id, ts, decided_at, title, source, raw_prompt, decision, label
             FROM verdicts WHERE session_key = ? ORDER BY decided_at ASC, id ASC`,
        )
        .all(key)
        .map((v: any) => ({
          id: v.permission_id,
          ts: v.ts,
          decidedAt: v.decided_at,
          title: v.title,
          source: v.source,
          rawPrompt: v.raw_prompt,
          decision: v.decision,
          label: v.label,
        }));
      return { session: row ? mapSessionRow(row) : null, events, verdicts };
    } catch {
      return { session: null, events: [], verdicts: [] };
    }
  }

  clear(): void {
    try {
      this.db.exec("DELETE FROM events; DELETE FROM verdicts; DELETE FROM sessions;");
    } catch {
      /* best-effort */
    }
  }

  close(): void {
    try {
      this.db.close();
    } catch {
      /* best-effort */
    }
  }
}

function mapSessionRow(r: any): HistorySessionRow {
  return {
    key: r.key,
    sessionId: r.session_id,
    commandLine: r.command_line,
    profile: r.profile,
    pid: r.pid,
    startedAt: r.started_at,
    endedAt: r.ended_at ?? null,
    exitCode: r.exit_code ?? null,
    eventCount: r.event_count ?? 0,
    verdictCount: r.verdict_count ?? 0,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/**
 * Build the audit store. Tries SQLite first; on any failure (native module not
 * built for this Electron ABI, disk error, …) logs once and returns a no-op
 * store so the rest of AgentWatch is unaffected.
 */
export function createAuditStore(userDataDir: string): AuditStore {
  try {
    // Lazy require so a load failure is caught here, not at import time.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Database = require("better-sqlite3");
    const dbPath = join(userDataDir, "agentwatch.db");
    return new SqliteAuditStore(Database, dbPath);
  } catch (error) {
    console.error(
      "[agentwatch] audit store disabled (SQLite unavailable):",
      error instanceof Error ? error.message : error,
    );
    return new NoopAuditStore();
  }
}
