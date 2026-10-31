import m001 from "./migrations/001_core.sql?raw";

/** Minimal interface any SQLite engine (sqlite-wasm, better-sqlite3, ...) can satisfy. */
export interface SqlDb {
  exec(sql: string): void;
  /** Returns the first column of the first row, or null. */
  getValue(sql: string): number | null;
}

export interface Migration { version: number; name: string; sql: string }

/** Append new migrations to the END of this list. Never edit an applied one. */
export const MIGRATIONS: Migration[] = [{ version: 1, name: "core", sql: m001 }];

export function migrate(db: SqlDb): number {
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(
    "CREATE TABLE IF NOT EXISTS schema_migration (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL DEFAULT (datetime('now')))"
  );
  let current = db.getValue("SELECT COALESCE(MAX(version), 0) FROM schema_migration") ?? 0;
  for (const m of MIGRATIONS) {
    if (m.version <= current) continue;
    db.exec("BEGIN");
    try {
      db.exec(m.sql);
      db.exec(`INSERT INTO schema_migration (version, name) VALUES (${m.version}, '${m.name}')`);
      db.exec("COMMIT");
      current = m.version;
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  }
  return current;
}
