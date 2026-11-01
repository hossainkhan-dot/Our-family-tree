import { putSnapshot } from "../db/snapshots";
import type { Sql } from "../db/sql";
import { backupToDrive, type DriveBackupResult } from "./driveBackup";
import { DriveClient } from "./drive";
import { CloudError, needsReauth } from "./errors";
import { getIdentity, pollDeviceFlow, revokeToken, startDeviceFlow, verifyDriveScope, type DeviceCode } from "./google";
import { authFetch } from "./net";
import { nativeAvailable, nativeLogin } from "./native";
import { TokenSource, type StoredSession } from "./session";
import { clearSession, loadConfig, loadSession, saveConfig, saveSession, syncStore, type Which } from "./store";
import { enterFamily, resolveConflict, syncNow, type Ctx, type JoinMode, type SyncResult } from "./sync";

type Listener = (reason: string) => void;
const listeners = new Set<Listener>();
/** Drive অনুমতি বাতিল/অনুপস্থিত হলে UI-কে জানায় (গেট আবার খোলে)। */
export const onAuthIssue = (l: Listener) => { listeners.add(l); return () => { listeners.delete(l); }; };
const raise = (r: string) => listeners.forEach((l) => l(r));

export async function openDrive(which: Which = "primary"): Promise<{ drive: DriveClient; tok: TokenSource; session: StoredSession } | null> {
  const cfg = await loadConfig(), session = await loadSession(which);
  if (!session || (!session.native && !cfg.clientId)) return null;
  const refresher = session.native ? async () => { const t = await nativeLogin(cfg.webClientId); const id = await getIdentity(t.accessToken, authFetch); if (id.email !== session.email) throw new CloudError("denied", "অন্য Gmail বাছা হয়েছে। এই অ্যাকাউন্টের Gmail-ই বাছুন।"); return t; } : undefined;
  const tok = new TokenSource(cfg, session, authFetch, Date.now, () => raise(which === "primary" ? "Drive-এর অনুমতি আর নেই। আবার অনুমতি দিন।" : "দ্বিতীয় Drive অ্যাকাউন্টের অনুমতি আর নেই।"), refresher);
  return { drive: new DriveClient(tok), tok, session };
}

/** ধাপ ১–৫: Google অ্যাকাউন্ট বাছাই → পরিচয় যাচাই → Drive অনুমতি (Google-এর আসল পর্দায়) → অনুমতি সত্যিই এসেছে কিনা যাচাই। */
export async function signIn(which: Which, onCode: (d: DeviceCode) => void, signal: { aborted: boolean }): Promise<StoredSession> {
  const cfg = await loadConfig();
  if (nativeAvailable() && cfg.webClientId) {      // এক ট্যাপ: Gmail + Drive অনুমতি একই Google পর্দায়
    const t = await nativeLogin(cfg.webClientId);
    const scopes = await verifyDriveScope(t.accessToken, authFetch);   // Google-কে জিজ্ঞেস করে আসল অনুমতি নিশ্চিত
    const id = await getIdentity(t.accessToken, authFetch);
    const s: StoredSession = { email: id.email, sub: id.sub, name: id.name, refreshToken: "", scopes, connectedAt: new Date().toISOString(), native: true };
    if (which === "mirror") { const p = await loadSession("primary"); if (p && p.email === s.email) throw new CloudError("config", "ব্যাকআপ-কপির জন্য মূল অ্যাকাউন্ট থেকে আলাদা একটি Gmail বেছে নিন।"); }
    await saveSession(which, s);
    return s;
  }
  const dc = await startDeviceFlow(cfg, authFetch);
  onCode(dc);
  const t = await pollDeviceFlow(cfg, dc, { fetch: authFetch, signal });
  const scopes = await verifyDriveScope(t.accessToken, authFetch);
  const id = await getIdentity(t.accessToken, authFetch);
  if (!t.refreshToken) throw new CloudError("config", "Google থেকে স্থায়ী অনুমতি-চাবি পাওয়া যায়নি। Google অ্যাকাউন্টের 'তৃতীয় পক্ষের অ্যাপ' থেকে এই অ্যাপ সরিয়ে আবার চেষ্টা করুন।");
  const s: StoredSession = { email: id.email, sub: id.sub, name: id.name, refreshToken: t.refreshToken, scopes, connectedAt: new Date().toISOString() };
  if (which === "mirror") {
    const p = await loadSession("primary");
    if (p && p.email === s.email) throw new CloudError("config", "ব্যাকআপ-কপির জন্য মূল অ্যাকাউন্ট থেকে আলাদা একটি Gmail বেছে নিন, নইলে একটি অ্যাকাউন্ট বন্ধ হলে দুটোই যাবে।");
  }
  await saveSession(which, s);
  return s;
}
export async function signOut(which: Which): Promise<void> {
  const s = await loadSession(which);
  if (s?.refreshToken) await revokeToken(s.refreshToken, authFetch);
  await clearSession(which);
}

