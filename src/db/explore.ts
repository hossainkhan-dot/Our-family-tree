import { findDuplicates, toBn } from "../core/relations";
import { getMeta, loadData, uid, type DateIn, type Qualifier } from "./repo";
import type { Sql } from "./sql";

const BN = "০১২৩৪৫৬৭৮৯";
const toAscii = (s: string) => s.replace(/[০-৯]/g, (d) => String(BN.indexOf(d)));
const like = (s: string) => `%${s.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
const primaryName = "COALESCE((SELECT full_name FROM person_name n WHERE n.person_id = p.id AND n.deleted_at IS NULL AND n.is_primary = 1 ORDER BY n.language = 'bn' DESC LIMIT 1), 'নামহীন')";

// ───────── অনুসন্ধান
export interface Hit { kind: "person" | "place" | "event" | "note"; id: string; personId: string | null; title: string; detail: string }
/** নাম (সব ধরনের), পেশা/শিক্ষা ইত্যাদি তথ্য, লেখা/স্মৃতি, স্থান ও ঘটনায় খোঁজে। বাংলা ও ইংরেজি সংখ্যা দুভাবেই মেলে। */
export function searchAll(db: Sql, query: string, limit = 60): Hit[] {
  const q = query.trim();
  if (q.length < 1) return [];
  const forms = [...new Set([q, toAscii(q), q.replace(/\d/g, (d) => BN[Number(d)])])].map(like);
  const out: Hit[] = [], seen = new Set<string>();
  const push = (h: Hit) => { const k = `${h.kind}:${h.id}:${h.detail}`; if (!seen.has(k) && out.length < limit) { seen.add(k); out.push(h); } };
  for (const f of forms) {
    for (const r of db.all<{ id: string; name: string; hit: string; kind: string }>(
      `SELECT p.id, ${primaryName} AS name, n.full_name AS hit, n.kind FROM person_name n JOIN person p ON p.id = n.person_id
       WHERE n.deleted_at IS NULL AND p.deleted_at IS NULL AND p.is_placeholder = 0 AND n.full_name LIKE ? ESCAPE '\\' LIMIT ?`, [f, limit]))
      push({ kind: "person", id: r.id, personId: r.id, title: r.name, detail: r.hit === r.name ? "নাম" : `${r.kind === "nickname" ? "ডাকনাম" : "অন্য নাম"}: ${r.hit}` });
    for (const r of db.all<{ id: string; name: string; key: string; value: string }>(
      `SELECT p.id, ${primaryName} AS name, a.key, a.value FROM person_attribute a JOIN person p ON p.id = a.person_id
       WHERE a.deleted_at IS NULL AND p.deleted_at IS NULL AND a.value LIKE ? ESCAPE '\\' LIMIT ?`, [f, limit]))
      push({ kind: "person", id: r.id, personId: r.id, title: r.name, detail: `${ATTR_BN[r.key] ?? r.key}: ${r.value}` });
    for (const r of db.all<{ id: string; name: string; body: string }>(
      `SELECT p.id, ${primaryName} AS name, t.body FROM person_note t JOIN person p ON p.id = t.person_id
       WHERE t.deleted_at IS NULL AND p.deleted_at IS NULL AND (t.body LIKE ? ESCAPE '\\' OR t.title LIKE ? ESCAPE '\\') LIMIT ?`, [f, f, limit]))
      push({ kind: "note", id: r.id, personId: r.id, title: r.name, detail: snippet(r.body, q) });
    for (const r of db.all<{ id: string; name: string | null; en: string | null; n: number }>(
      `SELECT l.id, l.name_bn AS name, l.name_en AS en, (SELECT COUNT(*) FROM event e WHERE e.place_id = l.id AND e.deleted_at IS NULL) AS n FROM place l
       WHERE l.deleted_at IS NULL AND (l.name_bn LIKE ? ESCAPE '\\' OR l.name_en LIKE ? ESCAPE '\\') LIMIT ?`, [f, f, limit]))
      push({ kind: "place", id: r.id, personId: null, title: r.name ?? r.en ?? "", detail: `স্থান · ${toBn(r.n)}টি ঘটনা` });
    for (const r of db.all<{ id: string; person_id: string | null; title: string | null; description: string | null; type: string }>(
      `SELECT e.id, e.person_id, e.title, e.description, e.type FROM event e WHERE e.deleted_at IS NULL AND (e.title LIKE ? ESCAPE '\\' OR e.description LIKE ? ESCAPE '\\') LIMIT ?`, [f, f, limit]))
      push({ kind: "event", id: r.id, personId: r.person_id, title: r.title ?? EVENT_BN[r.type] ?? r.type, detail: snippet(r.description ?? r.title ?? "", q) });
  }
  return out;
}
const snippet = (t: string, q: string) => {
  const i = Math.max(0, t.toLowerCase().indexOf(q.toLowerCase()));
  return (i > 20 ? "…" : "") + t.slice(Math.max(0, i - 20), i + 60).replace(/\s+/g, " ") + (t.length > i + 60 ? "…" : "");
};
export const ATTR_BN: Record<string, string> = { education: "শিক্ষা", institution: "প্রতিষ্ঠান", occupation: "পেশা", workplace: "কর্মস্থল", achievements: "অর্জন" };
export const EVENT_BN: Record<string, string> = { birth: "জন্ম", death: "মৃত্যু", burial: "দাফন/সৎকার", marriage: "বিবাহ", divorce: "বিচ্ছেদ", residence: "বসবাস", migration: "স্থানান্তর",
  education: "শিক্ষা", occupation: "পেশা", achievement: "অর্জন", property: "সম্পত্তি", family_history: "বংশের ইতিহাস", other: "অন্যান্য" };

// ───────── টাইমলাইন
export interface TLRow { id: string; type: string; personId: string | null; personName: string | null; title: string; description: string | null; place: string | null; date: DateIn; status: string }
/** তারিখ অনুযায়ী সাজানো। তারিখ অজানা ঘটনা শেষে যায় (অনুমান করে বসানো হয় না)। */
export function timeline(db: Sql, f: { personId?: string; type?: string } = {}): TLRow[] {
  const where = ["e.deleted_at IS NULL"], params: unknown[] = [];
  if (f.personId) { where.push("(e.person_id = ? OR e.union_id IN (SELECT id FROM family_union WHERE partner1_id = ? OR partner2_id = ?))"); params.push(f.personId, f.personId, f.personId); }
  if (f.type) { where.push("e.type = ?"); params.push(f.type); }
  const rows = db.all<{ id: string; type: string; person_id: string | null; pn: string | null; title: string | null; description: string | null; place: string | null; q: Qualifier; y: number | null; m: number | null; d: number | null; status: string }>(
    `SELECT e.id, e.type, e.person_id, (SELECT full_name FROM person_name n WHERE n.person_id = e.person_id AND n.deleted_at IS NULL AND n.is_primary = 1 ORDER BY n.language = 'bn' DESC LIMIT 1) AS pn,
     e.title, e.description, COALESCE((SELECT name_bn FROM place WHERE id = e.place_id), (SELECT name_en FROM place WHERE id = e.place_id)) AS place,
     e.d_qualifier AS q, e.d_y AS y, e.d_m AS m, e.d_d AS d, e.status FROM event e WHERE ${where.join(" AND ")}`, params);
  const key = (r: { y: number | null; m: number | null; d: number | null }) => (r.y === null ? Number.POSITIVE_INFINITY : r.y * 10000 + (r.m ?? 0) * 100 + (r.d ?? 0));
  return rows.sort((a, b) => key(a) - key(b) || a.type.localeCompare(b.type))
    .map((r) => ({ id: r.id, type: r.type, personId: r.person_id, personName: r.pn, title: r.title ?? EVENT_BN[r.type] ?? r.type, description: r.description, place: r.place, date: { q: r.q, y: r.y, m: r.m, d: r.d }, status: r.status }));
}

export interface EventIn { type: string; personId?: string | null; title?: string; description?: string; place?: string; date: DateIn; status?: string }
/** নতুন ঘটনা (যেমন বসবাস, পেশা, স্থানান্তর, বংশের ইতিহাস)। অজানা তারিখ NULL থাকে। */
export function addEvent(db: Sql, e: EventIn): string {
  if (!(e.type in EVENT_BN)) throw new Error("ঘটনার ধরন চেনা যায়নি।");
  if (e.type !== "family_history" && !e.personId) throw new Error("এই ধরনের ঘটনার জন্য একজন সদস্য বেছে নিন।");
  if (!(e.title ?? "").trim() && !(e.description ?? "").trim() && e.type === "family_history") throw new Error("বংশের ইতিহাসের জন্য একটি শিরোনাম বা বিবরণ লিখুন।");
  const q = e.date.q ?? "unknown", y = q === "unknown" ? null : e.date.y ?? null;
  if (q !== "unknown" && (!y || y < 1 || y > 2200)) throw new Error("সাল ঠিকমতো লিখুন।");
  if (e.date.m && (e.date.m < 1 || e.date.m > 12)) throw new Error("মাস ১–১২ হতে হবে।");
  if (e.date.d && (e.date.d < 1 || e.date.d > 31)) throw new Error("তারিখ ১–৩১ হতে হবে।");
  if (q === "between") throw new Error("সময়কাল এখনো এখানে বসানো যায় না; আনুমানিক বা নির্দিষ্ট সাল দিন।");
  let placeId: string | null = null;
  const pl = (e.place ?? "").trim();
  if (pl) {
    placeId = db.all<{ id: string }>("SELECT id FROM place WHERE name_bn = ? AND deleted_at IS NULL", [pl])[0]?.id ?? null;
    if (!placeId) { placeId = uid(); db.run("INSERT INTO place (id, name_bn, type, created_by) VALUES (?, ?, 'village', ?)", [placeId, pl, getMeta(db, "actor") ?? "owner"]); }
  }
  const id = uid();
  db.run(`INSERT INTO event (id, type, person_id, title, description, place_id, d_qualifier, d_y, d_m, d_d, status, created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id, e.type, e.personId ?? null, (e.title ?? "").trim() || null, (e.description ?? "").trim() || null, placeId, q, y, y ? e.date.m ?? null : null, y ? e.date.d ?? null : null, e.status ?? "unverified", getMeta(db, "actor") ?? "owner"]);
  return id;
}

