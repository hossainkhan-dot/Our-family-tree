import { buildGraph, toBn, wouldCreateCycle, type Data, type P, type ParentKind, type Sex } from "../core/relations";
import { tx, type Sql } from "./sql";

export type Status = "verified" | "unverified" | "estimated" | "unknown";
export type Qualifier = "unknown" | "exact" | "about" | "before" | "after" | "between";
export interface DateIn { q: Qualifier; y?: number | null; m?: number | null; d?: number | null }
export type Living = "living" | "deceased" | "unknown";

export type RelKind = "father" | "mother" | "spouse" | "son" | "daughter" | "brother" | "sister" | "gf_p" | "gm_p" | "gf_m" | "gm_m";
export interface RelIn { kind: RelKind; otherId: string }
/** [kind, Bangla label, sex the other person should have (if any)] */
export const REL_OPTIONS: [RelKind, string, Sex | null][] = [
  ["father", "বাবা", "male"], ["mother", "মা", "female"], ["spouse", "স্বামী/স্ত্রী", null],
  ["son", "ছেলে", "male"], ["daughter", "মেয়ে", "female"], ["brother", "ভাই", "male"], ["sister", "বোন", "female"],
  ["gf_p", "দাদা (বাবার বাবা)", "male"], ["gm_p", "দাদি (বাবার মা)", "female"],
  ["gf_m", "নানা (মায়ের বাবা)", "male"], ["gm_m", "নানী (মায়ের মা)", "female"],
];

export interface PersonIn {
  id?: string;
  nameBn?: string; nameEn?: string; nickname?: string; title?: string;
  sex: Sex; living: Living; status: Status; isMe?: boolean;
  birth?: DateIn; birthPlace?: string; death?: DateIn; deathPlace?: string;
  fatherId?: string | null; motherId?: string | null; parentKind?: ParentKind; spouseIds?: string[];
  /** Extra relations (son, daughter, brother, sister, grandparents) that are linked directly on save. Never creates a duplicate link. */
  relations?: RelIn[];
  education?: string; institution?: string; occupation?: string; workplace?: string; achievements?: string;
  biography?: string; personality?: string; memories?: string;
  sourceKind?: string; sourceTitle?: string; informant?: string;
}

