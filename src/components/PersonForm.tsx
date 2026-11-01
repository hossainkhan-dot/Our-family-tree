import { useMemo, useState } from "react";
import type { ParentKind, Sex } from "../core/relations";
import { useDb } from "../db/DbContext";
import { explainError, getProfile, savePerson, type Living, type PersonIn, type Qualifier, type Status } from "../db/repo";

const num = (s: string): number | null => {
  const t = s.replace(/[০-৯]/g, (d) => String("০১২৩৪৫৬৭৮৯".indexOf(d))).trim();
  const n = parseInt(t, 10);
  return Number.isFinite(n) ? n : null;
};

interface F {
  nameBn: string; nameEn: string; nickname: string; title: string; sex: Sex; living: Living; isMe: boolean;
  bq: Qualifier; by: string; bm: string; bd: string; birthPlace: string;
  dq: Qualifier; dy: string; dm: string; dd: string; deathPlace: string;
  fatherId: string; motherId: string; parentKind: ParentKind; spouseIds: string[];
  education: string; institution: string; occupation: string; workplace: string; achievements: string;
  biography: string; personality: string; memories: string;
  status: Status; sourceKind: string; sourceTitle: string; informant: string;
}
const s = (v: number | null | undefined) => (v ? String(v) : "");

function Chips<T extends string>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="chips" role="radiogroup">
      {options.map(([v, label]) => (
        <button type="button" key={v} role="radio" aria-checked={value === v} className={value === v ? "on" : ""} onClick={() => onChange(v)}>{label}</button>
      ))}
    </div>
  );
}
function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return <label className="field"><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>;
}
function DateFields({ q, y, m, d, set }: { q: Qualifier; y: string; m: string; d: string; set: (p: { q?: Qualifier; y?: string; m?: string; d?: string }) => void }) {
  return (
    <div className="field">
      <Chips value={q} options={[["unknown", "অজানা"], ["exact", "নির্দিষ্ট"], ["about", "আনুমানিক"]]} onChange={(v) => set({ q: v })} />
      {q !== "unknown" && (
        <div className="date3">
          <input inputMode="numeric" placeholder="দিন" value={d} onChange={(e) => set({ d: e.target.value })} />
          <input inputMode="numeric" placeholder="মাস (১-১২)" value={m} onChange={(e) => set({ m: e.target.value })} />
          <input inputMode="numeric" placeholder="সাল *" value={y} onChange={(e) => set({ y: e.target.value })} />
        </div>
      )}
    </div>
  );
}