// ───────── মানচিত্র (অফলাইন: ব্যাকগ্রাউন্ড ম্যাপ ছাড়া, স্থানাঙ্ক অনুযায়ী বিন্দু)
export interface PlaceRow { id: string; name: string; lat: number | null; lng: number | null; events: number; people: number }
export function places(db: Sql): PlaceRow[] {
  return db.all<{ id: string; bn: string | null; en: string | null; lat: number | null; lng: number | null; ev: number; pe: number }>(
    `SELECT l.id, l.name_bn AS bn, l.name_en AS en, l.latitude AS lat, l.longitude AS lng,
     (SELECT COUNT(*) FROM event e WHERE e.place_id = l.id AND e.deleted_at IS NULL) AS ev,
     (SELECT COUNT(DISTINCT e.person_id) FROM event e WHERE e.place_id = l.id AND e.deleted_at IS NULL AND e.person_id IS NOT NULL) AS pe
     FROM place l WHERE l.deleted_at IS NULL ORDER BY ev DESC, l.name_bn`).map((r) => ({ id: r.id, name: r.bn ?? r.en ?? "", lat: r.lat, lng: r.lng, events: r.ev, people: r.pe }));
}
export function setPlaceCoords(db: Sql, id: string, lat: number | null, lng: number | null): void {
  if ((lat === null) !== (lng === null)) throw new Error("অক্ষাংশ ও দ্রাঘিমাংশ দুটোই দিন (বা দুটোই খালি রাখুন)।");
  if (lat !== null && (!Number.isFinite(lat) || lat < -90 || lat > 90)) throw new Error("অক্ষাংশ -৯০ থেকে ৯০-এর মধ্যে হতে হবে।");
  if (lng !== null && (!Number.isFinite(lng) || lng < -180 || lng > 180)) throw new Error("দ্রাঘিমাংশ -১৮০ থেকে ১৮০-এর মধ্যে হতে হবে।");
  db.run("UPDATE place SET latitude = ?, longitude = ?, status = CASE WHEN ? IS NULL THEN status ELSE 'unverified' END, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ? AND deleted_at IS NULL", [lat, lng, lat, id]);
}
/** স্থানাঙ্ক → SVG বিন্দু (পার্শ্বরেখা সহ)। একটি বিন্দু হলে মাঝখানে। */
export function project(ps: { lat: number; lng: number }[], w: number, h: number, pad = 28): { x: number; y: number }[] {
  if (!ps.length) return [];
  const la = ps.map((p) => p.lat), lo = ps.map((p) => p.lng);
  const [a0, a1, o0, o1] = [Math.min(...la), Math.max(...la), Math.min(...lo), Math.max(...lo)];
  const k = Math.cos(((a0 + a1) / 2) * Math.PI / 180), spanX = Math.max((o1 - o0) * k, 1e-9), spanY = Math.max(a1 - a0, 1e-9);
  const s = Math.min((w - 2 * pad) / spanX, (h - 2 * pad) / spanY), ox = (w - spanX * s) / 2, oy = (h - spanY * s) / 2;
  return ps.map((p) => ({ x: ps.length === 1 || o1 === o0 ? w / 2 : ox + (p.lng - o0) * k * s, y: ps.length === 1 || a1 === a0 ? h / 2 : oy + (a1 - p.lat) * s }));
}

