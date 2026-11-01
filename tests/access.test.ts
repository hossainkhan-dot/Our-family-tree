import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { savePerson, loadData, type PersonIn } from "../src/db/repo.ts";
import { exportBackup, parseBackup, restoreInto, serializeBackup } from "../src/db/backup.ts";
import * as A from "../src/db/access.ts";
import type { Sql } from "../src/db/sql.ts";

function mk(): Sql {
  const raw = new DatabaseSync(":memory:");
  raw.exec("PRAGMA foreign_keys = ON");
  raw.exec(readFileSync("src/db/migrations/001_core.sql", "utf8"));
  raw.exec(readFileSync("src/db/migrations/002_access.sql", "utf8"));
  raw.exec("INSERT INTO app_context(key,value) VALUES('actor','owner')");
  return { run: (s, p) => { if (p && p.length) raw.prepare(s).run(...(p as never[])); else raw.exec(s); }, all: (s, p) => raw.prepare(s).all(...((p ?? []) as never[])) as never };
}
let fail = 0;
const eq = (l: string, got: unknown, want: unknown) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) fail++; console.log(ok ? "ok  " : "FAIL", l, ok ? "" : `got=${JSON.stringify(got)} want=${JSON.stringify(want)}`); };
const throws = (l: string, fn: () => unknown, re: RegExp) => { try { fn(); fail++; console.log("FAIL", l, "(no error)"); } catch (e) { const ok = re.test(String((e as Error).message)); if (!ok) fail++; console.log(ok ? "ok  " : "FAIL", l, "->", (e as Error).message); } };
const base = (o: Partial<PersonIn>): PersonIn => ({ sex: "male", living: "living", status: "unverified", ...o });
const people = (db: Sql) => loadData(db).people.map((p) => p.name);

const db = mk();
const owner = A.ensureOwner(db, " Owner@Gmail.com ", "মালিক");
eq("owner email normalised", owner.email, "owner@gmail.com");
throws("second owner refused", () => A.ensureOwner(db, "x@gmail.com", "x"), /আগে থেকেই/);
throws("second owner refused by DB", () => db.run("INSERT INTO member(id,email,role,status) VALUES('z','z@gmail.com','owner','active')"), /UNIQUE/);
throws("owner cannot be demoted (DB)", () => db.run("UPDATE member SET role='viewer' WHERE id = ?", [owner.id]), /owner cannot/);
throws("bad email", () => A.inviteMember(db, owner, { email: "nope", role: "editor" }), /ইমেইল/);

const admin = A.activateOnSignIn(db, A.inviteMember(db, owner, { email: "admin@gmail.com", name: "অ্যাডমিন", role: "admin" }).email, "s-admin");
eq("invited -> active at sign-in", admin.status, "active");
throws("admin cannot invite admin", () => A.inviteMember(db, admin, { email: "a2@gmail.com", role: "admin" }), /পারবেন না/);
const e1 = A.activateOnSignIn(db, A.inviteMember(db, admin, { email: "e1@gmail.com", name: "সম্পাদক ১", role: "editor" }).email, "s-e1");
const e2 = A.activateOnSignIn(db, A.inviteMember(db, owner, { email: "e2@gmail.com", name: "সম্পাদক ২", role: "editor" }).email, "s-e2");
const v = A.activateOnSignIn(db, A.inviteMember(db, owner, { email: "v@gmail.com", role: "viewer" }).email, "s-v");
throws("editor cannot invite", () => A.inviteMember(db, e1, { email: "q@gmail.com", role: "viewer" }), /অনুমতি/);
throws("duplicate email", () => A.inviteMember(db, owner, { email: "E1@gmail.com", role: "viewer" }), /আগে থেকেই/);
throws("sign-in by unknown Gmail refused", () => A.activateOnSignIn(db, "stranger@gmail.com", "s"), /তালিকায় নেই/);
throws("same Gmail, other Google account refused", () => A.activateOnSignIn(db, "e1@gmail.com", "other"), /অন্য Google/);
throws("admin cannot touch admin/owner", () => A.changeRole(db, admin, owner.id, "viewer"), /অনুমতি/);
throws("nobody changes own role", () => A.changeRole(db, owner, owner.id, "viewer"), /অনুমতি/);
A.changeRole(db, admin, v.id, "editor"); A.changeRole(db, admin, v.id, "viewer");
eq("admin can move editor/viewer", A.getMember(db, v.id)?.role, "viewer");

