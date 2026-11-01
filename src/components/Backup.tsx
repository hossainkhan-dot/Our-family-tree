import { useEffect, useState } from "react";
import { toBn } from "../core/relations";
import { exportBackup, parseBackup, restoreInto, serializeBackup, summarize, type Backup as B } from "../db/backup";
import { useDb } from "../db/DbContext";
import { exportGedcom, importGedcom } from "../db/gedcom";
import { findDuplicates } from "../core/relations";
import { addLog, buildPackage, readLog, readPackage } from "../db/package";
import { loadData } from "../db/repo";
import { saveOrShare, saveOrShareBytes } from "../db/share";
import { isZip } from "../db/zip";
import { useBack } from "../core/back";
import { listSnapshots, putSnapshot, snapshotBackup, type Snapshot } from "../db/snapshots";

const day = () => new Date().toISOString().slice(0, 10);
const when = (iso: string) => new Date(iso).toLocaleString("bn-BD", { dateStyle: "medium", timeStyle: "short" });

type Pending = { kind: "restore"; b: B; name: string; note?: string } | { kind: "gedcom"; text: string; name: string; count: number };

export default function Backup() {
  const { db, data, reload } = useDb();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  useBack(!!pending, () => setPending(null));
  const [snaps, setSnaps] = useState<Snapshot[]>([]);
  const refreshSnaps = () => listSnapshots().then(setSnaps).catch(() => setSnaps([]));
  useEffect(() => { void refreshSnaps(); }, []);

  const run = async (fn: () => Promise<string>) => {
    setBusy(true); setMsg(null);
    try { setMsg({ ok: true, text: await fn() }); }
    catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) }); }
    finally { setBusy(false); void refreshSnaps(); }
  };

  const exportZip = () => run(async () => {
    const p = await buildPackage(db);
    await saveOrShareBytes(p.filename, p.bytes, "application/zip");
    addLog(db, { at: p.at, kind: "zip", file: p.filename, sha256: p.sha256, people: p.people }); reload();
    return `ZIP ব্যাকআপ তৈরি হয়েছে (${toBn(p.people)} জন সদস্য)। ফাইলটি Google Drive-এ (যেকোনো অ্যাকাউন্টে), পেনড্রাইভে বা নিরাপদ জায়গায় রাখুন।\nচেকসাম (SHA-256): ${p.sha256}`;
  });
  const exportJson = () => run(async () => {
    const b = exportBackup(db), text = serializeBackup(b);
    await saveOrShare(`family-backup-${day()}.json`, text, "application/json");
    addLog(db, { at: b.exported_at, kind: "json", file: `family-backup-${day()}.json`, people: summarize(b).people }); reload();
    return "ব্যাকআপ ফাইল তৈরি হয়েছে। ফাইলটি Google Drive, ইমেইল বা অন্য কোনো নিরাপদ জায়গায় রেখে দিন।";
  });
  const exportGed = () => run(async () => {
    await saveOrShare(`family-tree-${day()}.ged`, exportGedcom(db), "text/plain");
    addLog(db, { at: new Date().toISOString(), kind: "ged", file: `family-tree-${day()}.ged`, people: data.people.length });
    return "GEDCOM ফাইল তৈরি হয়েছে। এটি অন্য যেকোনো বংশবৃক্ষ সফটওয়্যারে খোলা যাবে।";
  });

  const pickFile = (f: File | undefined) => {
    if (!f) return;
    void run(async () => {
      const bytes = new Uint8Array(await f.arrayBuffer());
      if (isZip(bytes)) {
        const r = await readPackage(bytes);
        setPending({ kind: "restore", b: r.backup, name: f.name, note: `✔ যাচাই সম্পন্ন: ${toBn(r.checked)}টি ফাইলের SHA-256 মিলেছে, কিছু বদলায়নি।` });
        return "ZIP ব্যাকআপ যাচাই হয়েছে, নিচে নিশ্চিত করুন।";
      }
      const text = new TextDecoder().decode(bytes);
      if (text.trimStart().startsWith("{")) setPending({ kind: "restore", b: parseBackup(text), name: f.name });
      else if (/^\s*0\s+HEAD/im.test(text)) setPending({ kind: "gedcom", text, name: f.name, count: (text.match(/^\s*0\s+@[^@]+@\s+INDI/gim) ?? []).length });
      else throw new Error("ফাইলটি চেনা যায়নি। .json ব্যাকআপ বা .ged ফাইল দিন।");
      return "ফাইল পড়া হয়েছে, নিচে নিশ্চিত করুন।";
    });
  };

  const restore = (b: B) => run(async () => {
    if (!db.reset) throw new Error("এই পরিবেশে ফিরিয়ে আনা সম্ভব নয়।");
    await putSnapshot(db, `pre-${new Date().toISOString().replace(/[:.]/g, "-")}`);   // safety copy of what is there now
    const before = exportBackup(db);
    try { db.reset(); restoreInto(db, b); }
    catch (e) { db.reset(); restoreInto(db, before); reload(); throw new Error(`ফিরিয়ে আনা যায়নি, আগের তথ্য যেমন ছিল তেমনই আছে। (${e instanceof Error ? e.message : e})`); }
    reload(); setPending(null);
    return `সফলভাবে ফিরিয়ে আনা হয়েছে: ${toBn(summarize(b).people)} জন সদস্য।`;
  });

  const importGed = (p: Extract<Pending, { kind: "gedcom" }>) => run(async () => {
    await putSnapshot(db, `pre-${new Date().toISOString().replace(/[:.]/g, "-")}`);
    const r = importGedcom(db, p.text, p.name);
    reload(); setPending(null);
    const dups = findDuplicates(loadData(db).people).length;
    return `${toBn(r.people)} জন সদস্য ও ${toBn(r.families)}টি পরিবার যোগ হয়েছে।` +
      (dups ? ` সতর্কতা: ${toBn(dups)} জোড়া একই নামের সদস্য পাওয়া গেছে, মিলিয়ে দেখুন।` : "") +
      (r.warnings.length ? `\nমন্তব্য:\n- ${r.warnings.slice(0, 8).join("\n- ")}` : "");
  });

  return (
    <section className="panel">
      <h1>ব্যাকআপ</h1>
      <p className="muted">আপনার তথ্য এখন শুধু এই ফোনে আছে। ফাইল-ব্যাকআপ নিয়ে অন্য জায়গায় রাখলে ফোন হারালেও কিছু হারাবে না।</p>
      {msg && <p className={msg.ok ? "notice" : "error"} role="status" style={{ whiteSpace: "pre-wrap" }}>{msg.text}</p>}

      <h2 className="sec">ব্যাকআপ নিন</h2>
      <div className="row">
        <button className="btn btn-primary" disabled={busy || !data.people.length} onClick={exportZip}>ZIP ব্যাকআপ (প্রস্তাবিত)</button>
        <button className="btn" disabled={busy || !data.people.length} onClick={exportJson}>শুধু JSON</button>
        <button className="btn" disabled={busy || !data.people.length} onClick={exportGed}>GEDCOM এক্সপোর্ট</button>
      </div>
      <p className="muted small">ZIP প্যাকেজে JSON, GEDCOM, README ও SHA-256 চেকসাম একসঙ্গে থাকে; ফিরিয়ে আনার আগে অ্যাপ প্রতিটি ফাইল যাচাই করে। যেকোনো ZIP-সফটওয়্যারে খোলা যায়। JSON ব্যাকআপে সব তথ্য, উৎস ও পরিবর্তনের History থাকে। GEDCOM হলো বংশবৃক্ষের আন্তর্জাতিক মান, ভবিষ্যতে যেকোনো সফটওয়্যারে নেওয়ার জন্য।</p>

      <h2 className="sec">ফাইল থেকে আনুন</h2>
      <label className="btn filebtn">ফাইল বেছে নিন (.zip, .json বা .ged)
        <input type="file" accept=".zip,.json,.ged,.gedcom,application/zip,application/json,text/plain" hidden onChange={(e) => { pickFile(e.target.files?.[0]); e.target.value = ""; }} />
      </label>
      {pending?.kind === "restore" && (
        <div className="card">
          <p><b>{pending.name}</b><br />{toBn(summarize(pending.b).people)} জন সদস্য · {when(pending.b.exported_at)}</p>
          {pending.note && <p className="notice">{pending.note}</p>}
          <p className="muted">এটি ফিরিয়ে আনলে বর্তমান সব তথ্য এই ফাইলের তথ্য দিয়ে বদলে যাবে। বদলানোর আগে বর্তমান তথ্যের একটি কপি অ্যাপের ভেতরে রাখা হবে।</p>
          <div className="row"><button className="btn danger" disabled={busy} onClick={() => restore(pending.b)}>হ্যাঁ, ফিরিয়ে আনুন</button><button className="btn" onClick={() => setPending(null)}>বাতিল</button></div>
        </div>
      )}
      {pending?.kind === "gedcom" && (
        <div className="card">
          <p><b>{pending.name}</b><br />{toBn(pending.count)} জন সদস্য পাওয়া গেছে</p>
          <p className="muted">এঁরা বর্তমান তথ্যের সঙ্গে যোগ হবে (কিছু মুছবে না)। একই ব্যক্তি আগে থেকে থাকলে ডুপ্লিকেট হতে পারে, তাই পরে মিলিয়ে দেখবেন।</p>
          <div className="row"><button className="btn btn-primary" disabled={busy} onClick={() => importGed(pending)}>যোগ করুন</button><button className="btn" onClick={() => setPending(null)}>বাতিল</button></div>
        </div>
      )}

      <h2 className="sec">ব্যাকআপের খাতা</h2>
      {readLog(db).length === 0 && <p className="muted small">এখনো কোনো ফাইল-ব্যাকআপ নেওয়া হয়নি।</p>}
      <div className="list">
        {readLog(db).slice(0, 8).map((e, i) => (
          <div key={i} className="snap"><div><b>{e.kind === "zip" ? "ZIP" : e.kind === "json" ? "JSON" : "GEDCOM"}</b> · {e.file}<br /><span className="muted small">{when(e.at)} · {toBn(e.people)} জন{e.sha256 ? ` · SHA-256: ${e.sha256.slice(0, 12)}…` : ""}</span></div></div>
        ))}
      </div>

      <h2 className="sec">অ্যাপের ভেতরের স্বয়ংক্রিয় কপি</h2>
      <p className="muted small">প্রতিদিন একবার নিজে থেকে কপি রাখা হয় (সর্বশেষ ১৪ দিন)। ভুলে কিছু মুছে গেলে এখান থেকে ফেরানো যাবে। অ্যাপ আনইনস্টল করলে এগুলোও যাবে, তাই ফাইল-ব্যাকআপ আলাদা রাখুন।</p>
      {snaps.length === 0 && <p className="muted">এখনো কোনো কপি নেই।</p>}
      <div className="list">
        {snaps.map((s) => (
          <div key={s.key} className="snap">
            <div><b>{s.key.startsWith("auto-") ? "স্বয়ংক্রিয়" : "পরিবর্তনের আগে"}</b><br /><span className="muted small">{when(s.at)} · {toBn(s.people)} জন</span></div>
            <button className="btn" disabled={busy} onClick={() => setPending({ kind: "restore", b: snapshotBackup(s), name: when(s.at) })}>ফেরান</button>
          </div>
        ))}
      </div>
    </section>
  );
}