// ───────── ড্যাশবোর্ড
export interface Dash {
  people: number; living: number; deceased: number; unknownLiving: number; male: number; female: number;
  byStatus: Record<string, number>; unknownAncestors: number; events: number; places: number; placesMapped: number; sources: number; media: number;
  noSource: number; noBirth: number; deceasedNoDeath: number; duplicates: number; pendingApprovals: number; members: number;
  oldestYear: number | null; lastBackup: string | null; recent: { at: string; table: string; action: string }[];
}
const n = (db: Sql, sql: string, p: unknown[] = []) => Number(db.all<{ n: number }>(sql, p)[0]?.n ?? 0);
export function dashboard(db: Sql): Dash {
  const live = "p.deleted_at IS NULL AND p.is_placeholder = 0";
  const byStatus: Record<string, number> = { verified: 0, unverified: 0, estimated: 0, unknown: 0 };
  for (const r of db.all<{ s: string; c: number }>(`SELECT p.status AS s, COUNT(*) AS c FROM person p WHERE ${live} GROUP BY p.status`)) byStatus[r.s] = r.c;
  const has = (t: string) => db.all("SELECT 1 AS x FROM sqlite_master WHERE type = 'table' AND name = ?", [t]).length > 0;
  return {
    people: n(db, `SELECT COUNT(*) AS n FROM person p WHERE ${live}`),
    living: n(db, `SELECT COUNT(*) AS n FROM person p WHERE ${live} AND living_status = 'living'`),
    deceased: n(db, `SELECT COUNT(*) AS n FROM person p WHERE ${live} AND living_status = 'deceased'`),
    unknownLiving: n(db, `SELECT COUNT(*) AS n FROM person p WHERE ${live} AND living_status = 'unknown'`),
    male: n(db, `SELECT COUNT(*) AS n FROM person p WHERE ${live} AND sex = 'male'`),
    female: n(db, `SELECT COUNT(*) AS n FROM person p WHERE ${live} AND sex = 'female'`),
    byStatus,
    unknownAncestors: n(db, "SELECT COUNT(*) AS n FROM person p WHERE p.deleted_at IS NULL AND p.is_placeholder = 1"),
    events: n(db, "SELECT COUNT(*) AS n FROM event WHERE deleted_at IS NULL"),
    places: n(db, "SELECT COUNT(*) AS n FROM place WHERE deleted_at IS NULL"),
    placesMapped: n(db, "SELECT COUNT(*) AS n FROM place WHERE deleted_at IS NULL AND latitude IS NOT NULL"),
    sources: n(db, "SELECT COUNT(*) AS n FROM source WHERE deleted_at IS NULL"),
    media: n(db, "SELECT COUNT(*) AS n FROM media WHERE deleted_at IS NULL"),
    noSource: n(db, `SELECT COUNT(*) AS n FROM person p WHERE ${live} AND NOT EXISTS (SELECT 1 FROM citation c WHERE c.target_table = 'person' AND c.target_id = p.id AND c.deleted_at IS NULL)`),
    noBirth: n(db, `SELECT COUNT(*) AS n FROM person p WHERE ${live} AND NOT EXISTS (SELECT 1 FROM event e WHERE e.person_id = p.id AND e.type = 'birth' AND e.deleted_at IS NULL AND e.d_y IS NOT NULL)`),
    deceasedNoDeath: n(db, `SELECT COUNT(*) AS n FROM person p WHERE ${live} AND living_status = 'deceased' AND NOT EXISTS (SELECT 1 FROM event e WHERE e.person_id = p.id AND e.type = 'death' AND e.deleted_at IS NULL AND e.d_y IS NOT NULL)`),
    duplicates: findDuplicates(loadData(db).people).length,
    pendingApprovals: has("approval_request") ? n(db, "SELECT COUNT(*) AS n FROM approval_request WHERE status = 'pending'") : 0,
    members: has("member") ? n(db, "SELECT COUNT(*) AS n FROM member WHERE status = 'active'") : 0,
    oldestYear: db.all<{ y: number | null }>("SELECT MIN(d_y) AS y FROM event WHERE deleted_at IS NULL AND type = 'birth' AND d_y IS NOT NULL")[0]?.y ?? null,
    lastBackup: getMeta(db, "last_export"),
    recent: db.all<{ at: string; t: string; a: string }>("SELECT at, entity_table AS t, action AS a FROM change_log ORDER BY id DESC LIMIT 5").map((r) => ({ at: r.at, table: r.t, action: r.a })),
  };
}
