import { deletePerson, getMeta, savePerson, setMeta, uid, type PersonIn } from "./repo";
import type { Sql } from "./sql";

export type Role = "owner" | "admin" | "editor" | "viewer";
export type MStatus = "invited" | "active" | "suspended";
export const ROLE_BN: Record<Role, string> = { owner: "মালিক", admin: "অ্যাডমিন", editor: "সম্পাদক", viewer: "দর্শক" };
export const STATUS_BN: Record<MStatus, string> = { invited: "আমন্ত্রিত", active: "সক্রিয়", suspended: "স্থগিত" };
export interface Member { id: string; email: string; name: string | null; role: Role; status: MStatus; personId: string | null }
export type Action = "edit_direct" | "submit" | "vote" | "manage_members" | "settings";

const MEMBER_SQL = "SELECT id, email, display_name AS name, role, status, person_id AS personId FROM member";
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const now = () => new Date().toISOString();

export const getMembers = (db: Sql) => db.all<Member>(`${MEMBER_SQL} ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 WHEN 'editor' THEN 2 ELSE 3 END, email`);
export const getMember = (db: Sql, id: string) => db.all<Member>(`${MEMBER_SQL} WHERE id = ?`, [id])[0] ?? null;

/** Who is using this phone. After Google login (step 7b) this is the signed-in member; until then the device owner. */
export function currentMember(db: Sql): Member | null {
  const id = getMeta(db, "current_member");
  const m = id ? getMember(db, id) : null;
  if (m && m.status === "active") return m;
  return db.all<Member>(`${MEMBER_SQL} WHERE role = 'owner' AND status = 'active'`)[0] ?? null;
}

export function can(m: Member | null, a: Action): boolean {
  if (!m) return a === "edit_direct";            // no members set up yet: single-owner mode, as before
  if (m.status !== "active") return false;
  switch (a) {
    case "edit_direct": return m.role === "owner" || m.role === "admin";
    case "submit": return m.role === "editor";
    case "vote": return m.role !== "viewer";
    case "manage_members": return m.role === "owner" || m.role === "admin";
    case "settings": return m.role === "owner";
  }
}
export const assignable = (actor: Member | null): Role[] => (actor?.status !== "active" ? [] : actor.role === "owner" ? ["admin", "editor", "viewer"] : actor.role === "admin" ? ["editor", "viewer"] : []);
export function canManage(actor: Member | null, target: Member): boolean {
  if (!actor || actor.status !== "active" || actor.id === target.id || target.role === "owner") return false;
  return actor.role === "owner" || (actor.role === "admin" && (target.role === "editor" || target.role === "viewer"));
}

export function withActor<T>(db: Sql, who: string, fn: () => T): T {
  const prev = getMeta(db, "actor") ?? "owner";
  setMeta(db, "actor", who);
  try { return fn(); } finally { setMeta(db, "actor", prev); }
}
const cleanEmail = (e: string) => {
  const v = e.trim().toLowerCase();
  if (!EMAIL.test(v)) throw new Error("ইমেইল ঠিকমতো লিখুন।");
  return v;
};

export function ensureOwner(db: Sql, email: string, name: string): Member {
  if (db.all("SELECT 1 AS x FROM member WHERE role = 'owner'").length) throw new Error("মালিক আগে থেকেই ঠিক করা আছে।");
  const id = uid();
  db.run("INSERT INTO member (id, email, display_name, role, status) VALUES (?, ?, ?, 'owner', 'active')", [id, cleanEmail(email), name.trim() || null]);
  setMeta(db, "current_member", id);
  return getMember(db, id)!;
}

