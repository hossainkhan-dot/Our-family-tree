import { useEffect, useState } from "react";
import { toBn } from "../core/relations";
import { can, currentMember, getMembers } from "../db/access";
import { useDb } from "../db/DbContext";
import { readPackage } from "../db/package";
import { fetchDriveBackup, listDriveBackups, type DriveBackupItem } from "../cloud/driveBackup";
import type { DeviceCode } from "../cloud/google";
import { openDrive, runDriveBackup, runResolve, runSync, signIn, signOut } from "../cloud/runtime";
import { ensureLayout } from "../cloud/sync";
import { loadConfig, loadSession, saveConfig, syncStore, type CloudConfig } from "../cloud/store";
import type { StoredSession } from "../cloud/session";
import type { SyncState } from "../cloud/sync";
import { RECHECK } from "./Gate";

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("bn-BD", { dateStyle: "medium", timeStyle: "short" }) : "এখনো হয়নি");
export const PART_CHOICES: [number, string][] = [[0, "একটি ফাইলে (ভাগ নয়)"], [5, "৫ MB করে"], [10, "১০ MB করে"], [25, "২৫ MB করে"], [50, "৫০ MB করে"], [100, "১০০ MB করে"]];

export default function CloudPanel({ onPickBytes }: { onPickBytes: (name: string, bytes: Uint8Array, note?: string) => void }) {
  const { db, reload } = useDb();
  const [cfg, setCfg] = useState<CloudConfig | null>(null);
  const [me, setMe] = useState<StoredSession | null>(null), [mirror, setMirror] = useState<StoredSession | null>(null);
  const [st, setSt] = useState<SyncState | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState<DeviceCode | null>(null);
  const [cid, setCid] = useState("");
  const [list, setList] = useState<DriveBackupItem[] | null>(null);
  const [shareTo, setShareTo] = useState(""), [listFor, setListFor] = useState<"primary" | "mirror">("primary");
  const actor = currentMember(db);

  const refresh = async () => { const c = await loadConfig(); setCfg(c); setCid(c.webClientId); setMe(await loadSession("primary")); setMirror(await loadSession("mirror")); setSt(await syncStore.load()); };
  useEffect(() => { void refresh(); }, []);
  const run = async (fn: () => Promise<string>) => {
    setBusy(true); setMsg(null);
    try { setMsg({ ok: true, text: await fn() }); } catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) }); }
    finally { setBusy(false); setCode(null); void refresh(); }
  };
  if (!cfg) return null;
  const setupDone = !!cfg.webClientId || (!!cfg.clientId && !!cfg.clientSecret);

  const enable = () => run(async () => { await saveConfig({ enforced: true }); window.dispatchEvent(new Event(RECHECK)); return "Google লগইন চালু হয়েছে।"; });
  const addMirror = () => run(async () => { const s = await signIn("mirror", setCode, { aborted: false }); return `${s.email} যুক্ত হয়েছে। এখন থেকে ব্যাকআপের একটি কপি ওই Drive-এও যাবে।`; });
  const sync = () => run(async () => {
    const r = await runSync(db, reload);
    if (r.status === "conflict") return "দ্বন্দ্ব: এই ফোনে ও Drive-এ দুই জায়গাতেই পরিবর্তন হয়েছে। কিছু বদলানো হয়নি। নিচে কোনটি রাখবেন বেছে নিন।";
    return { uptodate: "সব হালনাগাদ আছে।", pushed: `Drive-এ ${toBn(r.revision)} নম্বর সংস্করণ হিসেবে উঠেছে।`, pulled: `Drive থেকে ${toBn(r.revision)} নম্বর সংস্করণ এসেছে।`, initialized: "Drive-এ পরিবারের সংরক্ষণাগার তৈরি হয়েছে।" }[r.status];
  });
  const backup = (w: "primary" | "mirror") => run(async () => {
    const r = await runDriveBackup(db, w);
    return `Drive-এ ব্যাকআপ রাখা ও যাচাই হয়েছে (${toBn(r.people)} জন সদস্য, ${toBn(r.files.length)}টি ফাইল)।${r.removed.length ? ` পুরোনো ${toBn(r.removed.length)}টি ব্যাকআপ নিয়ম মেনে সরানো হয়েছে।` : ""}\nSHA-256: ${r.sha256}`;
  });
  const showList = (w: "primary" | "mirror") => run(async () => {
    const o = await openDrive(w); if (!o) throw new Error("আগে লগইন করুন।");
    await o.tok.checkPermission();
    setListFor(w); setList(await listDriveBackups(o.drive, w === "mirror" ? "Our_Family_Archive_Mirror" : undefined));
    return "Drive-এর ব্যাকআপ তালিকা এসেছে।";
  });
  const fetchOne = (w: "primary" | "mirror", base: string) => run(async () => {
    const o = await openDrive(w); if (!o) throw new Error("আগে লগইন করুন।");
    const bytes = await fetchDriveBackup(o.drive, base, w === "mirror" ? "Our_Family_Archive_Mirror" : undefined);
    const r = await readPackage(bytes);
    onPickBytes(base, bytes, `✔ Drive থেকে নামানো ও যাচাই সম্পন্ন: ${toBn(r.checked)}টি ফাইলের SHA-256 মিলেছে।`);
    return "ব্যাকআপ যাচাই হয়েছে, ওপরে 'ফাইল থেকে আনুন' অংশে নিশ্চিত করুন।";
  });
  const share = () => run(async () => {
    const m = getMembers(db).find((x) => x.email === shareTo); if (!m) throw new Error("সদস্য বেছে নিন।");
    const o = await openDrive("primary"); if (!o) throw new Error("আগে লগইন করুন।");
    const l = await ensureLayout(o.drive);
    await o.drive.share(l.root, m.email, m.role === "viewer" ? "reader" : "writer");
    return `${m.email}-কে Drive ফোল্ডারে ${m.role === "viewer" ? "শুধু দেখার" : "লেখার"} অনুমতি দেওয়া হয়েছে। (Drive-এর অনুমতি আর অ্যাপের Role আলাদা: অ্যাপে সদস্যের ক্ষমতা ডেটাবেস নিয়মেই ঠিক হয়।)`;
  });

  return (
    <>
      <h2 className="sec">Google Drive: ব্যাকআপ ও সিঙ্ক</h2>
      {msg && <p className={msg.ok ? "notice" : "error"} role="status" style={{ whiteSpace: "pre-wrap" }}>{msg.text}</p>}
      {code && (
        <div className="card">
          <p>Google-এ <a href={code.verificationUrl} target="_blank" rel="noopener noreferrer">{code.verificationUrl}</a> খুলে এই কোড দিন:</p>
          <p style={{ fontSize: "1.6rem", letterSpacing: "0.12em", color: "var(--gold)" }}>{code.userCode}</p>
        </div>
      )}

      {!setupDone && (
        <div className="card">
          <p><b>প্রথমে Google সেটআপ</b></p>
          <p className="muted small">একবার Google Cloud-এ বিনামূল্যে প্রকল্প খুলে "Web application" Client ID বানাতে হবে (docs/GOOGLE_SETUP.md)। ID অ্যাপের কোডে বসানো থাকলে এটি আর দেখাবে না।</p>
          <div className="field"><input placeholder="Web Client ID" value={cid} onChange={(e) => setCid(e.target.value)} autoCapitalize="off" autoCorrect="off" /></div>
          <button className="btn btn-primary" disabled={busy || !cid.trim()} onClick={() => void run(async () => { await saveConfig({ webClientId: cid.trim() }); return "Google সেটিং সংরক্ষিত হয়েছে।"; })}>সংরক্ষণ</button>
        </div>
      )}

      {setupDone && !cfg.enforced && (
        <div className="card">
          <p>Google লগইন এখনো বন্ধ; অ্যাপ শুধু এই ফোনেই চলছে। চালু করলে Google ও Drive অনুমতি ছাড়া ঢোকা যাবে না, তথ্য Drive-এ সংরক্ষিত ও পরিবারের সঙ্গে সিঙ্ক হবে।</p>
          <button className="btn btn-primary" disabled={busy} onClick={() => void enable()}>Google লগইন চালু করুন</button>
        </div>
      )}

      {setupDone && cfg.enforced && me && (
        <>
          <div className="card">
            <p><b>{me.email}</b><br /><span className="muted small">শেষ সিঙ্ক: {when(st?.lastSyncAt ?? null)} · সংস্করণ {toBn(st?.baseRevision ?? 0)}</span></p>
            {st?.conflict && (
              <div className="error">
                <p>দ্বন্দ্ব: এই ফোনে ও Drive-এ দুই জায়গাতেই পরিবর্তন হয়েছে (Drive-এ সংস্করণ {toBn(st.conflict.remoteRevision)})। কিছু হারাবে না: যেটি বাদ পড়বে সেটি Drive-এ আলাদা ফাইলে থেকে যাবে।</p>
                <div className="row">
                  <button className="btn" disabled={busy} onClick={() => void run(async () => { await runResolve(db, reload, "theirs"); return "Drive-এরটি নেওয়া হয়েছে।"; })}>Drive-এরটি নিই</button>
                  <button className="btn danger" disabled={busy} onClick={() => void run(async () => { await runResolve(db, reload, "mine"); return "এই ফোনেরটি রাখা হয়েছে।"; })}>এই ফোনেরটি রাখি</button>
                </div>
              </div>
            )}
            <div className="row">
              <button className="btn btn-primary" disabled={busy} onClick={() => void sync()}>এখনই সিঙ্ক</button>
              <button className="btn" disabled={busy} onClick={() => void backup("primary")}>Drive-এ ব্যাকআপ রাখুন</button>
              <button className="btn" disabled={busy} onClick={() => void showList("primary")}>Drive-এর ব্যাকআপ দেখুন</button>
            </div>
            <p className="muted small">সর্বশেষ Drive ব্যাকআপ: {when(cfg.lastDriveBackup)}</p>
            <label className="check"><input type="checkbox" checked={cfg.autoBackup} onChange={(e) => void saveConfig({ autoBackup: e.target.checked }).then(refresh)} /> অ্যাপ খুললে দিনে একবার নিজে থেকে Drive-এ ব্যাকআপ</label>
            <p className="muted small">অ্যাপ বন্ধ থাকলে ফোন ব্যাকগ্রাউন্ডে ব্যাকআপ চালাতে দেয় না, তাই অটো-ব্যাকআপ অ্যাপ খোলার সময় বা নেট ফেরার সময় চলে।</p>
          </div>

          {can(actor, "manage_members") && (
            <div className="card">
              <p><b>সদস্যের সঙ্গে Drive ফোল্ডার শেয়ার</b></p>
              <div className="row">
                <select value={shareTo} onChange={(e) => setShareTo(e.target.value)} aria-label="সদস্য">
                  <option value="">সদস্য বেছে নিন</option>
                  {getMembers(db).filter((m) => m.email !== me.email).map((m) => <option key={m.id} value={m.email}>{m.name || m.email}</option>)}
                </select>
                <button className="btn" disabled={busy || !shareTo} onClick={() => void share()}>শেয়ার করুন</button>
              </div>
            </div>
          )}

          <div className="card">
            <p><b>অন্য Drive অ্যাকাউন্টে ব্যাকআপ-কপি</b></p>
            <p className="muted small">একটি Google অ্যাকাউন্ট বন্ধ হলেও ইতিহাস যেন থাকে, তাই আলাদা Gmail-এর Drive-এও একটি ব্যাকআপ রাখা যায়।</p>
            {mirror ? (
              <>
                <p>{mirror.email} <span className="muted small">· শেষ কপি: {when(cfg.lastMirrorBackup)}</span></p>
                <div className="row">
                  <button className="btn" disabled={busy} onClick={() => void backup("mirror")}>এখন কপি করুন</button>
                  <button className="btn" disabled={busy} onClick={() => void showList("mirror")}>তালিকা</button>
                  <button className="btn danger" disabled={busy} onClick={() => void run(async () => { await signOut("mirror"); return "দ্বিতীয় অ্যাকাউন্ট সরানো হয়েছে (Drive-এর কপি যেমন ছিল তেমনই আছে)।"; })}>সরান</button>
                </div>
              </>
            ) : <button className="btn" disabled={busy} onClick={() => void addMirror()}>দ্বিতীয় Google অ্যাকাউন্ট যুক্ত করুন</button>}
          </div>

          {list && (
            <div className="list">
              {list.length === 0 && <p className="muted">Drive-এ এখনো কোনো ব্যাকআপ নেই।</p>}
              {list.map((b) => (
                <div key={b.base} className="snap">
                  <div><b>{b.base}</b><br /><span className="muted small">{b.parts ? `${toBn(b.parts)} অংশ · ` : ""}{when(b.at)}</span></div>
                  <button className="btn" disabled={busy} onClick={() => void fetchOne(listFor, b.base)}>ফেরান</button>
                </div>
              ))}
            </div>
          )}

          <p><button className="btn danger" disabled={busy} onClick={() => void run(async () => { await signOut("primary"); await saveConfig({ enforced: false }); window.dispatchEvent(new Event(RECHECK)); return "লগইন বন্ধ করা হয়েছে। Drive-এর তথ্য যেমন ছিল তেমনই আছে।"; })}>Google থেকে লগআউট ও অনুমতি তুলে নেওয়া</button></p>
        </>
      )}
      <h2 className="sec">ব্যাকআপ ZIP-এর আকার</h2>
      <PartSize cfg={cfg} onChange={(n) => void saveConfig({ partMb: n }).then(refresh)} />
    </>
  );
}

export function PartSize({ cfg, onChange }: { cfg: CloudConfig; onChange: (n: number) => void }) {
  return (
    <div className="field">
      <select value={cfg.partMb} onChange={(e) => onChange(Number(e.target.value))} aria-label="ZIP অংশের আকার">
        {PART_CHOICES.map(([n, l]) => <option key={n} value={n}>{l}</option>)}
      </select>
      <small>ব্যাকআপ এর চেয়ে বড় হলে ভাগ হয়ে .zip.001, .zip.002 ... হিসেবে যাবে (সঙ্গে .parts.json তালিকা)। অংশগুলো অ্যাপ ছাড়াও জোড়া যায়। ফোন, Drive ও পেনড্রাইভ — সব জায়গার ব্যাকআপেই এটি খাটে।</small>
    </div>
  );
}