const ACTOR = "owner";
export const uid = (): string =>
  globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}-${Math.random().toString(16).slice(2)}`;
const now = () => new Date().toISOString();

/** Insert, update or soft-delete a single child row identified by `where`. */
function setRow(db: Sql, table: string, where: Record<string, string>, cols: Record<string, unknown>, keep: boolean) {
  const wk = Object.keys(where);
  const cond = wk.map((k) => `${k} = ?`).join(" AND ") + " AND deleted_at IS NULL";
  const ex = db.all<{ id: string }>(`SELECT id FROM ${table} WHERE ${cond}`, wk.map((k) => where[k]))[0];
  if (!keep) {
    if (ex) db.run(`UPDATE ${table} SET deleted_at = ?, updated_at = ? WHERE id = ?`, [now(), now(), ex.id]);
    return;
  }
  if (ex) {
    const ck = Object.keys(cols);
    db.run(`UPDATE ${table} SET ${ck.map((k) => `${k} = ?`).join(", ")}, updated_at = ? WHERE id = ?`, [...ck.map((k) => cols[k]), now(), ex.id]);
  } else {
    const all = { ...where, ...cols };
    const ks = Object.keys(all);
    db.run(`INSERT INTO ${table} (id, ${ks.join(", ")}, created_by) VALUES (?, ${ks.map(() => "?").join(", ")}, ?)`, [uid(), ...ks.map((k) => all[k]), ACTOR]);
  }
}

function placeId(db: Sql, name: string): string {
  const ex = db.all<{ id: string }>("SELECT id FROM place WHERE name_bn = ? AND deleted_at IS NULL", [name])[0];
  if (ex) return ex.id;
  const id = uid();
  db.run("INSERT INTO place (id, name_bn, type, created_by) VALUES (?, ?, 'village', ?)", [id, name, ACTOR]);
  return id;
}

export function validate(inp: PersonIn): string | null {
  if (!(inp.nameBn ?? "").trim() && !(inp.nameEn ?? "").trim()) return "অন্তত একটি নাম (বাংলা বা ইংরেজি) দিন।";
  for (const [label, d] of [["জন্মের", inp.birth], ["মৃত্যুর", inp.death]] as const) {
    if (!d || d.q === "unknown") continue;
    if (!d.y) return `${label} তারিখে বছর দিতে হবে। জানা না থাকলে "অজানা" বেছে নিন।`;
    if (d.d && !d.m) return `${label} তারিখে দিন দিলে মাসও দিন।`;
    if (d.m && (d.m < 1 || d.m > 12)) return `${label} মাস ১ থেকে ১২ এর মধ্যে হতে হবে।`;
    if (d.d && (d.d < 1 || d.d > 31)) return `${label} দিন ১ থেকে ৩১ এর মধ্যে হতে হবে।`;
  }
  if (inp.birth?.y && inp.death?.y && inp.birth.q !== "unknown" && inp.death.q !== "unknown" && inp.death.y < inp.birth.y)
    return "মৃত্যুর সাল জন্মের সালের আগে হতে পারে না।";
  if (inp.id && (inp.fatherId === inp.id || inp.motherId === inp.id || inp.spouseIds?.includes(inp.id)))
    return "কেউ নিজের বাবা, মা বা স্বামী/স্ত্রী হতে পারে না।";
  if (inp.id && inp.relations?.some((r) => r.otherId === inp.id)) return "কেউ নিজের আত্মীয় হতে পারে না।";
  return null;
}

export function savePerson(db: Sql, inp: PersonIn): string {
  const bad = validate(inp);
  if (bad) throw new Error(bad);
  return tx(db, () => {
    const id = inp.id ?? uid();
    if (db.all("SELECT id FROM person WHERE id = ?", [id]).length)
      db.run("UPDATE person SET sex = ?, living_status = ?, status = ?, updated_at = ? WHERE id = ?", [inp.sex, inp.living, inp.status, now(), id]);
    else db.run("INSERT INTO person (id, sex, living_status, status, created_by) VALUES (?, ?, ?, ?, ?)", [id, inp.sex, inp.living, inp.status, ACTOR]);

    const name = (kind: string, lang: string, v: string | undefined, primary: number) => {
      const t = (v ?? "").trim();
      setRow(db, "person_name", { person_id: id, kind }, { language: lang, full_name: t, is_primary: primary, status: inp.status }, t.length > 0);
    };
    name("bangla", "bn", inp.nameBn, 1); name("english", "en", inp.nameEn, 1);
    name("nickname", "bn", inp.nickname, 0); name("title", "bn", inp.title, 0);

    const event = (type: string, d: DateIn | undefined, place: string | undefined) => {
      const q = d?.q ?? "unknown", pl = (place ?? "").trim();
      const known = q !== "unknown";
      setRow(db, "event", { person_id: id, type }, {
        d_qualifier: q, d_y: known ? d!.y ?? null : null, d_m: known ? d!.m ?? null : null, d_d: known ? d!.d ?? null : null,
        place_id: pl ? placeId(db, pl) : null, status: inp.status,
      }, known || pl.length > 0);
    };
    event("birth", inp.birth, inp.birthPlace);
    event("death", inp.living === "living" ? undefined : inp.death, inp.living === "living" ? undefined : inp.deathPlace);

    const parent = (role: "father" | "mother", pid: string | null | undefined) => {
      const want = pid || null;
      const cur = db.all<{ id: string; parent_id: string }>("SELECT id, parent_id FROM parent_child WHERE child_id = ? AND parent_role = ? AND deleted_at IS NULL", [id, role]);
      for (const c of cur) if (c.parent_id !== want) db.run("UPDATE parent_child SET deleted_at = ?, updated_at = ? WHERE id = ?", [now(), now(), c.id]);
      if (!want) return;
      if (cur.some((c) => c.parent_id === want)) {
        if (inp.parentKind) db.run("UPDATE parent_child SET kind = ?, updated_at = ? WHERE child_id = ? AND parent_id = ? AND deleted_at IS NULL", [inp.parentKind, now(), id, want]);
        return;
      }
      if (wouldCreateCycle(buildGraph(loadData(db)), want, id)) throw new Error("CYCLE");
      db.run("INSERT INTO parent_child (id, parent_id, child_id, kind, parent_role, status, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [uid(), want, id, inp.parentKind ?? "biological", role, inp.status, ACTOR]);
    };
    if (inp.fatherId !== undefined) parent("father", inp.fatherId);
    if (inp.motherId !== undefined) parent("mother", inp.motherId);

    if (inp.spouseIds) {
      const want = new Set(inp.spouseIds.filter((s) => s !== id));
      const have = db.all<{ id: string; a: string | null; b: string | null }>(
        "SELECT id, partner1_id AS a, partner2_id AS b FROM family_union WHERE (partner1_id = ? OR partner2_id = ?) AND deleted_at IS NULL", [id, id]);
      for (const u of have) {
        const other = u.a === id ? u.b : u.a;
        if (!other) continue;
        if (want.has(other)) want.delete(other);
        else db.run("UPDATE family_union SET deleted_at = ?, updated_at = ? WHERE id = ?", [now(), now(), u.id]);
      }
      for (const s of want)
        db.run("INSERT INTO family_union (id, partner1_id, partner2_id, kind, status, created_by) VALUES (?, ?, ?, 'marriage', ?, ?)", [uid(), id, s, inp.status, ACTOR]);
    }

    const attr = (key: string, v: string | undefined) => {
      const t = (v ?? "").trim();
      setRow(db, "person_attribute", { person_id: id, key }, { value: t, status: inp.status }, t.length > 0);
    };
    attr("education", inp.education); attr("institution", inp.institution); attr("occupation", inp.occupation);
    attr("workplace", inp.workplace); attr("achievements", inp.achievements);
    const note = (kind: string, v: string | undefined) => {
      const t = (v ?? "").trim();
      setRow(db, "person_note", { person_id: id, kind }, { body: t, language: "bn", status: inp.status }, t.length > 0);
    };
    note("biography", inp.biography); note("personality", inp.personality); note("memory", inp.memories);

    const st = (inp.sourceTitle ?? "").trim();
    if (st) {
      const sid = uid();
      db.run("INSERT INTO source (id, kind, title, informant, created_by) VALUES (?, ?, ?, ?, ?)", [sid, inp.sourceKind || "other", st, (inp.informant ?? "").trim() || null, ACTOR]);
      db.run("INSERT INTO citation (id, source_id, target_table, target_id, created_by) VALUES (?, ?, 'person', ?, ?)", [uid(), sid, id, ACTOR]);
    }
    if (inp.relations?.length) applyRelations(db, id, inp);
    if (inp.isMe) setEgo(db, id);
    return id;
  });
}

const REL_ORDER: Partial<Record<RelKind, number>> = { son: 1, daughter: 1, gf_p: 2, gm_p: 2, gf_m: 2, gm_m: 2, brother: 3, sister: 3 };

/** Links the extra relations. Parents first, then grandparents, siblings last. Existing links are never duplicated; clashes throw a Bangla message. */
function applyRelations(db: Sql, id: string, inp: PersonIn) {
  const nm = (x: string) => db.all<{ n: string | null }>("SELECT full_name AS n FROM person_name WHERE person_id = ? AND deleted_at IS NULL ORDER BY is_primary DESC, kind LIMIT 1", [x])[0]?.n ?? "নামহীন";
  const parentOf = (child: string, role: "father" | "mother") =>
    db.all<{ parent_id: string }>("SELECT parent_id FROM parent_child WHERE child_id = ? AND parent_role = ? AND deleted_at IS NULL", [child, role])[0]?.parent_id ?? null;
  const linked = (p: string, c: string) => db.all("SELECT 1 AS x FROM parent_child WHERE parent_id = ? AND child_id = ? AND deleted_at IS NULL", [p, c]).length > 0;
  const link = (parent: string, child: string, role: "father" | "mother") => {
    if (parent === child) throw new Error("কেউ নিজের আত্মীয় হতে পারে না।");
    if (linked(parent, child)) return;
    const cur = parentOf(child, role);
    if (cur && cur !== parent) throw new Error(`${nm(child)}-এর ${role === "father" ? "বাবা" : "মা"} হিসেবে আগে থেকেই ${nm(cur)} আছেন, তাই ${nm(parent)}-কে যোগ করা গেল না।`);
    if (wouldCreateCycle(buildGraph(loadData(db)), parent, child)) throw new Error("CYCLE");
    db.run("INSERT INTO parent_child (id, parent_id, child_id, kind, parent_role, status, created_by) VALUES (?, ?, ?, 'biological', ?, ?, ?)", [uid(), parent, child, role, inp.status, ACTOR]);
  };
  const seen = new Set<string>();
  const rels = (inp.relations ?? []).filter((r) => r.otherId && r.otherId !== id && REL_ORDER[r.kind])
    .sort((a, b) => REL_ORDER[a.kind]! - REL_ORDER[b.kind]!);
  for (const r of rels) {
    const key = `${r.kind}:${r.otherId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const x = r.otherId;
    if (r.kind === "son" || r.kind === "daughter") {
      const role = inp.sex === "male" ? "father" : inp.sex === "female" ? "mother" : null;
      if (!role) throw new Error("ছেলে/মেয়ে যোগ করতে আগে এই ব্যক্তির লিঙ্গ (পুরুষ বা নারী) বেছে নিন।");
      link(id, x, role);
    } else if (r.kind === "brother" || r.kind === "sister") {
      for (const role of ["father", "mother"] as const) {
        const a = parentOf(id, role), b = parentOf(x, role);
        if (a && !b) link(a, x, role); else if (!a && b) link(b, id, role);
      }
      const shared = (["father", "mother"] as const).some((role) => { const a = parentOf(id, role); return !!a && a === parentOf(x, role); });
      if (!shared) throw new Error(`${nm(x)}-কে ভাই/বোন করতে হলে একই বাবা বা মা থাকতে হবে। আগে বাবা বা মা যোগ করুন।`);
    } else {
      const viaRole = r.kind.endsWith("_p") ? "father" : "mother";
      const mid = parentOf(id, viaRole);
      if (!mid) throw new Error(`${viaRole === "father" ? "দাদা/দাদি" : "নানা/নানী"} যোগ করতে আগে ${viaRole === "father" ? "বাবা" : "মা"} যোগ করুন।`);
      link(x, mid, r.kind.startsWith("gf") ? "father" : "mother");
    }
  }
}

