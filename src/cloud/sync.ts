import { activateOnSignIn, ensureOwner } from "../db/access";
import { APP, exportBackup, parseBackup, serializeBackup, type Backup } from "../db/backup";
import { replaceWith } from "../db/replace";
import { uid } from "../db/repo";
import type { Sql } from "../db/sql";
import { sha256Hex } from "../db/zip";
import { CloudError } from "./errors";
import type { DriveClient } from "./drive";

export const ROOT_NAME = "Our_Family_Archive";
export const SUBFOLDERS = ["Members", "Relationships", "FamilyHistory", "Photos", "Documents", "Approvals", "ActivityLogs", "Backups"] as const;
export type Sub = (typeof SUBFOLDERS)[number];
export interface Layout { root: string; folders: Record<Sub, string> }
const MANIFEST = "FamilyManifest.json";
const enc = new TextEncoder(), dec = new TextDecoder("utf-8");
const pad = (n: number) => String(n).padStart(6, "0");
const safe = (s: string) => s.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 24) || "dev";

export interface FamilyManifest {
  app: string; kind: "family-manifest"; format: 1; family_id: string; revision: number;
  head: { file_id: string; name: string; sha256: string; size: number }; written_by: string; device: string; at: string;
}
export interface SyncState { familyId: string; baseRevision: number; baseFp: string; lastSyncAt: string | null; lastLogId: number; conflict: { remoteRevision: number; at: string } | null }
export interface StateStore { load(): Promise<SyncState | null>; save(s: SyncState): Promise<void> }
export interface Ctx { db: Sql; drive: DriveClient; store: StateStore; device: string; email: string; beforeReplace?: () => Promise<void>; now?: () => Date }
export type SyncResult = { status: "uptodate" | "pushed" | "pulled" | "initialized"; revision: number } | { status: "conflict"; remoteRevision: number };

export async function ensureLayout(d: DriveClient, rootName = ROOT_NAME, only: readonly Sub[] = SUBFOLDERS): Promise<Layout> {
  const root = await d.ensureFolder(rootName);
  const folders = {} as Record<Sub, string>;
  for (const s of only) folders[s] = await d.ensureFolder(s, root);
  return { root, folders };
}
export async function findLayout(d: DriveClient): Promise<Layout | null> {
  const r = await d.findFolders(ROOT_NAME);
  if (!r.length) return null;
  const folders = {} as Record<Sub, string>;
  for (const s of SUBFOLDERS) folders[s] = await d.ensureFolder(s, r[0].id);
  return { root: r[0].id, folders };
}

/** মূল তথ্যের আঙুলের ছাপ (exported_at বাদে): আগের সিঙ্কের পর স্থানীয়ভাবে কিছু বদলেছে কিনা বোঝার জন্য। */
export async function fingerprint(b: Backup): Promise<string> {
  const t: Record<string, string[]> = {};
  for (const k of Object.keys(b.tables).sort()) t[k] = b.tables[k].map((r) => JSON.stringify(r)).sort();
  return sha256Hex(enc.encode(JSON.stringify(t)));
}

interface Remote { m: FamilyManifest; fileId: string; version: string | undefined }
async function readManifest(d: DriveClient, l: Layout): Promise<Remote | null> {
  const f = await d.findFile(MANIFEST, l.root);
  if (!f) return null;
  let m: FamilyManifest;
  try { m = JSON.parse(dec.decode(await d.download(f.id))); } catch { throw new CloudError("server", "FamilyManifest.json পড়া যায়নি, নষ্ট হতে পারে।"); }
  if (m.app !== APP || m.kind !== "family-manifest" || !m.head) throw new CloudError("server", "FamilyManifest.json এই অ্যাপের নয়।");
  if (m.format > 1) throw new CloudError("server", "Drive-এর ডেটা অ্যাপের নতুন সংস্করণের, আগে অ্যাপ আপডেট করুন।");
  return { m, fileId: f.id, version: f.version };
}

async function downloadHead(d: DriveClient, m: FamilyManifest): Promise<Backup> {
  const bytes = await d.download(m.head.file_id);
  if (bytes.length !== m.head.size || (await sha256Hex(bytes)) !== m.head.sha256) throw new CloudError("server", "Drive-এর তথ্য বদলে গেছে বা নষ্ট (SHA-256 মেলেনি)। কিছু প্রয়োগ করা হয়নি।");
  return parseBackup(dec.decode(bytes));
}

/** সদস্য-তালিকায় ইমেইল না থাকলে (বা স্থগিত হলে) আসা তথ্য ফোনে বসানো হয় না। */
export function memberOf(b: Backup, email: string): boolean {
  const rows = b.tables.member ?? [];
  return rows.some((r) => String(r.email).toLowerCase() === email.toLowerCase() && r.status !== "suspended");
}
const NOT_LISTED = "এই Gmail পরিবারের সদস্য-তালিকায় নেই। মালিক বা অ্যাডমিনকে আমন্ত্রণ পাঠাতে বলুন।";

