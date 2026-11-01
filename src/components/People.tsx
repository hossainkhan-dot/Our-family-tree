import { useMemo, useState } from "react";
import { buildGraph, focusSet, relation, toBn, type P } from "../core/relations";
import { useDb } from "../db/DbContext";
import { deletePerson, formatDate, getProfile, setEgo } from "../db/repo";
import PersonForm from "./PersonForm";

export type PeopleView = { mode: "list" } | { mode: "form"; id?: string } | { mode: "profile"; id: string };
const STATUS: Record<string, string> = { verified: "যাচাইকৃত", unverified: "অযাচাইকৃত", estimated: "আনুমানিক", unknown: "অজানা" };
const years = (p: P) => (p.birthYear == null && p.deathYear == null ? "সাল অজানা" : `${p.birthYear != null ? toBn(p.birthYear) : "?"} – ${p.deathYear != null ? toBn(p.deathYear) : p.living ? "বর্তমান" : "?"}`);

export default function People({ view, setView }: { view: PeopleView; setView: (v: PeopleView) => void }) {
  if (view.mode === "form") return <PersonForm id={view.id} onDone={(id) => setView({ mode: "profile", id })} onCancel={() => setView(view.id ? { mode: "profile", id: view.id } : { mode: "list" })} />;
  if (view.mode === "profile") return <Profile id={view.id} setView={setView} />;
  return <List setView={setView} />;
}

function List({ setView }: { setView: (v: PeopleView) => void }) {
  const { data, ego } = useDb();
  const g = useMemo(() => buildGraph(data), [data]);
  const [q, setQ] = useState("");
  const list = data.people.filter((p) => p.name.toLowerCase().includes(q.trim().toLowerCase())).sort((a, b) => a.name.localeCompare(b.name, "bn"));
  return (
    <section className="panel">
      <div className="tree-head"><h1>সদস্য</h1><span className="muted">{toBn(data.people.length)} জন</span></div>
      {data.people.length === 0 ? (
        <>
          <p className="muted">এখনো কোনো সদস্য নেই। প্রথমে নিজেকে যোগ করুন, তারপর বাবা-মা, দাদা-দাদি।</p>
          <button className="btn btn-primary" onClick={() => setView({ mode: "form" })}>প্রথম সদস্য যোগ করুন</button>
        </>
      ) : (
        <>
          <input className="search" placeholder="নাম দিয়ে খুঁজুন" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="list">
            {list.map((p) => (
              <button key={p.id} className="person-card" onClick={() => setView({ mode: "profile", id: p.id })}>
                <div className="avatar">{p.name.slice(0, 1)}</div>
                <div><p className="name">{p.name}</p>
                  <span className="years">{years(p)}{ego && p.id !== ego ? ` · ${relation(g, ego, p.id) ?? "সম্পর্ক অজানা"}` : ego === p.id ? " · আপনি" : ""}</span></div>
              </button>
            ))}
            {list.length === 0 && <p className="muted">কাউকে পাওয়া যায়নি।</p>}
          </div>
          <button className="fab" aria-label="নতুন সদস্য" onClick={() => setView({ mode: "form" })}>＋</button>
        </>
      )}
    </section>
  );
}