export function deletePerson(db: Sql, id: string) {
  tx(db, () => {
    const t = now();
    const wasEgo = db.all<{ value: string }>("SELECT value FROM app_context WHERE key = 'ego'")[0]?.value === id;
    db.run("UPDATE parent_child SET deleted_at = ?, updated_at = ? WHERE (parent_id = ? OR child_id = ?) AND deleted_at IS NULL", [t, t, id, id]);
    db.run("UPDATE family_union SET deleted_at = ?, updated_at = ? WHERE (partner1_id = ? OR partner2_id = ?) AND deleted_at IS NULL", [t, t, id, id]);
    db.run("UPDATE person SET deleted_at = ?, updated_at = ? WHERE id = ?", [t, t, id]);
    if (wasEgo) db.run("DELETE FROM app_context WHERE key = 'ego'");
  });
}

export function setEgo(db: Sql, id: string) { db.run("INSERT OR REPLACE INTO app_context (key, value) VALUES ('ego', ?)", [id]); }
export function getEgo(db: Sql): string | null {
  const r = db.all<{ value: string }>("SELECT value FROM app_context WHERE key = 'ego'")[0];
  if (!r) return null;
  return db.all("SELECT id FROM person WHERE id = ? AND deleted_at IS NULL", [r.value]).length ? r.value : null;
}

