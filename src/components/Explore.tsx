import { useMemo, useState } from "react";
import { toBn } from "../core/relations";
import { useDb } from "../db/DbContext";
import { EVENT_BN, addEvent, dashboard, places, project, searchAll, setPlaceCoords, timeline } from "../db/explore";
import { explainError, formatDate } from "../db/repo";

type Sec = "dash" | "search" | "time" | "map";
const when = (iso: string) => new Date(iso).toLocaleString("bn-BD", { dateStyle: "medium", timeStyle: "short" });
const pct = (a: number, b: number) => (b ? `${toBn(Math.round((a * 100) / b))}%` : "—");

export default function Explore({ onOpenProfile }: { onOpenProfile: (id: string) => void }) {
  const [sec, setSec] = useState<Sec>("dash");
  return (
    <>
      <div className="chips" role="tablist">
        {([["dash", "ড্যাশবোর্ড"], ["search", "খুঁজুন"], ["time", "টাইমলাইন"], ["map", "মানচিত্র"]] as [Sec, string][]).map(([k, l]) => (
          <button key={k} type="button" role="tab" aria-selected={sec === k} className={sec === k ? "on" : ""} onClick={() => setSec(k)}>{l}</button>
        ))}
      </div>
      {sec === "dash" && <Dash />}
      {sec === "search" && <Search onOpenProfile={onOpenProfile} />}
      {sec === "time" && <Time onOpenProfile={onOpenProfile} />}
      {sec === "map" && <MapView />}
    </>
  );
}

function Stat({ n, label }: { n: number | string; label: string }) {
  return <div className="card"><p style={{ fontSize: "1.6rem", color: "var(--gold)", margin: 0 }}>{typeof n === "number" ? toBn(n) : n}</p><p className="muted small" style={{ margin: 0 }}>{label}</p></div>;
}

function Dash() {
  const { db, data } = useDb();
  const d = useMemo(() => dashboard(db), [db, data]);
  const gaps: [number, string][] = [[d.noBirth, "জন্মসাল অজানা"], [d.deceasedNoDeath, "মৃত কিন্তু মৃত্যুসাল অজানা"], [d.noSource, "কোনো উৎস নেই"], [d.duplicates, "জোড়া একই নামের (ডুপ্লিকেট হতে পারে)"], [d.unknownAncestors, "অজানা পূর্বপুরুষের ঘর"]];
  return (
    <>
      <div className="grid2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--sp-2)" }}>
        <Stat n={d.people} label="মোট সদস্য" /><Stat n={d.living} label="জীবিত" /><Stat n={d.deceased} label="প্রয়াত" /><Stat n={d.oldestYear ? toBn(d.oldestYear) : "—"} label="সবচেয়ে পুরোনো জন্মসাল" />
        <Stat n={d.events} label="ঘটনা" /><Stat n={d.places} label="স্থান" /><Stat n={d.sources} label="উৎস" /><Stat n={d.members} label="সক্রিয় সদস্য (অ্যাপের)" />
      </div>
      <h2 className="sec">তথ্যের মান</h2>
      <p className="muted small">যাচাইকৃত (Verified): {pct(d.byStatus.verified, d.people)} · অযাচাইকৃত: {pct(d.byStatus.unverified, d.people)} · আনুমানিক: {pct(d.byStatus.estimated, d.people)} · অজানা: {pct(d.byStatus.unknown, d.people)}</p>
      <div className="list">
        {gaps.filter(([n]) => n > 0).map(([n, l]) => <div key={l} className="snap"><span>{l}</span><b>{toBn(n)}</b></div>)}
        {gaps.every(([n]) => n === 0) && <p className="muted">কোনো ঘাটতি পাওয়া যায়নি।</p>}
      </div>
      {d.pendingApprovals > 0 && <p className="notice">{toBn(d.pendingApprovals)}টি অনুমোদন অপেক্ষায় আছে।</p>}
      <h2 className="sec">ব্যাকআপ</h2>
      <p className={d.lastBackup ? "muted" : "error"}>{d.lastBackup ? `শেষ ফাইল-ব্যাকআপ: ${when(d.lastBackup)}` : "এখনো কোনো ফাইল-ব্যাকআপ নেওয়া হয়নি।"}</p>
      <h2 className="sec">সাম্প্রতিক পরিবর্তন</h2>
      <div className="list">{d.recent.map((r, i) => <div key={i} className="snap"><span>{r.table} · {r.action}</span><span className="muted small">{when(r.at)}</span></div>)}</div>
    </>
  );
}

