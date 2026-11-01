/** Tiny database interface so the same code runs on sql.js (app) and node:sqlite (tests). */
export interface Sql {
  run(sql: string, params?: unknown[]): void;
  all<T = Record<string, unknown>>(sql: string, params?: unknown[]): T[];
}

export function tx<T>(db: Sql, fn: () => T): T {
  db.run("BEGIN");
  try {
    const r = fn();
    db.run("COMMIT");
    return r;
  } catch (e) {
    db.run("ROLLBACK");
    throw e;
  }
}