function Profile({ id, setView }: { id: string; setView: (v: PeopleView) => void }) {
  const { db, data, ego, reload } = useDb();
  const g = useMemo(() => buildGraph(data), [data]);
  const p = useMemo(() => getProfile(db, id), [db, id, data]);
  const [confirm, setConfirm] = useState(false);
  if (!p) return <section className="panel"><p className="muted">এই সদস্যকে পাওয়া যায়নি।</p><button className="btn" onClick={() => setView({ mode: "list" })}>তালিকায় ফিরুন</button></section>;
  const name = (x: string) => g.byId.get(x)?.name ?? "অজানা";
  const link = (x: string) => <button key={x} className="link" onClick={() => setView({ mode: "profile", id: x })}>{name(x)}</button>;
  const rel = ego ? relation(g, ego, id) : null;
  const f = focusSet(g, id);
  const rows = (items: [string, React.ReactNode][]) => {
    const shown = items.filter(([, v]) => v !== "" && v != null && v !== false);
    return shown.length ? <dl>{shown.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl> : <p className="muted">কোনো তথ্য যোগ করা হয়নি।</p>;
  };
  const unknown = (d?: { q: string }) => !d || d.q === "unknown";
  return (
    <section className="panel profile">
      <button className="link back" onClick={() => setView({ mode: "list" })}>← সব সদস্য</button>
      <header className="p-head">
        <div className="avatar big">{(p.nameBn || p.nameEn || "?").slice(0, 1)}</div>
        <div>
          <h1>{p.nameBn || p.nameEn}</h1>
          {p.nameBn && p.nameEn && <p className="muted">{p.nameEn}</p>}
          <p><span className={`status ${p.status}`}>{STATUS[p.status]}</span> <span className="muted">{id === ego ? "আপনি" : rel ?? ""}</span></p>
        </div>
      </header>
      <h2>পরিচয়</h2>
      {rows([["ডাকনাম", p.nickname ?? ""], ["উপাধি", p.title ?? ""], ["লিঙ্গ", { male: "পুরুষ", female: "নারী", other: "অন্যান্য", unknown: "" }[p.sex]],
        ["অবস্থা", { living: "জীবিত", deceased: "মৃত", unknown: "" }[p.living]],
        ["জন্ম", unknown(p.birth) && !p.birthPlace ? "" : `${unknown(p.birth) ? "" : formatDate(p.birth)}${p.birthPlace ? ` · ${p.birthPlace}` : ""}`],
        ["মৃত্যু", p.living === "living" || (unknown(p.death) && !p.deathPlace) ? "" : `${unknown(p.death) ? "" : formatDate(p.death)}${p.deathPlace ? ` · ${p.deathPlace}` : ""}`]])}
      <h2>পরিবার</h2>
      {rows([["বাবা", p.fatherId ? link(p.fatherId) : ""], ["মা", p.motherId ? link(p.motherId) : ""],
        ["স্বামী/স্ত্রী", f.spouses.length ? <>{f.spouses.map(link)}</> : ""],
        ["ভাইবোন", f.siblings.length ? <>{f.siblings.map(link)}</> : ""], ["সন্তান", f.children.length ? <>{f.children.map(link)}</> : ""]])}
      <h2>শিক্ষা ও পেশা</h2>
      {rows([["শিক্ষা", p.education ?? ""], ["প্রতিষ্ঠান", p.institution ?? ""], ["পেশা", p.occupation ?? ""], ["কর্মস্থল", p.workplace ?? ""], ["অর্জন", p.achievements ?? ""]])}
      <h2>ব্যক্তিগত ইতিহাস</h2>
      {rows([["জীবনী", p.biography ?? ""], ["স্বভাব", p.personality ?? ""], ["স্মৃতি", p.memories ?? ""]])}
      <h2>উৎস</h2>
      {p.sources.length ? <ul className="sources">{p.sources.map((s, i) => <li key={i}>{s.title}{s.informant ? ` · ${s.informant}` : ""}</li>)}</ul> : <p className="muted">কোনো উৎস যোগ করা হয়নি।</p>}
      <div className="row actions">
        <button className="btn btn-primary" onClick={() => setView({ mode: "form", id })}>সম্পাদনা</button>
        {id !== ego && <button className="btn" onClick={() => { setEgo(db, id); reload(); }}>এটি আমি</button>}
        {!confirm ? <button className="btn danger" onClick={() => setConfirm(true)}>মুছুন</button>
          : <button className="btn danger" onClick={() => { deletePerson(db, id); reload(); setView({ mode: "list" }); }}>নিশ্চিত, মুছুন</button>}
      </div>
      {confirm && <p className="muted">মুছলে সদস্য তালিকা ও ট্রি থেকে সরে যাবে, তবে History-তে সংরক্ষিত থাকবে।</p>}
    </section>
  );
}