export function loadData(db: Sql): Data {
  const nm = (cond: string) => `(SELECT full_name FROM person_name n WHERE n.person_id = p.id AND n.deleted_at IS NULL AND ${cond} LIMIT 1)`;
  const ev = (t: string) => `(SELECT d_y FROM event e WHERE e.person_id = p.id AND e.type = '${t}' AND e.deleted_at IS NULL LIMIT 1)`;
  const rows = db.all<{ id: string; sex: Sex; living_status: string; bn: string | null; en: string | null; nick: string | null; b_y: number | null; d_y: number | null }>(
    `SELECT p.id, p.sex, p.living_status, ${nm("n.language = 'bn' AND n.is_primary = 1")} AS bn, ${nm("n.language = 'en' AND n.is_primary = 1")} AS en,
     ${nm("n.kind = 'nickname'")} AS nick, ${ev("birth")} AS b_y, ${ev("death")} AS d_y
     FROM person p WHERE p.deleted_at IS NULL AND p.is_placeholder = 0`);
  const people: P[] = rows.map((r) => {
    const name = r.bn ?? r.en ?? "নামহীন";
    return { id: r.id, sex: r.sex, name, short: r.nick ?? name.split(" ")[0], birthYear: r.b_y, deathYear: r.d_y,
      living: r.living_status === "living" ? true : r.living_status === "deceased" ? false : null };
  });
  const ids = new Set(people.map((p) => p.id));
  const edges = db.all<{ parent_id: string; child_id: string; kind: ParentKind; parent_role: "father" | "mother" | "parent" }>(
    "SELECT parent_id, child_id, kind, parent_role FROM parent_child WHERE deleted_at IS NULL ORDER BY CASE kind WHEN 'biological' THEN 0 ELSE 1 END")
    .filter((e) => ids.has(e.parent_id) && ids.has(e.child_id))
    .filter((e, i, all) => all.findIndex((x) => x.parent_id === e.parent_id && x.child_id === e.child_id) === i)   // one line per parent-child pair
    .map((e) => ({ parent: e.parent_id, child: e.child_id, kind: e.kind, role: e.parent_role }));
  const unions = db.all<{ a: string; b: string }>(
    "SELECT partner1_id AS a, partner2_id AS b FROM family_union WHERE deleted_at IS NULL AND partner1_id IS NOT NULL AND partner2_id IS NOT NULL")
    .filter((u) => ids.has(u.a) && ids.has(u.b))
    .filter((u, i, all) => all.findIndex((x) => (x.a === u.a && x.b === u.b) || (x.a === u.b && x.b === u.a)) === i);   // one line per couple
  return { people, edges, unions };
}

