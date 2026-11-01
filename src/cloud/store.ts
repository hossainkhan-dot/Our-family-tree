import { FILES, idbDelete, idbGet, idbPut } from "../db/idb";
import { WEB_CLIENT_ID } from "./baked";
import type { StoredSession } from "./session";
import type { StateStore, SyncState } from "./sync";

/** এই ফোনের ক্লাউড সেটিং (ডেটাবেসের বাইরে, তাই Restore/সিঙ্কে হারায় না এবং ব্যাকআপ ফাইলে যায় না)। */
export interface CloudConfig {
  clientId: string; clientSecret: string;   // শুধু ব্রাউজার/কোড-পদ্ধতির (বিকল্প) জন্য
  webClientId: string;                       // ফোনের এক-ট্যাপ লগইনের জন্য
  enforced: boolean;               // true হলে Google + Drive অনুমতি ছাড়া অ্যাপে ঢোকা যাবে না
  partMb: number;                  // ব্যাকআপ ZIP-এর প্রতিটি অংশের আকার (MB); 0 = ভাগ নয়
  autoBackup: boolean; keepDays: number;
  lastDriveBackup: string | null; lastMirrorBackup: string | null;
  deviceId: string;
}
const DEF: CloudConfig = { clientId: "", clientSecret: "", webClientId: WEB_CLIENT_ID, enforced: !!WEB_CLIENT_ID, partMb: 0, autoBackup: true, keepDays: 30, lastDriveBackup: null, lastMirrorBackup: null, deviceId: "" };
const K = { cfg: "cloud-config", primary: "cloud-session", mirror: "cloud-session-mirror", sync: "cloud-sync-state" };
export type Which = "primary" | "mirror";

export async function loadConfig(): Promise<CloudConfig> {
  let c: Partial<CloudConfig> | null = null;
  try { c = await idbGet<Partial<CloudConfig>>(FILES, K.cfg); } catch { /* ডিফল্ট */ }
  const cfg = { ...DEF, ...(c ?? {}) };
  if (WEB_CLIENT_ID) cfg.webClientId = WEB_CLIENT_ID;
  if (!cfg.deviceId) { cfg.deviceId = `d${Math.random().toString(36).slice(2, 8)}`; try { await idbPut(FILES, K.cfg, cfg); } catch { /* পরেরবার */ } }
  return cfg;
}
export async function saveConfig(patch: Partial<CloudConfig>): Promise<CloudConfig> {
  const next = { ...(await loadConfig()), ...patch };
  await idbPut(FILES, K.cfg, next);
  return next;
}
export const loadSession = (w: Which) => idbGet<StoredSession>(FILES, K[w]).catch(() => null);
export const saveSession = (w: Which, s: StoredSession) => idbPut(FILES, K[w], s);
export const clearSession = (w: Which) => idbDelete(FILES, K[w]);
export const syncStore: StateStore = {
  load: () => idbGet<SyncState>(FILES, K.sync).catch(() => null),
  save: (s) => idbPut(FILES, K.sync, s),
};
export const clearSyncState = () => idbDelete(FILES, K.sync);
