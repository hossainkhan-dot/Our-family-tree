import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { savePerson, loadData, getProfile, type PersonIn } from "../src/db/repo.ts";
import type { Sql } from "../src/db/sql.ts";

function mk(): Sql {
  const raw = new DatabaseSync(":memory:");
  raw.exec("PRAGMA foreign_keys = ON");
  raw.exec(readFileSync("src/db/migrations/001_core.sql", "utf8"));
  raw.exec("INSERT INTO app_context(key,value) VALUES('actor','owner')");
  return { run: (s, p) => { if (p && p.length) raw.prepare(s).run(...(p as never[])); else raw.exec(s); }, all: (s, p) => raw.prepare(s).all(...((p ?? []) as never[])) as never };
}
let fail = 0;
const eq = (l: string, got: unknown, want: unknown) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) fail++; console.log(ok ? "ok  " : "FAIL", l, ok ? "" : `got=${JSON.stringify(got)} want=${JSON.stringify(want)}`); };
const throws = (l: string, fn: () => void, re: RegExp) => { try { fn(); fail++; console.log("FAIL", l, "(no error)"); } catch (e) { const ok = re.test(String((e as Error).message)); if (!ok) fail++; console.log(ok ? "ok  " : "FAIL", l, "->", (e as Error).message); } };
const base = (o: Partial<PersonIn>): PersonIn => ({ sex: "male", living: "living", status: "unverified", ...o });
const edge = (db: Sql, p: string, c: string) => loadData(db).edges.filter((e) => e.parent === p && e.child === c).length;

// grandparent via "দাদা" / "নানী"
{
  const A = mk();
  const gf = savePerson(A, base({ nameBn: "দাদা" })), gm = savePerson(A, base({ nameBn: "নানী", sex: "female" }));
  const dad = savePerson(A, base({ nameBn: "বাবা" })), mom = savePerson(A, base({ nameBn: "মা", sex: "female" }));
  const me = savePerson(A, base({ nameBn: "আমি" }));
  throws("দাদা without father", () => savePerson(A, base({ id: me, nameBn: "আমি", relations: [{ kind: "gf_p", otherId: gf }] })), /আগে বাবা/);
  savePerson(A, base({ id: me, nameBn: "আমি", fatherId: dad, motherId: mom, relations: [{ kind: "gf_p", otherId: gf }, { kind: "gm_m", otherId: gm }] }));
  eq("দাদা linked to father", edge(A, gf, dad), 1);
  eq("নানী linked to mother", edge(A, gm, mom), 1);
  savePerson(A, base({ id: me, nameBn: "আমি", fatherId: dad, motherId: mom, relations: [{ kind: "gf_p", otherId: gf }, { kind: "gf_p", otherId: gf }] }));
  eq("saving again adds no second line", edge(A, gf, dad), 1);
  const other = savePerson(A, base({ nameBn: "অন্য দাদা" }));
  throws("different grandfather rejected", () => savePerson(A, base({ id: me, nameBn: "আমি", fatherId: dad, motherId: mom, relations: [{ kind: "gf_p", otherId: other }] })), /আগে থেকেই/);
}
// siblings
{
  const A = mk();
  const dad = savePerson(A, base({ nameBn: "বাবা" })), me = savePerson(A, base({ nameBn: "আমি", fatherId: dad }));
  const sis = savePerson(A, base({ nameBn: "বোন", sex: "female" }));
  savePerson(A, base({ id: me, nameBn: "আমি", fatherId: dad, relations: [{ kind: "sister", otherId: sis }] }));
  eq("sister gets my father", edge(A, dad, sis), 1);
  eq("father line to me unchanged", edge(A, dad, me), 1);
  const x = savePerson(A, base({ nameBn: "এক্স" })), y = savePerson(A, base({ nameBn: "ওয়াই" }));
  throws("siblings with no parents", () => savePerson(A, base({ id: x, nameBn: "এক্স", relations: [{ kind: "brother", otherId: y }] })), /বাবা বা মা/);
  // sibling's parent is known, mine is not: I get it
  const z = savePerson(A, base({ nameBn: "জেড" }));
  savePerson(A, base({ id: z, nameBn: "জেড", relations: [{ kind: "sister", otherId: sis }] }));
  eq("I take sibling's father", edge(A, dad, z), 1);
}
// children
{
  const A = mk();
  const kid = savePerson(A, base({ nameBn: "সন্তান" }));
  const p = savePerson(A, base({ nameBn: "মা", sex: "female", relations: [{ kind: "son", otherId: kid }] }));
  eq("mother -> son", loadData(A).edges.filter((e) => e.parent === p && e.child === kid && e.role === "mother").length, 1);
  throws("child needs sex", () => savePerson(A, base({ nameBn: "অজানা লিঙ্গ", sex: "unknown", relations: [{ kind: "son", otherId: kid }] })), /লিঙ্গ/);
  eq("failed save leaves nothing behind", loadData(A).people.length, 2);
}
// duplicate parent rows (e.g. biological + adoptive) and duplicate couples -> one line
{
  const A = mk();
  const f = savePerson(A, base({ nameBn: "বাবা" })), m = savePerson(A, base({ nameBn: "মা", sex: "female", spouseIds: [f] }));
  const c = savePerson(A, base({ nameBn: "সন্তান", fatherId: f }));
  A.run("INSERT INTO parent_child (id,parent_id,child_id,kind,parent_role,status,created_by) VALUES ('dup',?,?,'adoptive','parent','unverified','owner')", [f, c]);
  A.run("INSERT INTO family_union (id,partner1_id,partner2_id,kind,status,created_by) VALUES ('u2',?,?,'marriage','unverified','owner')", [m, f]);
  eq("one line per parent-child pair", edge(A, f, c), 1);
  eq("one line per couple", loadData(A).unions.length, 1);
}
console.log(fail ? `\n${fail} FAILED` : "\nrelation tests passed");
process.exit(fail ? 1 : 0);