export function inviteMember(db: Sql, actor: Member | null, i: { email: string; name?: string; role: Role }): Member {
  if (!can(actor, "manage_members")) throw new Error("সদস্য যোগ করার অনুমতি আপনার নেই।");
  if (!assignable(actor).includes(i.role)) throw new Error(`আপনি ${ROLE_BN[i.role]} হিসেবে কাউকে যোগ করতে পারবেন না।`);
  const email = cleanEmail(i.email);
  if (db.all("SELECT 1 AS x FROM member WHERE email = ?", [email]).length) throw new Error("এই ইমেইল আগে থেকেই তালিকায় আছে।");
  const id = uid();
  withActor(db, actor!.id, () => db.run("INSERT INTO member (id, email, display_name, role, status) VALUES (?, ?, ?, ?, 'invited')", [id, email, (i.name ?? "").trim() || null, i.role]));
  return getMember(db, id)!;
}
export function changeRole(db: Sql, actor: Member | null, targetId: string, role: Role): void {
  const t = getMember(db, targetId);
  if (!t) throw new Error("সদস্যকে পাওয়া যায়নি।");
  if (!canManage(actor, t) || !assignable(actor).includes(role)) throw new Error("এই পরিবর্তনের অনুমতি আপনার নেই।");
  withActor(db, actor!.id, () => db.run("UPDATE member SET role = ?, updated_at = ? WHERE id = ?", [role, now(), targetId]));
}
export function setMemberStatus(db: Sql, actor: Member | null, targetId: string, status: "active" | "suspended"): void {
  const t = getMember(db, targetId);
  if (!t) throw new Error("সদস্যকে পাওয়া যায়নি।");
  if (!canManage(actor, t)) throw new Error("এই পরিবর্তনের অনুমতি আপনার নেই।");
  if (t.status === "invited") throw new Error("আমন্ত্রিত সদস্য নিজে লগইন করলে সক্রিয় হবেন।");
  withActor(db, actor!.id, () => db.run("UPDATE member SET status = ?, updated_at = ? WHERE id = ?", [status, now(), targetId]));
}
/** Called after a verified Google sign-in. Only people already on the list can enter. */
export function activateOnSignIn(db: Sql, email: string, sub: string): Member {
  const m = db.all<Member & { sub: string | null }>(`SELECT id, email, display_name AS name, role, status, person_id AS personId, google_sub AS sub FROM member WHERE email = ?`, [email.trim().toLowerCase()])[0];
  if (!m) throw new Error("এই Gmail পরিবারের সদস্য-তালিকায় নেই। মালিক বা অ্যাডমিনকে আমন্ত্রণ পাঠাতে বলুন।");
  if (m.status === "suspended") throw new Error("আপনার অ্যাকাউন্ট স্থগিত আছে।");
  if (m.sub && m.sub !== sub) throw new Error("এই ইমেইলে অন্য Google অ্যাকাউন্ট যুক্ত আছে।");
  withActor(db, m.id, () => db.run("UPDATE member SET status = 'active', google_sub = ?, updated_at = ? WHERE id = ?", [sub, now(), m.id]));
  setMeta(db, "current_member", m.id);
  return getMember(db, m.id)!;
}

export function getApprovalsRequired(db: Sql): 2 | 3 { return getMeta(db, "approvals_required") === "3" ? 3 : 2; }
export function setApprovalsRequired(db: Sql, actor: Member | null, n: number): void {
  if (!can(actor, "settings")) throw new Error("শুধু মালিক এটি বদলাতে পারেন।");
  if (n !== 2 && n !== 3) throw new Error("২ বা ৩ জন বেছে নিন।");
  setMeta(db, "approvals_required", String(n));
}

export type Change = { kind: "save_person"; input: PersonIn } | { kind: "delete_person"; id: string; name: string };
export type Outcome = { applied: true; id: string } | { applied: false; requestId: string };

const run = (db: Sql, c: Change): string => (c.kind === "save_person" ? savePerson(db, c.input) : (deletePerson(db, c.id), c.id));