export default function PersonForm({ id, onDone, onCancel }: { id?: string; onDone: (id: string) => void; onCancel: () => void }) {
  const { db, data, ego, reload } = useDb();
  const [err, setErr] = useState<string | null>(null);
  const init = useMemo<F>(() => {
    const p = id ? getProfile(db, id) : null;
    return {
      nameBn: p?.nameBn ?? "", nameEn: p?.nameEn ?? "", nickname: p?.nickname ?? "", title: p?.title ?? "",
      sex: p?.sex ?? "unknown", living: p?.living ?? "living", isMe: p ? p.isMe : !ego,
      bq: p?.birth?.q ?? "unknown", by: s(p?.birth?.y), bm: s(p?.birth?.m), bd: s(p?.birth?.d), birthPlace: p?.birthPlace ?? "",
      dq: p?.death?.q ?? "unknown", dy: s(p?.death?.y), dm: s(p?.death?.m), dd: s(p?.death?.d), deathPlace: p?.deathPlace ?? "",
      fatherId: p?.fatherId ?? "", motherId: p?.motherId ?? "", parentKind: p?.parentKind ?? "biological", spouseIds: p?.spouseIds ?? [],
      education: p?.education ?? "", institution: p?.institution ?? "", occupation: p?.occupation ?? "", workplace: p?.workplace ?? "", achievements: p?.achievements ?? "",
      biography: p?.biography ?? "", personality: p?.personality ?? "", memories: p?.memories ?? "",
      status: p?.status ?? "unverified", sourceKind: "elder_testimony", sourceTitle: "", informant: "",
    };
  }, [db, id, ego]);
  const [f, setF] = useState<F>(init);
  const up = (p: Partial<F>) => setF((x) => ({ ...x, ...p }));
  const others = data.people.filter((p) => p.id !== id).sort((a, b) => a.name.localeCompare(b.name, "bn"));

  const submit = () => {
    const inp: PersonIn = {
      id, nameBn: f.nameBn, nameEn: f.nameEn, nickname: f.nickname, title: f.title, sex: f.sex, living: f.living, status: f.status, isMe: f.isMe,
      birth: { q: f.bq, y: num(f.by), m: num(f.bm), d: num(f.bd) }, birthPlace: f.birthPlace,
      death: { q: f.dq, y: num(f.dy), m: num(f.dm), d: num(f.dd) }, deathPlace: f.deathPlace,
      fatherId: f.fatherId || null, motherId: f.motherId || null, parentKind: f.parentKind, spouseIds: f.spouseIds,
      education: f.education, institution: f.institution, occupation: f.occupation, workplace: f.workplace, achievements: f.achievements,
      biography: f.biography, personality: f.personality, memories: f.memories,
      sourceKind: f.sourceKind, sourceTitle: f.sourceTitle, informant: f.informant,
    };
    try { const nid = savePerson(db, inp); reload(); onDone(nid); }
    catch (e) { setErr(explainError(e)); window.scrollTo({ top: 0, behavior: "smooth" }); }
  };
  const select = (v: string, on: (v: string) => void, label: string) => (
    <select value={v} onChange={(e) => on(e.target.value)}>
      <option value="">{label}</option>
      {others.map((p) => <option key={p.id} value={p.id}>{p.name}{p.birthYear ? ` (${p.birthYear})` : ""}</option>)}
    </select>
  );

  return (
    <section className="form">
      <h1>{id ? "তথ্য সম্পাদনা" : "নতুন সদস্য"}</h1>
      {err && <p className="error" role="alert">{err}</p>}

      <details open><summary>মৌলিক পরিচয়</summary>
        <Field label="নাম (বাংলা)"><input value={f.nameBn} onChange={(e) => up({ nameBn: e.target.value })} /></Field>
        <Field label="নাম (ইংরেজি)"><input value={f.nameEn} onChange={(e) => up({ nameEn: e.target.value })} /></Field>
        <Field label="ডাকনাম"><input value={f.nickname} onChange={(e) => up({ nickname: e.target.value })} /></Field>
        <Field label="উপাধি"><input value={f.title} onChange={(e) => up({ title: e.target.value })} /></Field>
        <div className="field"><span>লিঙ্গ</span><Chips value={f.sex} options={[["male", "পুরুষ"], ["female", "নারী"], ["other", "অন্যান্য"], ["unknown", "অজানা"]]} onChange={(v) => up({ sex: v })} /></div>
        <div className="field"><span>অবস্থা</span><Chips value={f.living} options={[["living", "জীবিত"], ["deceased", "মৃত"], ["unknown", "অজানা"]]} onChange={(v) => up({ living: v })} /></div>
        <label className="check"><input type="checkbox" checked={f.isMe} onChange={(e) => up({ isMe: e.target.checked })} /> এই ব্যক্তি আমি</label>
      </details>

      <details open><summary>জন্ম ও মৃত্যু</summary>
        <div className="field"><span>জন্মতারিখ</span></div>
        <DateFields q={f.bq} y={f.by} m={f.bm} d={f.bd} set={(p) => up({ ...(p.q && { bq: p.q }), ...(p.y !== undefined && { by: p.y }), ...(p.m !== undefined && { bm: p.m }), ...(p.d !== undefined && { bd: p.d }) })} />
        <Field label="জন্মস্থান (গ্রাম/এলাকা)"><input value={f.birthPlace} onChange={(e) => up({ birthPlace: e.target.value })} /></Field>
        {f.living !== "living" && <>
          <div className="field"><span>মৃত্যুর তারিখ</span></div>
          <DateFields q={f.dq} y={f.dy} m={f.dm} d={f.dd} set={(p) => up({ ...(p.q && { dq: p.q }), ...(p.y !== undefined && { dy: p.y }), ...(p.m !== undefined && { dm: p.m }), ...(p.d !== undefined && { dd: p.d }) })} />
          <Field label="মৃত্যুস্থান"><input value={f.deathPlace} onChange={(e) => up({ deathPlace: e.target.value })} /></Field>
        </>}
      </details>

      <details open><summary>পরিবার</summary>
        <Field label="বাবা" hint="তালিকায় না থাকলে আগে বাবাকে সদস্য হিসেবে যোগ করুন। না জানলে ফাঁকা রাখুন।">{select(f.fatherId, (v) => up({ fatherId: v }), "অজানা")}</Field>
        <Field label="মা">{select(f.motherId, (v) => up({ motherId: v }), "অজানা")}</Field>
        <div className="field"><span>বাবা-মায়ের সঙ্গে সম্পর্কের ধরন</span>
          <Chips value={f.parentKind} options={[["biological", "জৈবিক"], ["adoptive", "দত্তক"], ["step", "সৎ"], ["foster", "পালক"]]} onChange={(v) => up({ parentKind: v })} /></div>
        <div className="field"><span>স্বামী/স্ত্রী (একাধিক হতে পারে)</span>
          {others.length === 0 && <small>এখনো অন্য কোনো সদস্য নেই।</small>}
          {others.map((p) => (
            <label className="check" key={p.id}><input type="checkbox" checked={f.spouseIds.includes(p.id)}
              onChange={(e) => up({ spouseIds: e.target.checked ? [...f.spouseIds, p.id] : f.spouseIds.filter((x) => x !== p.id) })} /> {p.name}</label>
          ))}</div>
      </details>

      <details><summary>শিক্ষা ও পেশা</summary>
        <Field label="শিক্ষাগত যোগ্যতা"><input value={f.education} onChange={(e) => up({ education: e.target.value })} /></Field>
        <Field label="শিক্ষাপ্রতিষ্ঠান"><input value={f.institution} onChange={(e) => up({ institution: e.target.value })} /></Field>
        <Field label="পেশা"><input value={f.occupation} onChange={(e) => up({ occupation: e.target.value })} /></Field>
        <Field label="কর্মস্থল"><input value={f.workplace} onChange={(e) => up({ workplace: e.target.value })} /></Field>
        <Field label="উল্লেখযোগ্য অর্জন"><textarea rows={3} value={f.achievements} onChange={(e) => up({ achievements: e.target.value })} /></Field>
      </details>

      <details><summary>ব্যক্তিগত ইতিহাস</summary>
        <Field label="জীবনী"><textarea rows={5} value={f.biography} onChange={(e) => up({ biography: e.target.value })} /></Field>
        <Field label="ব্যক্তিত্ব ও স্বভাব"><textarea rows={3} value={f.personality} onChange={(e) => up({ personality: e.target.value })} /></Field>
        <Field label="স্মৃতিচারণ ও গল্প"><textarea rows={5} value={f.memories} onChange={(e) => up({ memories: e.target.value })} /></Field>
      </details>

      <details open><summary>যাচাই ও উৎস</summary>
        <div className="field"><span>তথ্যের অবস্থা</span>
          <Chips value={f.status} options={[["verified", "যাচাইকৃত"], ["unverified", "অযাচাইকৃত"], ["estimated", "আনুমানিক"], ["unknown", "অজানা"]]} onChange={(v) => up({ status: v })} /></div>
        <Field label="তথ্যের উৎস (ঐচ্ছিক)" hint="যেমন: দাদার মুখের বক্তব্য, জন্মসনদ, পুরোনো চিঠি">
          <input value={f.sourceTitle} onChange={(e) => up({ sourceTitle: e.target.value })} /></Field>
        {f.sourceTitle.trim() && <>
          <div className="field"><span>উৎসের ধরন</span>
            <select value={f.sourceKind} onChange={(e) => up({ sourceKind: e.target.value })}>
              <option value="elder_testimony">বয়োজ্যেষ্ঠের বক্তব্য</option><option value="certificate">সনদ</option><option value="document">দলিল/নথি</option>
              <option value="letter">চিঠি</option><option value="photo">ছবি</option><option value="book">বই</option><option value="other">অন্যান্য</option>
            </select></div>
          <Field label="কার কাছ থেকে পাওয়া"><input value={f.informant} onChange={(e) => up({ informant: e.target.value })} /></Field>
        </>}
      </details>

      <div className="row actions">
        <button className="btn btn-primary" onClick={submit}>সংরক্ষণ করুন</button>
        <button className="btn" onClick={onCancel}>বাতিল</button>
      </div>
    </section>
  );
}