// editor change -> pending, not applied
const out = A.submitChange(db, e1, { kind: "save_person", input: base({ nameBn: "নতুন সদস্য" }) });
eq("editor change is pending", out.applied, false);
eq("not applied yet", people(db), []);
eq("pending count", A.listRequests(db, true).length, 1);
const rid = (out as { requestId: string }).requestId;
throws("viewer cannot change", () => A.submitChange(db, v, { kind: "save_person", input: base({ nameBn: "x" }) }), /দর্শক/);
throws("submitter cannot approve own", () => A.vote(db, e1, rid, "approve"), /নিজের/);
throws("viewer cannot vote", () => A.vote(db, v, rid, "approve"), /অনুমতি/);
eq("first approval keeps it pending", A.vote(db, e2, rid, "approve"), "pending");
throws("same person cannot vote twice", () => A.vote(db, e2, rid, "approve"), /আগেই ভোট/);
eq("still not applied", people(db), []);
eq("second DIFFERENT approver applies it", A.vote(db, admin, rid, "approve"), "applied");
eq("person now exists", people(db), ["নতুন সদস্য"]);
const h = A.history(db, 200);
eq("history credits the submitting editor", h.some((r) => r.table === "person" && r.actor === "সম্পাদক ১"), true);
eq("history records votes", h.filter((r) => r.table === "approval_vote").length, 2);
throws("closed request takes no votes", () => A.vote(db, owner, rid, "approve"), /নিষ্পত্তি/);
throws("DB refuses 'applied' without votes", () => { const o2 = A.submitChange(db, e1, { kind: "save_person", input: base({ nameBn: "y" }) }) as { requestId: string }; db.run("UPDATE approval_request SET status='applied' WHERE id = ?", [o2.requestId]); }, /not enough/);
throws("votes cannot be edited (DB)", () => db.run("UPDATE approval_vote SET decision='approve'"), /cannot be changed/);
throws("requests cannot be deleted (DB)", () => db.run("DELETE FROM approval_request"), /kept forever/);

// rejection and setting of 3
const r2 = A.listRequests(db, true)[0].id;
A.vote(db, e2, r2, "reject");
eq("two rejects close it", A.vote(db, owner, r2, "reject"), "rejected");
eq("rejected person never created", people(db), ["নতুন সদস্য"]);
throws("only owner sets N", () => A.setApprovalsRequired(db, admin, 3), /মালিক/);
throws("N must be 2 or 3", () => A.setApprovalsRequired(db, owner, 5), /২ বা ৩/);
A.setApprovalsRequired(db, owner, 3);
const o3 = A.submitChange(db, e1, { kind: "save_person", input: base({ nameBn: "তিনজন লাগবে" }) }) as { requestId: string };
A.vote(db, e2, o3.requestId, "approve");
eq("2 of 3 not enough", A.vote(db, admin, o3.requestId, "approve"), "pending");
eq("3rd approves", A.vote(db, owner, o3.requestId, "approve"), "applied");
eq("applied", people(db).includes("তিনজন লাগবে"), true);

// owner/admin edit directly; delete via approval; failed apply is recorded, not lost
const d = A.submitChange(db, owner, { kind: "save_person", input: base({ nameBn: "সরাসরি" }) });
eq("owner applies directly", d.applied, true);
const target = loadData(db).people.find((p) => p.name === "সরাসরি")!.id;
const del = A.submitChange(db, e1, { kind: "delete_person", id: target, name: "সরাসরি" }) as { requestId: string };
A.vote(db, e2, del.requestId, "approve"); A.setApprovalsRequired(db, owner, 2);
const bad = A.submitChange(db, e1, { kind: "save_person", input: base({ nameBn: "" }) }) as { requestId: string };
A.vote(db, e2, bad.requestId, "approve");
eq("invalid change fails cleanly", A.vote(db, owner, bad.requestId, "approve"), "failed");
eq("failure reason kept", A.listRequests(db, false).find((r) => r.id === bad.requestId)?.status, "failed");
A.setMemberStatus(db, owner, e2.id, "suspended");
throws("suspended member cannot vote", () => A.vote(db, A.getMember(db, e2.id), del.requestId, "approve"), /অনুমতি/);
A.setMemberStatus(db, owner, e2.id, "active");
eq("pending delete still waiting", A.listRequests(db, true).some((r) => r.id === del.requestId), true);
A.cancelRequest(db, e1, del.requestId);
eq("submitter can cancel", A.listRequests(db, false).find((r) => r.id === del.requestId)?.status, "cancelled");

// backup round trip keeps members, requests, votes (restore must not trip the rules)
const b = exportBackup(db);
const R = mk();
restoreInto(R, parseBackup(serializeBackup(b)));
eq("members restored", A.getMembers(R).length, A.getMembers(db).length);
eq("requests restored", A.listRequests(R, false, 100).length, A.listRequests(db, false, 100).length);
eq("votes restored", A.history(R, 500).filter((r) => r.table === "approval_vote").length, A.history(db, 500).filter((r) => r.table === "approval_vote").length);
throws("rules active again after restore", () => A.vote(R, e1, A.listRequests(R, false)[0].id, "approve"), /নিষ্পত্তি|নিজের|অনুমতি/);

console.log(fail ? `\n${fail} FAILED` : "\naccess tests passed");
process.exit(fail ? 1 : 0);