export interface Profile extends PersonIn {
  id: string; isMe: boolean; spouseIds: string[]; sources: { title: string; kind: string; informant: string | null }[];
}
export function getProfile(db: Sql, id: string): Profile | null {
  const p = db.all<{ sex: Sex; living_status: Living; status: Status }>("SELECT sex, living_status, status FROM person WHERE id = ? AND deleted_at IS NULL", [id])[0];
  if (!p) return null;
  const val = (table: string, col: string, keyCol: string, key: string) =>
    db.all<Record<string, string>>(`SELECT ${col} AS v FROM ${table} WHERE person_id = ? AND ${keyCol} = ? AND deleted_at IS NULL`, [id, key])[0]?.v ?? "";
  const ev = (type: string): { d: DateIn; place: string } => {
    const r = db.all<{ q: Qualifier; y: number | null; m: number | null; d: number | null; pl: string | null }>(
      `SELECT e.d_qualifier AS q, e.d_y AS y, e.d_m AS m, e.d_d AS d, (SELECT name_bn FROM place WHERE id = e.place_id) AS pl
       FROM event e WHERE e.person_id = ? AND e.type = ? AND e.deleted_at IS NULL LIMIT 1`, [id, type])[0];
    return r ? { d: { q: r.q, y: r.y, m: r.m, d: r.d }, place: r.pl ?? "" } : { d: { q: "unknown" }, place: "" };
  };
  const par = (role: string) => db.all<{ parent_id: string; kind: ParentKind }>(
    "SELECT parent_id, kind FROM parent_child WHERE child_id = ? AND parent_role = ? AND deleted_at IS NULL", [id, role])[0];
  const f = par("father"), m = par("mother"), b = ev("birth"), d = ev("death");
  const spouses = db.all<{ a: string | null; b: string | null }>(
    "SELECT partner1_id AS a, partner2_id AS b FROM family_union WHERE (partner1_id = ? OR partner2_id = ?) AND deleted_at IS NULL", [id, id])
    .map((u) => (u.a === id ? u.b : u.a)).filter((x): x is string => !!x);
  const sources = db.all<{ title: string; kind: string; informant: string | null }>(
    "SELECT s.title, s.kind, s.informant FROM citation c JOIN source s ON s.id = c.source_id WHERE c.target_table = 'person' AND c.target_id = ? AND c.deleted_at IS NULL AND s.deleted_at IS NULL", [id]);
  const at = (k: string) => val("person_attribute", "value", "key", k), nt = (k: string) => val("person_note", "body", "kind", k);
  return {
    id, sex: p.sex, living: p.living_status, status: p.status, isMe: getEgo(db) === id,
    nameBn: val("person_name", "full_name", "kind", "bangla"), nameEn: val("person_name", "full_name", "kind", "english"),
    nickname: val("person_name", "full_name", "kind", "nickname"), title: val("person_name", "full_name", "kind", "title"),
    birth: b.d, birthPlace: b.place, death: d.d, deathPlace: d.place,
    fatherId: f?.parent_id ?? null, motherId: m?.parent_id ?? null, parentKind: f?.kind ?? m?.kind ?? "biological", spouseIds: spouses,
    education: at("education"), institution: at("institution"), occupation: at("occupation"), workplace: at("workplace"), achievements: at("achievements"),
    biography: nt("biography"), personality: nt("personality"), memories: nt("memory"), sources,
  };
}