/** Owner/Admin: applied now. Editor: becomes a pending request. Viewer: refused. No members yet: applied (single-owner mode). */
export function submitChange(db: Sql, actor: Member | null, c: Change): Outcome {
  if (!actor) return { applied: true, id: run(db, c) };
  if (actor.status !== "active") throw new Error("আপনার অ্যাকাউন্ট সক্রিয় নয়।");
  if (actor.role === "viewer") throw new Error("দর্শক হিসেবে আপনি কিছু বদলাতে পারবেন না।");
  if (can(actor, "edit_direct")) return { applied: true, id: withActor(db, actor.id, () => run(db, c)) };
  const id = uid();
  const who = c.kind === "save_person" ? (c.input.nameBn || c.input.nameEn || "নামহীন") : c.name;
  const summary = c.kind === "save_person" ? `${who}: ${c.input.id ? "তথ্য সম্পাদনা" : "নতুন সদস্য যোগ"}` : `${who}: মুছে ফেলা`;
  db.run("INSERT INTO approval_request (id, kind, payload, summary, submitted_by, needed) VALUES (?, ?, ?, ?, ?, ?)",
    [id, c.kind, JSON.stringify(c), summary, actor.id, getApprovalsRequired(db)]);
  return { applied: false, requestId: id };
}

export interface Req { id: string; kind: string; summary: string; submittedBy: string; submitter: string; needed: number; status: string; error: string | null; createdAt: string;
  approvals: number; rejections: number; votes: { voter: string; voterName: string; decision: string; at: string }[] }
const label = (m: { name: string | null; email: string }) => m.name || m.email;
export function listRequests(db: Sql, pendingOnly: boolean, limit = 30): Req[] {
  const rows = db.all<{ id: string; kind: string; summary: string; by: string; needed: number; status: string; error: string | null; at: string; sn: string | null; se: string }>(
    `SELECT r.id, r.kind, r.summary, r.submitted_by AS by, r.needed, r.status, r.error, r.created_at AS at, m.display_name AS sn, m.email AS se
     FROM approval_request r JOIN member m ON m.id = r.submitted_by ${pendingOnly ? "WHERE r.status = 'pending'" : "WHERE r.status <> 'pending'"} ORDER BY r.created_at DESC LIMIT ?`, [limit]);
  return rows.map((r) => {
    const votes = db.all<{ voter: string; vn: string | null; ve: string; decision: string; at: string }>(
      "SELECT v.voter_id AS voter, m.display_name AS vn, m.email AS ve, v.decision, v.created_at AS at FROM approval_vote v JOIN member m ON m.id = v.voter_id WHERE v.request_id = ? ORDER BY v.created_at", [r.id])
      .map((v) => ({ voter: v.voter, voterName: label({ name: v.vn, email: v.ve }), decision: v.decision, at: v.at }));
    return { id: r.id, kind: r.kind, summary: r.summary, submittedBy: r.by, submitter: label({ name: r.sn, email: r.se }), needed: r.needed, status: r.status, error: r.error, createdAt: r.at,
      approvals: votes.filter((v) => v.decision === "approve").length, rejections: votes.filter((v) => v.decision === "reject").length, votes };
  });
}

const friendly = (e: unknown): Error => {
  const m = e instanceof Error ? e.message : String(e);
  if (/submitter cannot vote/.test(m)) return new Error("নিজের জমা দেওয়া পরিবর্তন নিজে অনুমোদন করা যায় না।");
  if (/voter must be/.test(m)) return new Error("ভোট দেওয়ার অনুমতি আপনার নেই।");
  if (/not pending/.test(m)) return new Error("এই অনুরোধ আগেই নিষ্পত্তি হয়ে গেছে।");
  if (/UNIQUE/.test(m)) return new Error("আপনি আগেই ভোট দিয়েছেন।");
  return e instanceof Error ? e : new Error(m);
};

