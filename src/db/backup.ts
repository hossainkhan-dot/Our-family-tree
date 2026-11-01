import type { Sql } from "./sql";
import { tx } from "./sql";

export const APP = "family-legacy-archive";
/** Order matters: parents before children so foreign keys resolve. */
export const TABLES = ["branch", "place", "person", "person_name", "family_union", "parent_child", "event", "media", "media_person",
  "source", "citation", "person_note", "person_attribute", "change_log"] as const;

type Row = Record<string, string | number | null>;
export interface Backup {
  app: string; format: 1; schema: number; exported_at: string; ego: string | null;
  counts: Record<string, number>; tables: Record<string, Row[]>;
}

function schemaVersion(db: Sql): number {
  try { return Number(db.all<{ v: number }>("SELECT MAX(version) AS v FROM schema_migration")[0]?.v ?? 1); } catch { return 1; }
}

/** Every row of every table, including soft-deleted rows and the full change history. */
export function exportBackup(db: Sql): Backup {
  const tables: Record<string, Row[]> = {}, counts: Record<string, number> = {};
  for (const t of TABLES) { tables[t] = db.all<Row>(`SELECT * FROM ${t}`); counts[t] = tables[t].length; }
  const ego = db.all<{ value: string }>("SELECT value FROM app_context WHERE key = 'ego'")[0]?.value ?? null;
  return { app: APP, format: 1, schema: schemaVersion(db), exported_at: new Date().toISOString(), ego, counts, tables };
}
export const serializeBackup = (b: Backup) => JSON.stringify(b);

export function parseBackup(text: string): Backup {
  let b: Backup;
  try { b = JSON.parse(text.replace(/^\uFEFF/, "")); } catch { throw new Error("এটি বৈধ ব্যাকআপ ফাইল নয় (পড়া যায়নি)।"); }
  if (!b || b.app !== APP) throw new Error("এটি এই অ্যাপের ব্যাকআপ ফাইল নয়।");
  if (b.format !== 1 || typeof b.tables !== "object") throw new Error("ব্যাকআপ ফাইলের ফরম্যাট চেনা যায়নি।");
  return b;
}

export function summarize(b: Backup): { people: number; at: string } {
  const live = (b.tables.person ?? []).filter((r) => !r.deleted_at && !r.is_placeholder);
  return { people: live.length, at: b.exported_at };
}

/** Loads a backup into an EMPTY, already-migrated database. Throws (and rolls back) on any inconsistency. */
export function restoreInto(db: Sql, b: Backup): void {
  if (b.schema > schemaVersion(db)) throw new Error("এই ব্যাকআপ অ্যাপের নতুন সংস্করণের, আগে অ্যাপ আপডেট করুন।");
  if (db.all("SELECT 1 AS x FROM person LIMIT 1").length) throw new Error("ডেটাবেস খালি নয়।");
  const logTriggers = db.all<{ name: string; sql: string }>("SELECT name, sql FROM sqlite_master WHERE type = 'trigger'").filter((t) => t.name.endsWith("_log_ins"));
  for (const t of logTriggers) db.run(`DROP TRIGGER ${t.name}`);   // the backup already carries the history
  db.run("PRAGMA foreign_keys = OFF");
  try {
    tx(db, () => {
      for (const t of TABLES) {
        const rows = b.tables[t] ?? [];
        const cols = new Set(db.all<{ name: string }>(`PRAGMA table_info(${t})`).map((c) => c.name));
        for (const r of rows) {
          const ks = Object.keys(r);
          if (!ks.length || ks.some((k) => !cols.has(k))) throw new Error(`ব্যাকআপে অচেনা তথ্য আছে (${t})।`);
          if (ks.some((k) => r[k] !== null && typeof r[k] !== "string" && typeof r[k] !== "number")) throw new Error(`ব্যাকআপে ভুল মান আছে (${t})।`);
          db.run(`INSERT INTO ${t} (${ks.join(", ")}) VALUES (${ks.map(() => "?").join(", ")})`, ks.map((k) => r[k]));
        }
        const n = db.all<{ n: number }>(`SELECT COUNT(*) AS n FROM ${t}`)[0].n;
        if (n !== rows.length) throw new Error(`ব্যাকআপ পুরোপুরি ঢোকেনি (${t})।`);
      }
      if (db.all("PRAGMA foreign_key_check").length) throw new Error("ব্যাকআপের সম্পর্কগুলো অসামঞ্জস্যপূর্ণ।");
      if (b.ego) db.run("INSERT OR REPLACE INTO app_context (key, value) VALUES ('ego', ?)", [b.ego]);
    });
  } finally {
    db.run("PRAGMA foreign_keys = ON");
    for (const t of logTriggers) db.run(t.sql);
  }
}
