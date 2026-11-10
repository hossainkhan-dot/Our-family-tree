import { useState, type ReactNode } from "react";
import { toBn } from "../core/relations";
import * as A from "../db/access";
import { useDb } from "../db/DbContext";
import { explainError } from "../db/repo";
import Explore from "./Explore";
import VoicePacks from "./VoicePacks";

type Sec = "explore" | "members" | "approvals" | "history" | "voice" | "progress";
const when = (iso: string) => new Date(iso).toLocaleString("bn-BD", { dateStyle: "medium", timeStyle: "short" });
const REQ_BN: Record<string, string> = { applied: "প্রয়োগ হয়েছে", rejected: "প্রত্যাখ্যাত", failed: "প্রয়োগ হয়নি", cancelled: "বাতিল" };

export default function Manage({ progress, onOpenProfile }: { progress: ReactNode; onOpenProfile: (id: string) => void }) {
  const { db, reload } = useDb();
  const [sec, setSec] = useState<Sec>("explore");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [, tick] = useState(0);
  const me = A.currentMember(db);
  const act = (fn: () => string | void) => {
    try { const t = fn(); setMsg(t ? { ok: true, text: t } : null); } catch (e) { setMsg({ ok: false, text: explainError(e) }); }
    tick((x) => x + 1); reload();
  };

  return (
    <section className="panel">
      <h1>আরও</h1>
      <div className="chips" role="tablist">
        {([["explore", "অন্বেষণ"], ["members", "সদস্য ও Role"], ["approvals", "অনুমোদন"], ["history", "History"], ["voice", "গেমিং ভয়েস"], ["progress", "অগ্রগতি"]] as [Sec, string][]).map(([k, l]) => (
          <button key={k} type="button" role="tab" aria-selected={sec === k} className={sec === k ? "on" : ""} onClick={() => { setSec(k); setMsg(null); }}>{l}</button>
        ))}
      </div>
      {msg && <p className={msg.ok ? "notice" : "error"} role="status">{msg.text}</p>}
      {sec === "explore" && <Explore onOpenProfile={onOpenProfile} />}
      {sec === "members" && <Members me={me} act={act} />}
      {sec === "approvals" && <Approvals me={me} act={act} />}
      {sec === "history" && <History />}
      {sec === "voice" && <VoicePacks />}
      {sec === "progress" && progress}
    </section>
  );
}

type Act = (fn: () => string | void) => void;

function Members({ me, act }: { me: A.Member | null; act: Act }) {
  const { db } = useDb();
  const [email, setEmail] = useState(""), [name, setName] = useState(""), [role, setRole] = useState<A.Role>("editor");
  const [oe, setOe] = useState(""), [on, setOn] = useState("");
  const list = A.getMembers(db);
  const roles = A.assignable(me);
  return (
    <>
      {!list.length && (
        <div className="card">
          <p><b>মালিক ঠিক করুন</b></p>
          <p className="muted small">এটি আপনার Gmail। Google লগইন চালু করলে (ব্যাকআপ ট্যাব) এই Gmail দিয়েই আপনার পরিচয় যাচাই হবে।</p>
          <div className="field"><input type="email" placeholder="আপনার Gmail" value={oe} onChange={(e) => setOe(e.target.value)} /></div>
          <div className="field"><input placeholder="আপনার নাম" value={on} onChange={(e) => setOn(e.target.value)} /></div>
          <button className="btn btn-primary" onClick={() => act(() => { A.ensureOwner(db, oe, on); return "মালিক ঠিক হয়েছে।"; })}>নিশ্চিত করুন</button>
        </div>
      )}
      <div className="list">
        {list.map((m) => (
          <div key={m.id} className="card">
            <p><b>{m.name || m.email}</b>{m.id === me?.id ? " (আপনি)" : ""}<br /><span className="muted small">{m.email} · {A.STATUS_BN[m.status]}</span></p>
            {A.canManage(me, m) ? (
              <div className="row">
                <select aria-label="Role" value={m.role} onChange={(e) => act(() => { A.changeRole(db, me, m.id, e.target.value as A.Role); return "Role বদলানো হয়েছে।"; })}>
                  {[...new Set<A.Role>([m.role, ...roles])].map((r) => <option key={r} value={r} disabled={!roles.includes(r)}>{A.ROLE_BN[r]}</option>)}
                </select>
                {m.status !== "invited" && <button className="btn" onClick={() => act(() => { A.setMemberStatus(db, me, m.id, m.status === "suspended" ? "active" : "suspended"); })}>{m.status === "suspended" ? "চালু করুন" : "স্থগিত করুন"}</button>}
              </div>
            ) : <span className="status pending">{A.ROLE_BN[m.role]}</span>}
          </div>
        ))}
      </div>
      {A.can(me, "manage_members") && me && (
        <div className="card">
          <p><b>নতুন সদস্য আমন্ত্রণ</b></p>
          <div className="field"><input type="email" placeholder="Gmail ঠিকানা" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
          <div className="field"><input placeholder="নাম (ঐচ্ছিক)" value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div className="field"><select value={role} onChange={(e) => setRole(e.target.value as A.Role)}>{roles.map((r) => <option key={r} value={r}>{A.ROLE_BN[r]}</option>)}</select></div>
          <button className="btn btn-primary" onClick={() => act(() => { A.inviteMember(db, me, { email, name, role }); setEmail(""); setName(""); return "তালিকায় যোগ হয়েছে। এই Gmail দিয়ে লগইন করলেই সদস্য সক্রিয় হবেন।"; })}>আমন্ত্রণ যোগ করুন</button>
        </div>
      )}
      <p className="muted small">Role: মালিক → অ্যাডমিন → সম্পাদক → দর্শক (বড় থেকে ছোট)। মালিক ও অ্যাডমিনের পরিবর্তন সরাসরি প্রয়োগ হয়; সম্পাদকের পরিবর্তন অনুমোদনের অপেক্ষায় থাকে; দর্শক শুধু দেখতে পারেন।</p>
    </>
  );
}