async function putByName(d: DriveClient, parent: string, name: string, bytes: Uint8Array, props?: Record<string, string>) {
  const have = await d.findFile(name, parent);
  if (have && props?.sha256 && have.appProperties?.sha256 === props.sha256) return have;   // একই তথ্য আবার আপলোড নয় (ডুপ্লিকেট রোধ)
  return d.put({ name, parent, bytes, mime: "application/json", id: have?.id, props });
}

async function push(c: Ctx, l: Layout, remote: Remote | null, st: SyncState | null, rev: number, familyId: string): Promise<SyncResult> {
  const b = exportBackup(c.db), fp = await fingerprint(b), at = (c.now?.() ?? new Date()).toISOString();
  const treeBytes = enc.encode(serializeBackup(b)), sha = await sha256Hex(treeBytes), dev = safe(c.device);
  const head = await putByName(c.drive, l.folders.FamilyHistory, `tree-r${pad(rev)}-${dev}.json`, treeBytes, { sha256: sha });
  if (Number(head.size ?? treeBytes.length) !== treeBytes.length) throw new CloudError("server", "আপলোড অসম্পূর্ণ হয়েছে (আকার মেলেনি)। আবার চেষ্টা করুন।");
  await putByName(c.drive, l.folders.Members, "members.json", enc.encode(JSON.stringify({ at, rows: b.tables.member ?? [] }, null, 1)));
  await putByName(c.drive, l.folders.Approvals, "approvals.json", enc.encode(JSON.stringify({ at, requests: b.tables.approval_request ?? [], votes: b.tables.approval_vote ?? [] }, null, 1)));
  const log = (b.tables.change_log ?? []).filter((r) => Number(r.id) > (st?.lastLogId ?? 0));
  const lastLogId = (b.tables.change_log ?? []).reduce((n, r) => Math.max(n, Number(r.id)), st?.lastLogId ?? 0);
  if (log.length) await putByName(c.drive, l.folders.ActivityLogs, `log-r${pad(rev)}-${dev}.json`, enc.encode(JSON.stringify({ at, by: c.email, rows: log }, null, 1)));

  const m: FamilyManifest = { app: APP, kind: "family-manifest", format: 1, family_id: familyId, revision: rev, head: { file_id: head.id, name: head.name, sha256: sha, size: treeBytes.length }, written_by: c.email, device: c.device, at };
  if (remote) {   // লেখার ঠিক আগে আবার দেখি অন্য কেউ ইতিমধ্যে বদলায়নি তো
    const now = await c.drive.meta(remote.fileId);
    if (now.version !== remote.version) throw new CloudError("conflict", "সিঙ্কের সময় অন্য কেউ তথ্য বদলেছে। কিছু মুছে ফেলা হয়নি, আবার সিঙ্ক করুন।");
  }
  await c.drive.put({ name: MANIFEST, parent: l.root, bytes: enc.encode(JSON.stringify(m, null, 2)), mime: "application/json", id: remote?.fileId });
  const check = await readManifest(c.drive, l);      // লেখার পর যাচাই: আমারটাই কি শেষ?
  if (!check || check.m.revision !== rev || check.m.head.sha256 !== sha) throw new CloudError("conflict", "একই সময়ে দুজন সিঙ্ক করেছেন। কোনো তথ্য হারায়নি; আবার সিঙ্ক করে মিলিয়ে নিন।");
  await c.store.save({ familyId, baseRevision: rev, baseFp: fp, lastSyncAt: at, lastLogId, conflict: null });
  return { status: remote ? "pushed" : "initialized", revision: rev };
}

async function pull(c: Ctx, remote: Remote): Promise<SyncResult> {
  const b = await downloadHead(c.drive, remote.m);
  if ((b.tables.member ?? []).length && !memberOf(b, c.email)) throw new CloudError("membership", NOT_LISTED);
  await c.beforeReplace?.();
  replaceWith(c.db, b);
  const nb = exportBackup(c.db), maxLog = (nb.tables.change_log ?? []).reduce((n, r) => Math.max(n, Number(r.id)), 0);
  await c.store.save({ familyId: remote.m.family_id, baseRevision: remote.m.revision, baseFp: await fingerprint(nb), lastSyncAt: (c.now?.() ?? new Date()).toISOString(), lastLogId: maxLog, conflict: null });
  return { status: "pulled", revision: remote.m.revision };
}

const hasData = (db: Sql) => db.all("SELECT 1 AS x FROM person LIMIT 1").length > 0 || db.all("SELECT 1 AS x FROM member LIMIT 1").length > 0;