const MONTHS = ["জানুয়ারি", "ফেব্রুয়ারি", "মার্চ", "এপ্রিল", "মে", "জুন", "জুলাই", "আগস্ট", "সেপ্টেম্বর", "অক্টোবর", "নভেম্বর", "ডিসেম্বর"];
export function formatDate(d: DateIn | undefined): string {
  if (!d || d.q === "unknown" || !d.y) return "অজানা";
  const core = [d.d ? toBn(d.d) : "", d.m ? MONTHS[d.m - 1] : "", toBn(d.y)].filter(Boolean).join(" ");
  if (d.q === "about") return `আনুমানিক ${core}`;
  if (d.q === "before") return `${core}-এর আগে`;
  if (d.q === "after") return `${core}-এর পরে`;
  return core;
}

export function explainError(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  if (/CYCLE|cycle/.test(m)) return "এটি করলে কেউ নিজেই নিজের পূর্বপুরুষ হয়ে যায়, তাই সম্ভব নয়।";
  if (/at most 2 biological/.test(m)) return "একজনের জৈবিক বাবা-মা ২ জনের বেশি হতে পারে না।";
  if (/[\u0980-\u09FF]/.test(m)) return m;
  return `সংরক্ষণ করা যায়নি: ${m}`;
}

// ---- small helpers used by import/restore and app settings ----
export function getMeta(db: Sql, key: string): string | null {
  return db.all<{ value: string }>("SELECT value FROM app_context WHERE key = ?", [key])[0]?.value ?? null;
}
export function setMeta(db: Sql, key: string, value: string) { db.run("INSERT OR REPLACE INTO app_context (key, value) VALUES (?, ?)", [key, value]); }

export function linkParent(db: Sql, child: string, parent: string, role: "father" | "mother", kind: ParentKind = "biological", status: Status = "unverified") {
  tx(db, () => {
    if (wouldCreateCycle(buildGraph(loadData(db)), parent, child)) throw new Error("CYCLE");
    db.run("INSERT INTO parent_child (id, parent_id, child_id, kind, parent_role, status, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)", [uid(), parent, child, kind, role, status, ACTOR]);
  });
}
export function linkSpouse(db: Sql, a: string, b: string, status: Status = "unverified") {
  if (a === b) return;
  const has = db.all("SELECT id FROM family_union WHERE deleted_at IS NULL AND ((partner1_id = ? AND partner2_id = ?) OR (partner1_id = ? AND partner2_id = ?))", [a, b, b, a]);
  if (!has.length) db.run("INSERT INTO family_union (id, partner1_id, partner2_id, kind, status, created_by) VALUES (?, ?, ?, 'marriage', ?, ?)", [uid(), a, b, status, ACTOR]);
}

export function addSource(db: Sql, personId: string, kind: string, title: string, informant?: string | null) {
  tx(db, () => {
    const sid = uid();
    db.run("INSERT INTO source (id, kind, title, informant, created_by) VALUES (?, ?, ?, ?, ?)", [sid, kind, title, informant || null, ACTOR]);
    db.run("INSERT INTO citation (id, source_id, target_table, target_id, created_by) VALUES (?, ?, 'person', ?, ?)", [uid(), sid, personId, ACTOR]);
  });
}