function Approvals({ me, act }: { me: A.Member | null; act: Act }) {
  const { db } = useDb();
  const need = A.getApprovalsRequired(db);
  const pending = A.listRequests(db, true), done = A.listRequests(db, false, 10);
  return (
    <>
      <div className="card">
        <p><b>অনুমোদনের নিয়ম</b><br /><span className="muted small">সম্পাদকের পরিবর্তন প্রয়োগ হতে {toBn(need)} জন আলাদা সদস্যের অনুমোদন লাগে। জমাদাতা নিজেরটি অনুমোদন করতে পারেন না।</span></p>
        <div className="chips">
          {[2, 3].map((n) => <button key={n} type="button" className={need === n ? "on" : ""} disabled={!A.can(me, "settings")} onClick={() => act(() => { A.setApprovalsRequired(db, me, n); })}>{toBn(n)} জন</button>)}
        </div>
        {!A.can(me, "settings") && <p className="muted small">শুধু মালিক এটি বদলাতে পারেন।</p>}
      </div>
      <h2 className="sec">অপেক্ষমান</h2>
      {pending.length === 0 && <p className="muted">কোনো অনুরোধ অপেক্ষায় নেই।</p>}
      {pending.map((r) => {
        const voted = r.votes.some((x) => x.voter === me?.id);
        const eligible = !!me && A.can(me, "vote") && me.id !== r.submittedBy && !voted;
        return (
          <div className="card" key={r.id}>
            <p><b>{r.summary}</b><br /><span className="muted small">জমা: {r.submitter} · {when(r.createdAt)}<br />অনুমোদন {toBn(r.approvals)}/{toBn(r.needed)}{r.rejections ? ` · প্রত্যাখ্যান ${toBn(r.rejections)}` : ""}</span></p>
            {r.votes.map((v, i) => <p className="muted small" key={i}>{v.decision === "approve" ? "✔" : "✘"} {v.voterName}</p>)}
            <div className="row">
              {eligible && <button className="btn btn-primary" onClick={() => act(() => { const s = A.vote(db, me, r.id, "approve"); return s === "applied" ? "অনুমোদন পূর্ণ হয়েছে, পরিবর্তন প্রয়োগ হয়েছে।" : s === "failed" ? "প্রয়োগ করা যায়নি, কারণ রেকর্ডে আছে।" : "আপনার অনুমোদন নথিভুক্ত হয়েছে।"; })}>অনুমোদন</button>}
              {eligible && <button className="btn danger" onClick={() => act(() => { A.vote(db, me, r.id, "reject"); })}>প্রত্যাখ্যান</button>}
              {(me?.id === r.submittedBy || A.can(me, "manage_members")) && <button className="btn" onClick={() => act(() => { A.cancelRequest(db, me, r.id); })}>বাতিল</button>}
            </div>
            {me && !eligible && <p className="muted small">{me.id === r.submittedBy ? "এটি আপনার নিজের জমা, অন্যরা অনুমোদন দেবেন।" : voted ? "আপনি ভোট দিয়েছেন।" : ""}</p>}
          </div>
        );
      })}
      {done.length > 0 && <><h2 className="sec">সাম্প্রতিক সিদ্ধান্ত</h2>
        <div className="list">{done.map((r) => <div className="snap" key={r.id}><div><b>{r.summary}</b><br /><span className="muted small">{REQ_BN[r.status] ?? r.status} · {r.submitter}{r.error ? ` · ${r.error}` : ""}</span></div></div>)}</div></>}
      <p className="muted small">অন্য সদস্যদের ভোট আপনার ফোনে আসে শেয়ার্ড Drive সিঙ্কের মাধ্যমে (ব্যাকআপ ট্যাবে Google লগইন চালু থাকলে)।</p>
    </>
  );
}

function History() {
  const { db } = useDb();
  const rows = A.history(db, 100);
  return (
    <>
      <p className="muted small">সব পরিবর্তন এখানে জমা থাকে, কেউ মুছতে বা বদলাতে পারে না। সর্বশেষ ১০০টি দেখানো হচ্ছে।</p>
      {rows.length === 0 && <p className="muted">এখনো কোনো পরিবর্তন নেই।</p>}
      <div className="list">
        {rows.map((r) => (
          <div className="snap" key={r.id}><div><b>{A.TABLE_BN[r.table] ?? r.table} · {A.ACTION_BN[r.action] ?? r.action}</b>{r.detail ? ` · ${r.detail.slice(0, 40)}` : ""}<br /><span className="muted small">{when(r.at)} · {r.actor}</span></div></div>
        ))}
      </div>
    </>
  );
}