/** মূল সিঙ্ক: Drive-এ নতুন কিছু থাকলে নামায়, শুধু এখানে বদলালে ওঠায়, দুই দিকেই বদলালে "দ্বন্দ্ব" জানায় — কিছুই নীরবে ওভাররাইট হয় না। */
export async function syncNow(c: Ctx): Promise<SyncResult> {
  const l = await ensureLayout(c.drive);
  const remote = await readManifest(c.drive, l), st = await c.store.load();
  if (!remote) return push(c, l, null, st, (st?.baseRevision ?? 0) + 1, st?.familyId ?? uid());
  if (st && st.familyId !== remote.m.family_id) throw new CloudError("conflict", "এই Drive ফোল্ডারটি অন্য একটি পরিবারের। এটি মেশানো হয়নি।");
  const b = exportBackup(c.db), fp = await fingerprint(b);
  const localChanged = st ? fp !== st.baseFp : hasData(c.db);
  const remoteChanged = remote.m.revision > (st?.baseRevision ?? 0);
  if (localChanged && remoteChanged) {
    await c.store.save({ ...(st ?? { familyId: remote.m.family_id, baseRevision: 0, baseFp: "", lastSyncAt: null, lastLogId: 0 }), conflict: { remoteRevision: remote.m.revision, at: (c.now?.() ?? new Date()).toISOString() } });
    return { status: "conflict", remoteRevision: remote.m.revision };
  }
  if (remoteChanged) return pull(c, remote);
  if (localChanged) return push(c, l, remote, st, remote.m.revision + 1, remote.m.family_id);
  return { status: "uptodate", revision: remote.m.revision };
}

/** দ্বন্দ্ব মেটানো: "mine" = আমার ফোনেরটি রাখি (Drive-এর আগেরটি পুরোনো সংস্করণ হিসেবে থেকে যায়);
 *  "theirs" = Drive-এরটি নিই (এই ফোনেরটি আগে Drive-এ আলাদা ফাইলে রাখা হয়, তারপর বদলানো হয়)। দুই ক্ষেত্রেই কিছু হারায় না। */
export async function resolveConflict(c: Ctx, choice: "mine" | "theirs"): Promise<SyncResult> {
  const l = await ensureLayout(c.drive);
  const remote = await readManifest(c.drive, l), st = await c.store.load();
  if (!remote) throw new CloudError("notfound", "Drive-এ পরিবারের তথ্য পাওয়া যায়নি।");
  if (choice === "mine") return push(c, l, remote, st, remote.m.revision + 1, remote.m.family_id);
  const b = exportBackup(c.db), bytes = enc.encode(serializeBackup(b));
  await c.drive.put({ name: `local-before-pull-r${pad(remote.m.revision)}-${safe(c.device)}-${(c.now?.() ?? new Date()).toISOString().replace(/[:.]/g, "-")}.json`, parent: l.folders.FamilyHistory, bytes, mime: "application/json" });
  return pull(c, remote);
}

export type JoinMode = "auto" | "create" | "join";
/** লগইনের ধাপ ৬: পরিবারের সদস্যপদ যাচাই। নতুন ফোনে প্রথমে Drive-এর সদস্য-তালিকায় ইমেইল খোঁজা হয়, মিললে তবেই তথ্য নামে। */
export async function enterFamily(c: Ctx & { sub: string; name: string | null; mode: JoinMode }) {
  const activate = () => activateOnSignIn(c.db, c.email, c.sub);
  if (c.db.all("SELECT 1 AS x FROM member LIMIT 1").length) {
    try { return { member: activate(), how: "existing" as const }; }
    catch (e) {
      if (!(e instanceof Error) || !/সদস্য-তালিকায় নেই/.test(e.message)) throw e;
      try { await syncNow(c); } catch { /* ফল নিচে */ }   // হয়তো অ্যাডমিন সম্প্রতি যোগ করেছেন; Drive থেকে নতুন তালিকা আনার চেষ্টা
      try { return { member: activate(), how: "existing" as const }; } catch { throw new CloudError("membership", NOT_LISTED); }
    }
  }
  const l = await findLayout(c.drive), remote = l ? await readManifest(c.drive, l) : null;
  if (remote) {
    if (hasData(c.db) && c.mode !== "join") throw new CloudError("conflict", "এই ফোনে আগের তথ্য আছে, আবার Drive-এও পরিবার আছে। আগে এই ফোনের ZIP ব্যাকআপ নিন; তারপর 'Drive-এর তথ্য নিন' বেছে নিন।");
    const res = await pull(c, remote);
    if (res.status !== "pulled") throw new CloudError("server", "তথ্য নামানো যায়নি।");
    return { member: activate(), how: "joined" as const };
  }
  if (c.mode === "create") {
    ensureOwner(c.db, c.email, c.name ?? "");
    const member = activate();
    await syncNow(c);
    return { member, how: "created" as const };
  }
  throw new CloudError("notfound", "এই Gmail-এ কোনো পরিবার-সংরক্ষণাগার পাওয়া যায়নি। আপনি প্রথম ব্যক্তি হলে 'নতুন পরিবার শুরু' বাছুন; নয়তো মালিককে আপনার Gmail-এ আমন্ত্রণ ও ফোল্ডার শেয়ার করতে বলুন।");
}