/** Records one vote. When enough different people approve, the change is applied; when enough reject, it is closed. */
export function vote(db: Sql, voter: Member | null, requestId: string, decision: "approve" | "reject", comment?: string): "pending" | "applied" | "rejected" | "failed" {
  if (!can(voter, "vote") || !voter) throw new Error("ভোট দেওয়ার অনুমতি আপনার নেই।");
  try { db.run("INSERT INTO approval_vote (id, request_id, voter_id, decision, comment) VALUES (?, ?, ?, ?, ?)", [uid(), requestId, voter.id, decision, comment?.trim() || null]); }
  catch (e) { throw friendly(e); }
  const r = db.all<{ needed: number; by: string; payload: string }>("SELECT needed, submitted_by AS by, payload FROM approval_request WHERE id = ?", [requestId])[0];
  const n = (d: string) => db.all<{ n: number }>("SELECT COUNT(*) AS n FROM approval_vote WHERE request_id = ? AND decision = ?", [requestId, d])[0].n;
  if (n("approve") >= r.needed) {
    try { withActor(db, r.by, () => run(db, JSON.parse(r.payload) as Change)); }
    catch (e) {
      withActor(db, voter.id, () => db.run("UPDATE approval_request SET status = 'failed', error = ?, resolved_at = ? WHERE id = ?", [e instanceof Error ? e.message : String(e), now(), requestId]));
      return "failed";
    }
    withActor(db, voter.id, () => db.run("UPDATE approval_request SET status = 'applied', resolved_at = ? WHERE id = ?", [now(), requestId]));
    return "applied";
  }
  if (n("reject") >= r.needed) {
    withActor(db, voter.id, () => db.run("UPDATE approval_request SET status = 'rejected', resolved_at = ? WHERE id = ?", [now(), requestId]));
    return "rejected";
  }
  return "pending";
}
export function cancelRequest(db: Sql, actor: Member | null, requestId: string): void {
  const r = db.all<{ by: string }>("SELECT submitted_by AS by FROM approval_request WHERE id = ? AND status = 'pending'", [requestId])[0];
  if (!r) throw new Error("অনুরোধটি আর অপেক্ষমান নেই।");
  if (!actor || (actor.id !== r.by && !can(actor, "manage_members"))) throw new Error("বাতিল করার অনুমতি আপনার নেই।");
  withActor(db, actor.id, () => db.run("UPDATE approval_request SET status = 'cancelled', resolved_at = ? WHERE id = ?", [now(), requestId]));
}

export const TABLE_BN: Record<string, string> = { person: "সদস্য", person_name: "নাম", event: "ঘটনা/তারিখ", parent_child: "বাবা-মা সম্পর্ক", family_union: "দাম্পত্য সম্পর্ক", person_note: "লেখা", person_attribute: "তথ্য",
  place: "স্থান", source: "উৎস", citation: "উৎস-সংযোগ", media: "মিডিয়া", branch: "শাখা", member: "সদস্য-তালিকা", approval_request: "অনুমোদন-অনুরোধ", approval_vote: "ভোট" };
export const ACTION_BN: Record<string, string> = { insert: "যোগ", update: "পরিবর্তন", delete: "মুছে ফেলা", restore: "ফেরানো" };
export interface LogRow { id: number; at: string; table: string; action: string; actor: string; detail: string }
export function history(db: Sql, limit = 100): LogRow[] {
  const names = new Map(getMembers(db).map((m) => [m.id, label(m)]));
  return db.all<{ id: number; at: string; tbl: string; action: string; actor: string | null; after: string | null }>(
    "SELECT id, at, entity_table AS tbl, action, actor, after_json AS after FROM change_log ORDER BY id DESC LIMIT ?", [limit])
    .map((r) => {
      let a: Record<string, unknown> = {};
      try { a = r.after ? JSON.parse(r.after) : {}; } catch { /* keep empty */ }
      const detail = String(a.full_name ?? a.summary ?? a.email ?? a.type ?? a.title ?? a.decision ?? "");
      return { id: r.id, at: r.at, table: r.tbl, action: r.action, actor: r.actor ? (names.get(r.actor) ?? (r.actor === "owner" ? "মালিক" : r.actor)) : "অজানা", detail };
    });
}
