import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { currentMember } from "../db/access";
import { useDb } from "../db/DbContext";
import { CloudError, needsReauth } from "../cloud/errors";
import type { DeviceCode } from "../cloud/google";
import { autoRun, onAuthIssue, openDrive, runEnter, signIn, signOut } from "../cloud/runtime";
import { loadConfig, loadSession, saveConfig } from "../cloud/store";

type Phase = "boot" | "open" | "consent" | "device" | "working" | "choose" | "locked";
export const RECHECK = "fla-cloud-recheck";

/** লগইনের সাতটি ধাপ এখানে বাধ্যতামূলক (সেটিংসে "Google লগইন চালু" করলে):
 *  ১ Google অ্যাকাউন্ট বাছাই ২ পরিচয় যাচাই ৩–৪ গোপনীয়তা সম্মতি + Drive অনুমতি ৫ অনুমতি সত্যিই এসেছে কিনা যাচাই ৬ সদস্যপদ যাচাই ৭ ড্যাশবোর্ড। */
export default function Gate({ children }: { children: ReactNode }) {
  const dbc = useDb();
  const { db } = dbc;
  const live = useRef(dbc); live.current = dbc;                 // reload প্রতি রেন্ডারে নতুন হয়, তাই রেফ দিয়ে ধরি (নইলে লুপ)
  const reload = useCallback(() => live.current.reload(), []);
  const [phase, setPhase] = useState<Phase>("boot");
  const [msg, setMsg] = useState<string | null>(null);
  const [agree, setAgree] = useState(false);
  const [code, setCode] = useState<DeviceCode | null>(null);
  const [need, setNeed] = useState<"create" | "join" | null>(null);
  const abort = useRef({ aborted: false });

  const check = useCallback(async () => {
    const { db } = live.current;
    const cfg = await loadConfig();
    if (!cfg.enforced) { setPhase("open"); return; }
    const s = await loadSession("primary");
    if (!s) { setPhase("consent"); return; }
    try {
      const o = await openDrive("primary");
      await o?.tok.checkPermission();
      const m = currentMember(db);
      if (!m || m.email !== s.email) { setPhase("consent"); setMsg("এই ফোনে সদস্যপদ যাচাই করতে আবার লগইন করুন।"); return; }
      setPhase("open");
      void autoRun(db, reload);
    } catch (e) {
      if (needsReauth(e)) { setMsg(e instanceof Error ? e.message : null); setPhase("consent"); return; }
      const m = currentMember(db);          // অফলাইন: আগে নামানো তথ্য দেখা যাবে, তবে আগে একবার যাচাই হওয়া সদস্য হতে হবে
      if (m && m.email === s.email) setPhase("open"); else setPhase("consent");
    }
  }, [reload]);

  useEffect(() => { void check(); }, [check]);
  useEffect(() => {
    const h = () => void check();
    const on = () => { void autoRun(live.current.db, reload); };
    window.addEventListener(RECHECK, h);
    window.addEventListener("online", on);
    const off = onAuthIssue((r) => { setMsg(r); setPhase("consent"); });
    return () => { window.removeEventListener(RECHECK, h); window.removeEventListener("online", on); off(); };
  }, [check, reload]);

  const enter = async (mode: "auto" | "create" | "join") => {
    setPhase("working"); setMsg(null);
    try { await runEnter(db, reload, mode); setPhase("open"); void autoRun(db, reload); }
    catch (e) {
      const k = e instanceof CloudError ? e.kind : "";
      setMsg(e instanceof Error ? e.message : String(e));
      if (k === "notfound") setNeed("create");
      else if (k === "conflict") setNeed("join");
      else { setNeed(null); await signOut("primary"); }
      setPhase("choose");
    }
  };
  const start = async () => {
    setPhase("device"); setMsg(null); abort.current = { aborted: false };
    try { await signIn("primary", setCode, abort.current); await enter("auto"); }
    catch (e) { setMsg(e instanceof Error ? e.message : String(e)); setPhase("consent"); }
  };

  /** এখনো কোনো সদস্য ঠিক হয়নি (কেউ সফল লগইন করেনি) অবস্থায় আটকে গেলে নিজের তথ্যে ঢোকার পথ: লগইন-বাধ্যতা বন্ধ করা। */
  const canEscape = !db.all("SELECT 1 AS x FROM member LIMIT 1").length;
  const escape = canEscape ? (
    <p><button className="btn" onClick={() => { void saveConfig({ enforced: false }).then(check); }}>Google লগইন বন্ধ করে এই ফোনের তথ্যে ফিরুন</button></p>
  ) : null;

  if (phase === "open") return <>{children}</>;
  if (phase === "boot") return <main className="panel"><p className="muted">প্রস্তুত হচ্ছে…</p></main>;
  if (phase === "working") return <main className="panel"><p className="muted">পরিবারের তথ্য যাচাই ও সিঙ্ক হচ্ছে…</p></main>;
  return (
    <main className="panel gate" role="dialog" aria-modal="true" aria-labelledby="gate-title">
      {phase === "consent" && (
        <>
          <h1 id="gate-title">আপনার Family Tree তথ্যের নিরাপদ সংরক্ষণ ও শেয়ারিং</h1>
          <p>আপনি যখন এই অ্যাপের মাধ্যমে Google Account এবং Google Drive Permission প্রদান করবেন, তখন অ্যাপটি আপনার অনুমোদিত Family Tree-সংক্রান্ত তথ্য Google Drive-এর নির্দিষ্ট Family Archive Folder-এ সংরক্ষণ ও Synchronize করবে।</p>
          <p>আপনার অনুমোদিত পারিবারিক তথ্য পরিবারের অনুমোদিত সদস্যদের সঙ্গে শেয়ার করা হতে পারে।</p>
          <p>আপনার ব্যক্তিগত Google Drive-এর অন্যান্য ছবি, ভিডিও, Documents, Gmail, Contacts অথবা অন্য কোনো ব্যক্তিগত তথ্য অ্যাপ অ্যাক্সেস করবে না।</p>
          <p>আপনার Google Password অ্যাপ সংরক্ষণ করবে না।</p>
          <p>আপনি কেবল Family Tree-এর তথ্য সংরক্ষণ, Synchronization এবং পারিবারিক তথ্য শেয়ার করার জন্য প্রয়োজনীয় Permission প্রদান করছেন।</p>
          <label className="check"><input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} /> আমি Privacy Policy ও Data Sharing Policy পড়েছি এবং সম্মতি দিচ্ছি।</label>
          {msg && <p className="error" role="alert">{msg}</p>}
          <div className="row">
            <button className="btn btn-primary" disabled={!agree} onClick={() => void start()}>Continue with Google &amp; Drive Permission</button>
            <button className="btn" onClick={() => { setPhase("locked"); setMsg(null); }}>Cancel</button>
          </div>
          <p className="muted small">এরপর Google-এর নিজস্ব অনুমতি-পর্দা দেখাবে। সেখানে Drive-এর অনুমতির বাক্সটিও টিক দিতে হবে।</p>
          {escape}
        </>
      )}
      {phase === "device" && (
        <>
          <h1 id="gate-title">Google-এ অনুমতি দিন</h1>
          {!code ? <p className="muted">Google-এর সঙ্গে সংযোগ হচ্ছে…</p> : (
            <>
              <p>১. নিচের ঠিকানা খুলুন (এই ফোনে বা অন্য যেকোনো ডিভাইসে):</p>
              <p><a className="btn" href={code.verificationUrl} target="_blank" rel="noopener noreferrer">{code.verificationUrl}</a></p>
              <p>২. এই কোডটি লিখুন:</p>
              <p style={{ fontSize: "2rem", letterSpacing: "0.15em", color: "var(--gold)", textAlign: "center" }}>{code.userCode}</p>
              <p>৩. আপনার Gmail বেছে নিন এবং Google-এর পর্দায় <b>Google Drive-এর অনুমতিও</b> দিন।</p>
              <p className="muted small">অনুমতি দেওয়া হলে এই পর্দা নিজে থেকে এগোবে। কোডটি প্রায় {Math.round(code.expiresIn / 60)} মিনিট চলবে।</p>
            </>
          )}
          <button className="btn" onClick={() => { abort.current.aborted = true; setPhase("consent"); }}>বাতিল</button>
        </>
      )}
      {phase === "choose" && (
        <>
          <h1 id="gate-title">পরিবারের সদস্যপদ</h1>
          {msg && <p className="error" role="alert">{msg}</p>}
          <div className="row">
            {need === "create" && <button className="btn btn-primary" onClick={() => void enter("create")}>নতুন পরিবার শুরু করুন (আমি মালিক)</button>}
            {need === "join" && <button className="btn btn-primary" onClick={() => void enter("join")}>Drive-এর তথ্য নিন (এই ফোনের তথ্যের কপি আগে অ্যাপের ভেতরে রাখা হবে)</button>}
            <button className="btn" onClick={() => { void signOut("primary"); setNeed(null); setMsg(null); setPhase("consent"); }}>অন্য Gmail দিয়ে চেষ্টা</button>
          </div>
        </>
      )}
      {phase === "locked" && (
        <>
          <h1 id="gate-title">লগইন দরকার</h1>
          <p className="muted">Google অ্যাকাউন্ট ও Drive অনুমতি ছাড়া অ্যাপের ভেতরে ঢোকা যাবে না।</p>
          <button className="btn btn-primary" onClick={() => setPhase("consent")}>আবার শুরু করুন</button>
          {escape}
        </>
      )}
    </main>
  );
}