async function ctx(db: Sql): Promise<Ctx & { sub: string; name: string | null }> {
  const o = await openDrive("primary");
  if (!o) throw new CloudError("revoked", "আগে Google ও Drive-এ লগইন করুন।");
  await o.tok.checkPermission();      // প্রতিটি সুরক্ষিত কাজের আগে অনুমতি যাচাই
  const cfg = await loadConfig();
  return { db, drive: o.drive, store: syncStore, device: cfg.deviceId, email: o.session.email, sub: o.session.sub, name: o.session.name,
    beforeReplace: async () => { await putSnapshot(db, `pre-${new Date().toISOString().replace(/[:.]/g, "-")}`); } };
}
const guard = async <T>(fn: () => Promise<T>): Promise<T> => {
  try { return await fn(); } catch (e) { if (needsReauth(e)) raise(e instanceof Error ? e.message : "Drive অনুমতি দরকার"); throw e; }
};

export const runEnter = (db: Sql, reload: () => void, mode: JoinMode) => guard(async () => { const c = await ctx(db); const r = await enterFamily({ ...c, mode }); reload(); return r; });
export const runSync = (db: Sql, reload: () => void): Promise<SyncResult> => guard(async () => { const r = await syncNow(await ctx(db)); if (r.status === "pulled") reload(); return r; });
export const runResolve = (db: Sql, reload: () => void, choice: "mine" | "theirs") => guard(async () => { const r = await resolveConflict(await ctx(db), choice); reload(); return r; });

export async function runDriveBackup(db: Sql, which: Which): Promise<DriveBackupResult> {
  return guard(async () => {
    const o = await openDrive(which);
    if (!o) throw new CloudError("revoked", which === "primary" ? "আগে Google Drive-এ লগইন করুন।" : "আগে দ্বিতীয় Drive অ্যাকাউন্ট যুক্ত করুন।");
    await o.tok.checkPermission();
    const cfg = await loadConfig();
    const r = await backupToDrive(db, o.drive, { partMb: cfg.partMb, keepDays: cfg.keepDays, kind: which === "primary" ? "drive" : "mirror", ...(which === "mirror" ? { rootName: "Our_Family_Archive_Mirror" } : {}) });
    await saveConfig(which === "primary" ? { lastDriveBackup: r.at } : { lastMirrorBackup: r.at });
    return r;
  });
}

/** অ্যাপ খোলা বা নেট ফেরার সময়: সিঙ্ক, তারপর দিনে একবার অটো-ব্যাকআপ। নেট না থাকলে চুপচাপ পরে চেষ্টা। */
export async function autoRun(db: Sql, reload: () => void): Promise<string | null> {
  const cfg = await loadConfig();
  if (!cfg.enforced || !(await loadSession("primary"))) return null;
  try {
    const r = await runSync(db, reload);
    if (cfg.autoBackup && db.all("SELECT 1 AS x FROM person LIMIT 1").length) {
      const stale = (iso: string | null) => !iso || Date.now() - new Date(iso).getTime() > 20 * 3600 * 1000;
      if (stale(cfg.lastDriveBackup)) await runDriveBackup(db, "primary");
      if (stale(cfg.lastMirrorBackup) && (await loadSession("mirror"))) await runDriveBackup(db, "mirror");
    }
    return r.status === "conflict" ? "conflict" : null;
  } catch (e) { return e instanceof CloudError && e.kind === "network" ? "offline" : (e instanceof Error ? e.message : String(e)); }
}
