import m001 from "./migrations/001_core.sql?raw";

import type { Sql } from "./sql";

export interface Migration { version: number; name: string; sql: string }

/** Append new migrations to the END of this list. Never edit an applied one. */
export const MIGRATIONS: Migration[] = [{ version: 1, name: "core", sql: m001 }];

export function migrate(db: Sql): number {
  db.run("PRAGMA foreign_keys = ON");
  db.run(
    "CREATE TABLE IF NOT EXISTS schema_migration (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL DEFAULT (datetime('now')))"
  );
  let current = Number(db.all<{ v: number }>("SELECT COALESCE(MAX(version), 0) AS v FROM schema_migration")[0]?.v ?? 0);
  for (const m of MIGRATIONS) {
    if (m.version <= current) continue;
    db.run("BEGIN");
    try {
      db.run(m.sql);
      db.run(`INSERT INTO schema_migration (version, name) VALUES (${m.version}, '${m.name}')`);
      db.run("COMMIT");
      current = m.version;
    } catch (err) {
      db.run("ROLLBACK");
      throw err;
    }
  }
  return current;
}