function Search({ onOpenProfile }: { onOpenProfile: (id: string) => void }) {
  const { db } = useDb();
  const [q, setQ] = useState("");
  const hits = useMemo(() => searchAll(db, q), [db, q]);
  const KIND: Record<string, string> = { person: "সদস্য", note: "লেখা", place: "স্থান", event: "ঘটনা" };
  return (
    <>
      <div className="field"><input type="search" placeholder="নাম, পেশা, স্থান, স্মৃতি… (বাংলা বা ইংরেজি)" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      {q.trim() && hits.length === 0 && <p className="muted">রেকর্ডে নেই।</p>}
      <div className="list">
        {hits.map((h, i) => (
          <button key={i} className="snap" style={{ textAlign: "left", width: "100%" }} disabled={!h.personId} onClick={() => h.personId && onOpenProfile(h.personId)}>
            <div><b>{h.title}</b><br /><span className="muted small">{KIND[h.kind]} · {h.detail}</span></div>
          </button>
        ))}
      </div>
    </>
  );
}

function Time({ onOpenProfile }: { onOpenProfile: (id: string) => void }) {
  const { db, data, reload } = useDb();
  const [type, setType] = useState(""), [person, setPerson] = useState("");
  const [adding, setAdding] = useState(false), [msg, setMsg] = useState<string | null>(null);
  const [f, setF] = useState({ type: "residence", personId: "", title: "", description: "", place: "", q: "exact", y: "", m: "", d: "" });
  const rows = useMemo(() => timeline(db, { personId: person || undefined, type: type || undefined }), [db, data, type, person, adding]);
  const save = () => {
    try {
      addEvent(db, { type: f.type, personId: f.personId || null, title: f.title, description: f.description, place: f.place, date: { q: f.q as never, y: f.y ? Number(f.y) : null, m: f.m ? Number(f.m) : null, d: f.d ? Number(f.d) : null } });
      setAdding(false); setMsg(null); reload();
    } catch (e) { setMsg(explainError(e)); }
  };
  return (
    <>
      <div className="row">
        <select aria-label="সদস্য" value={person} onChange={(e) => setPerson(e.target.value)}><option value="">সব সদস্য</option>{data.people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
        <select aria-label="ধরন" value={type} onChange={(e) => setType(e.target.value)}><option value="">সব ধরন</option>{Object.entries(EVENT_BN).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        <button className="btn btn-primary" onClick={() => setAdding(!adding)}>{adding ? "বন্ধ" : "ঘটনা যোগ"}</button>
      </div>
      {adding && (
        <div className="card">
          <div className="field"><select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>{Object.entries(EVENT_BN).filter(([k]) => k !== "birth" && k !== "death").map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
          <div className="field"><select value={f.personId} onChange={(e) => setF({ ...f, personId: e.target.value })}><option value="">{f.type === "family_history" ? "(কোনো সদস্য নয়)" : "সদস্য বেছে নিন"}</option>{data.people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
          <div className="field"><input placeholder="শিরোনাম" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></div>
          <div className="field"><textarea placeholder="বিবরণ" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></div>
          <div className="field"><input placeholder="স্থান" value={f.place} onChange={(e) => setF({ ...f, place: e.target.value })} /></div>
          <div className="row">
            <select aria-label="তারিখের ধরন" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })}><option value="exact">নির্দিষ্ট</option><option value="about">আনুমানিক</option><option value="before">এর আগে</option><option value="after">এর পরে</option><option value="unknown">অজানা</option></select>
            {f.q !== "unknown" && <><input inputMode="numeric" placeholder="সাল" value={f.y} onChange={(e) => setF({ ...f, y: e.target.value.replace(/\D/g, "") })} style={{ width: 90 }} /><input inputMode="numeric" placeholder="মাস" value={f.m} onChange={(e) => setF({ ...f, m: e.target.value.replace(/\D/g, "") })} style={{ width: 70 }} /><input inputMode="numeric" placeholder="দিন" value={f.d} onChange={(e) => setF({ ...f, d: e.target.value.replace(/\D/g, "") })} style={{ width: 70 }} /></>}
          </div>
          {msg && <p className="error">{msg}</p>}
          <button className="btn btn-primary" onClick={save}>সংরক্ষণ</button>
        </div>
      )}
      {rows.length === 0 && <p className="muted">কোনো ঘটনা নেই।</p>}
      <div className="list">
        {rows.map((r) => (
          <div key={r.id} className="snap">
            <div><b>{formatDate(r.date)}</b> · {EVENT_BN[r.type] ?? r.type}<br />
              {r.personName && r.personId ? <button className="link" onClick={() => onOpenProfile(r.personId!)}>{r.personName}</button> : null}{r.title !== (EVENT_BN[r.type] ?? r.type) ? ` ${r.title}` : ""}{r.place ? ` · ${r.place}` : ""}
              {r.description && <><br /><span className="muted small">{r.description}</span></>}</div>
          </div>
        ))}
      </div>
    </>
  );
}

function MapView() {
  const { db, data, reload } = useDb();
  const ps = useMemo(() => places(db), [db, data]);
  const mapped = ps.filter((p) => p.lat !== null && p.lng !== null) as (typeof ps[number] & { lat: number; lng: number })[];
  const pts = project(mapped, 320, 240);
  const [edit, setEdit] = useState<string | null>(null), [lat, setLat] = useState(""), [lng, setLng] = useState(""), [msg, setMsg] = useState<string | null>(null);
  const save = (id: string) => {
    try { setPlaceCoords(db, id, lat.trim() ? Number(lat) : null, lng.trim() ? Number(lng) : null); setEdit(null); setMsg(null); reload(); } catch (e) { setMsg(explainError(e)); }
  };
  return (
    <>
      <p className="muted small">অফলাইন মানচিত্র: স্থানাঙ্ক অনুযায়ী বিন্দু (পটভূমির ম্যাপ নেই, কারণ তা ইন্টারনেট ছাড়া চলে না)। উত্তর ওপরে।</p>
      {mapped.length > 0 && (
        <svg viewBox="0 0 320 240" width="100%" role="img" aria-label="স্থানের মানচিত্র" style={{ background: "#000", border: "1px solid var(--line)", borderRadius: 8 }}>
          {mapped.map((p, i) => (
            <g key={p.id}><circle cx={pts[i].x} cy={pts[i].y} r={4 + Math.min(8, p.people)} fill="var(--gold)" opacity={0.85} />
              <text x={pts[i].x + 8} y={pts[i].y + 4} fill="var(--ivory)" fontSize="11">{p.name}</text></g>
          ))}
        </svg>
      )}
      {msg && <p className="error">{msg}</p>}
      <div className="list">
        {ps.length === 0 && <p className="muted">এখনো কোনো স্থান নেই। সদস্যের জন্ম/মৃত্যুস্থান বা ঘটনার স্থান লিখলে এখানে আসবে।</p>}
        {ps.map((p) => (
          <div key={p.id} className="snap">
            <div><b>{p.name}</b><br /><span className="muted small">{toBn(p.people)} জন · {toBn(p.events)}টি ঘটনা · {p.lat !== null ? `${p.lat}, ${p.lng}` : "স্থানাঙ্ক নেই"}</span></div>
            {edit === p.id ? (
              <div className="row"><input inputMode="decimal" placeholder="অক্ষাংশ" value={lat} onChange={(e) => setLat(e.target.value)} style={{ width: 100 }} /><input inputMode="decimal" placeholder="দ্রাঘিমাংশ" value={lng} onChange={(e) => setLng(e.target.value)} style={{ width: 100 }} /><button className="btn btn-primary" onClick={() => save(p.id)}>ঠিক</button></div>
            ) : <button className="btn" onClick={() => { setEdit(p.id); setLat(p.lat?.toString() ?? ""); setLng(p.lng?.toString() ?? ""); setMsg(null); }}>স্থানাঙ্ক</button>}
          </div>
        ))}
      </div>
    </>
  );
}
