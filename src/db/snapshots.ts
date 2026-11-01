import { exportBackup, serializeBackup, summarize, parseBackup } from "./backup";
import { idbDelete, idbGet, idbKeys, idbPut, SNAPS } from "./idb";
import type { Sql } from "./sql";

export interface Snapshot { key: string; at: string; people: number; json: string }

/** Copies kept INSIDE the app (not a replacement for a file backup: they vanish if the app is uninstalled). */
export async function putSnapshot(db: Sql, key: string): Promise<void> {
  const b = exportBackup(db);
  await idbPut(SNAPS, key, { key, at: b.exported_at, people: summarize(b).people, json: serializeBackup(b) } satisfies Snapshot);
  const keys = (await idbKeys(SNAPS)).sort().reverse();
  const keep = (prefix: string, n: number) => keys.filter((k) => k.startsWith(prefix)).slice(n);
  for (const k of [...keep("auto-", 14), ...keep("pre-", 5)]) await idbDelete(SNAPS, k);
}
export async function autoSnapshot(db: Sql): Promise<void> {
  if (!db.all("SELECT 1 AS x FROM person WHERE deleted_at IS NULL LIMIT 1").length) return;
  const key = `auto-${new Date().toISOString().slice(0, 10)}`;
  if (!(await idbGet(SNAPS, key))) await putSnapshot(db, key);
}
export async function listSnapshots(): Promise<Snapshot[]> {
  const out: Snapshot[] = [];
  for (const k of (await idbKeys(SNAPS)).sort().reverse()) { const s = await idbGet<Snapshot>(SNAPS, k); if (s) out.push(s); }
  return out;
}
export const snapshotBackup = (s: Snapshot) => parseBackup(s.json);
