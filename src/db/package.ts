import { APP, exportBackup, parseBackup, serializeBackup, summarize, type Backup } from "./backup";
import { exportGedcom } from "./gedcom";
import { getMeta, setMeta } from "./repo";
import type { Sql } from "./sql";
import { isZip, sha256Hex, zipRead, zipWrite } from "./zip";

export const PACKAGE_FORMAT = 1;
const enc = new TextEncoder(), dec = new TextDecoder("utf-8");
export interface Manifest {
  app: string; kind: "backup-package"; format: number; created_at: string; schema: number;
  people: number; counts: Record<string, number>; files: { name: string; size: number; sha256: string }[];
}
export interface BuiltPackage { filename: string; bytes: Uint8Array; sha256: string; people: number; at: string }

const README = (m: { at: string; people: number }) => `Family Legacy Archive - Backup Package
=====================================
Created: ${m.at}   People: ${m.people}

BN: এটি পারিবারিক তথ্যের পূর্ণ ব্যাকআপ। এই ZIP যেকোনো ZIP-সফটওয়্যারে খোলা যায়।
EN: This is a complete backup. It is a plain ZIP; any tool can open it.

Files
  data.json         Complete data (all tables, sources, full change history). Open standard JSON, UTF-8.
  family-tree.ged   Same tree in GEDCOM 5.5.1, readable by any genealogy software.
  manifest.json     Description and SHA-256 checksum of every file.
  SHA256SUMS.txt    Checksums in standard format. Verify with:  sha256sum -c SHA256SUMS.txt

Restore: open the app > Backup > pick this ZIP. The app checks every checksum before it changes anything.
Without the app: data.json and family-tree.ged are ordinary text files and can be read directly.
`;

export async function buildPackage(db: Sql): Promise<BuiltPackage> {
  const b = exportBackup(db), s = summarize(b);
  const body = [
    { name: "data.json", data: enc.encode(serializeBackup(b)) },
    { name: "family-tree.ged", data: enc.encode(exportGedcom(db)) },
    { name: "README.txt", data: enc.encode(README({ at: b.exported_at, people: s.people })) },
  ];
  const files: Manifest["files"] = [];
  for (const f of body) files.push({ name: f.name, size: f.data.length, sha256: await sha256Hex(f.data) });
  const manifest: Manifest = { app: APP, kind: "backup-package", format: PACKAGE_FORMAT, created_at: b.exported_at, schema: b.schema, people: s.people, counts: b.counts, files };
  const sums = files.map((f) => `${f.sha256}  ${f.name}`).join("\n") + "\n";
  const bytes = zipWrite([
    { name: "manifest.json", data: enc.encode(JSON.stringify(manifest, null, 2)) },
    ...body,
    { name: "SHA256SUMS.txt", data: enc.encode(sums) },
  ], new Date(b.exported_at));
  return { filename: `family-backup-${b.exported_at.slice(0, 10)}.zip`, bytes, sha256: await sha256Hex(bytes), people: s.people, at: b.exported_at };
}

export interface ReadPackage { backup: Backup; manifest: Manifest; checked: number }
/** Verifies EVERY checksum and record count first; only then returns the data. Throws a Bangla message on any mismatch. */
export async function readPackage(bytes: Uint8Array): Promise<ReadPackage> {
  if (!isZip(bytes)) throw new Error("এটি ZIP ফাইল নয়।");
  const z = await zipRead(bytes);
  const mf = z.get("manifest.json");
  if (!mf) throw new Error("এটি এই অ্যাপের ব্যাকআপ প্যাকেজ নয় (manifest নেই)।");
  let m: Manifest;
  try { m = JSON.parse(dec.decode(mf)); } catch { throw new Error("manifest পড়া যায়নি, প্যাকেজ নষ্ট।"); }
  if (m.app !== APP || m.kind !== "backup-package" || !Array.isArray(m.files)) throw new Error("এটি এই অ্যাপের ব্যাকআপ প্যাকেজ নয়।");
  if (m.format > PACKAGE_FORMAT) throw new Error("এই প্যাকেজ অ্যাপের নতুন সংস্করণের, আগে অ্যাপ আপডেট করুন।");
  for (const f of m.files) {
    const d = z.get(f.name);
    if (!d) throw new Error(`প্যাকেজে "${f.name}" ফাইলটি নেই।`);
    if (d.length !== f.size || (await sha256Hex(d)) !== f.sha256) throw new Error(`"${f.name}" বদলে গেছে বা নষ্ট (SHA-256 মেলেনি)। এই ব্যাকআপ ব্যবহার করা নিরাপদ নয়।`);
  }
  const data = z.get("data.json");
  if (!data || !m.files.some((f) => f.name === "data.json")) throw new Error("প্যাকেজে data.json নেই।");
  const backup = parseBackup(dec.decode(data));
  for (const [t, n] of Object.entries(m.counts ?? {})) if ((backup.tables[t]?.length ?? 0) !== n) throw new Error(`তথ্যের সংখ্যা মেলেনি (${t})।`);
  return { backup, manifest: m, checked: m.files.length };
}

export interface LogEntry { at: string; kind: "zip" | "json" | "ged"; file: string; sha256?: string; people: number }
export function readLog(db: Sql): LogEntry[] {
  try { const v = JSON.parse(getMeta(db, "backup_log") ?? "[]"); return Array.isArray(v) ? v : []; } catch { return []; }
}
/** Keeps the last 50 export records (what was exported, when, and its checksum). */
export function addLog(db: Sql, e: LogEntry): void {
  setMeta(db, "backup_log", JSON.stringify([e, ...readLog(db)].slice(0, 50)));
  setMeta(db, "last_export", e.at);
}
