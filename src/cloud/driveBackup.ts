import { addLog, buildPackage, type BuiltPackage } from "../db/package";
import { joinParts, manifestName, parsePartsManifest, partIndex, splitPackage, type Part } from "../db/split";
import { sha256Hex } from "../db/zip";
import type { Sql } from "../db/sql";
import { CloudError } from "./errors";
import type { DriveClient, DriveFile } from "./drive";
import { ensureLayout, type Layout } from "./sync";

const MB = 1024 * 1024;
export const baseOf = (name: string) => name.replace(/\.parts\.json$/, "").replace(/\.\d{3}$/, "");
const dateOf = (base: string) => /(\d{4})-(\d{2})-(\d{2})/.exec(base)?.slice(1, 4).join("-") ?? null;

/** পুরোনো ব্যাকআপ পাতলা করা: শেষ keepDays দিনের সবগুলো রাখে; তার আগের প্রতি মাসের শেষ একটি রাখে। ফেরত দেয় কোনগুলো মুছবে। */
export function retention(bases: string[], today: string, keepDays = 30): { keep: string[]; drop: string[] } {
  const limit = new Date(`${today}T00:00:00Z`).getTime() - keepDays * 86400000;
  const keep = new Set<string>(), monthBest = new Map<string, string>();
  for (const b of bases) {
    const d = dateOf(b);
    if (!d) { keep.add(b); continue; }                         // চেনা যায় না এমন নাম কখনো মুছি না
    if (new Date(`${d}T00:00:00Z`).getTime() >= limit) { keep.add(b); continue; }
    const m = d.slice(0, 7), cur = monthBest.get(m);
    if (!cur || dateOf(cur)! < d) monthBest.set(m, b);
  }
  for (const b of monthBest.values()) keep.add(b);
  return { keep: bases.filter((b) => keep.has(b)), drop: bases.filter((b) => !keep.has(b)) };
}

export interface DriveBackupResult { base: string; files: string[]; sha256: string; people: number; at: string; removed: string[] }
/** ZIP ব্যাকআপ বানিয়ে (ইচ্ছা হলে partMb আকারে ভাগ করে) Drive-এর Backups ফোল্ডারে রাখে, প্রতিটি অংশ ফেরত নামিয়ে SHA-256 মিলিয়ে দেখে। */
export async function backupToDrive(db: Sql, drive: DriveClient, o: { partMb: number; layout?: Layout; kind?: "drive" | "mirror"; keepDays?: number; rootName?: string; today?: string }): Promise<DriveBackupResult> {
  const pkg: BuiltPackage = await buildPackage(db);
  const layout = o.layout ?? (await ensureLayout(drive, o.rootName, ["Backups"]));
  const folder = layout.folders.Backups;
  const sp = await splitPackage(pkg.filename, pkg.bytes, Math.round((o.partMb || 0) * MB), pkg.at);
  const files: Part[] = [...sp.parts, ...(sp.manifestFile ? [sp.manifestFile] : [])];
  const written: DriveFile[] = [];
  for (const f of files) {
    const sha = await sha256Hex(f.data), have = await drive.findFile(f.name, folder);
    const up = await drive.put({ name: f.name, parent: folder, bytes: f.data, id: have?.id, mime: f.name.endsWith(".json") ? "application/json" : "application/zip", props: { sha256: sha } });
    if (Number(up.size ?? f.data.length) !== f.data.length) throw new CloudError("server", `"${f.name}" আপলোড অসম্পূর্ণ (আকার মেলেনি)।`);
    const back = await drive.download(up.id);
    if (back.length !== f.data.length || (await sha256Hex(back)) !== sha) throw new CloudError("server", `"${f.name}" Drive-এ ঠিকমতো সংরক্ষিত হয়নি (SHA-256 মেলেনি)। আবার চেষ্টা করুন।`);
    written.push(up);
  }
  // একই দিনের আগের ব্যাকআপের বাড়তি অংশ (যেমন আগে ৩ ভাগ ছিল, এবার ২) মুছে দিই, নইলে জোড়া লাগাতে গোলমাল হবে
  const ids = new Set(written.map((w) => w.id));
  const stale = (await drive.children(folder, pkg.filename)).filter((x) => baseOf(x.name) === pkg.filename && !ids.has(x.id));
  for (const s of stale) await drive.remove(s.id);
  const removed = await thin(drive, folder, o.today ?? pkg.at.slice(0, 10), o.keepDays ?? 30);
  addLog(db, { at: pkg.at, kind: o.kind ?? "drive", file: `${pkg.filename}${files.length > 1 ? ` (${sp.parts.length} অংশ)` : ""}`, sha256: pkg.sha256, people: pkg.people });
  return { base: pkg.filename, files: files.map((f) => f.name), sha256: pkg.sha256, people: pkg.people, at: pkg.at, removed };
}

async function thin(drive: DriveClient, folder: string, today: string, keepDays: number): Promise<string[]> {
  const all = await drive.children(folder, "family-backup-");
  const bases = [...new Set(all.map((f) => baseOf(f.name)))];
  const { drop } = retention(bases, today, keepDays);
  const removed: string[] = [];
  for (const f of all) if (drop.includes(baseOf(f.name))) { await drive.remove(f.id); removed.push(f.name); }
  return [...new Set(removed.map(baseOf))];
}

export interface DriveBackupItem { base: string; parts: number; at: string | null }
export async function listDriveBackups(drive: DriveClient, rootName?: string): Promise<DriveBackupItem[]> {
  const layout = await ensureLayout(drive, rootName, ["Backups"]);
  const all = await drive.children(layout.folders.Backups, "family-backup-");
  const by = new Map<string, { parts: number; at: string | null }>();
  for (const f of all) { const b = baseOf(f.name), cur = by.get(b) ?? { parts: 0, at: f.modifiedTime ?? null }; if (partIndex(f.name) !== null) cur.parts++; by.set(b, cur); }
  return [...by].map(([base, v]) => ({ base, parts: v.parts, at: v.at })).sort((a, b) => b.base.localeCompare(a.base));
}
/** Drive থেকে ব্যাকআপ নামিয়ে (অংশ থাকলে জোড়া লাগিয়ে) ZIP-এর বাইট ফেরত দেয়; এরপর readPackage SHA-256 যাচাই করবে। */
export async function fetchDriveBackup(drive: DriveClient, base: string, rootName?: string): Promise<Uint8Array> {
  const layout = await ensureLayout(drive, rootName, ["Backups"]);
  const all = (await drive.children(layout.folders.Backups, base)).filter((f) => baseOf(f.name) === base);
  if (!all.length) throw new CloudError("notfound", "এই ব্যাকআপ Drive-এ পাওয়া যায়নি।");
  const single = all.find((f) => f.name === base);
  if (single) return drive.download(single.id);
  const pm = all.find((f) => f.name === manifestName(base));
  const manifest = pm ? parsePartsManifest(new TextDecoder().decode(await drive.download(pm.id))) : null;
  const parts: Part[] = [];
  for (const f of all.filter((x) => partIndex(x.name) !== null)) parts.push({ name: f.name, data: await drive.download(f.id) });
  return joinParts(parts, manifest);
}
