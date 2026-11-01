import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { savePerson, loadData, getProfile, deletePerson, getEgo, formatDate, explainError, type PersonIn } from "../src/db/repo.ts";
import { buildGraph, relation, ancestorCount } from "../src/core/relations.ts";
import type { Sql } from "../src/db/sql.ts";

const raw = new DatabaseSync(":memory:");
raw.exec("PRAGMA foreign_keys = ON");
raw.exec(readFileSync("src/db/migrations/001_core.sql", "utf8"));
const db: Sql = {
  run: (sql, p) => { if (p && p.length) raw.prepare(sql).run(...(p as never[])); else raw.exec(sql); },
  all: (sql, p) => raw.prepare(sql).all(...((p ?? []) as never[])) as never,
};
db.run("INSERT INTO app_context(key,value) VALUES('actor','owner')");
let fail = 0;
const eq = (l: string, got: unknown, want: unknown) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) fail++; console.log(ok ? "ok  " : "FAIL", l, ok ? "" : `got=${JSON.stringify(got)} want=${JSON.stringify(want)}`); };
const throws = (l: string, fn: () => void, re: RegExp) => { try { fn(); fail++; console.log("FAIL", l, "(no error)"); } catch (e) { const ok = re.test(explainError(e)); if (!ok) fail++; console.log(ok ? "ok  " : "FAIL", l, "->", explainError(e)); } };
const base = (o: Partial<PersonIn>): PersonIn => ({ sex: "male", living: "living", status: "unverified", ...o });

const gf = savePerson(db, base({ nameBn: "আব্দুল জব্বার", nameEn: "Abdul Jabbar", living: "deceased", birth: { q: "about", y: 1938 }, death: { q: "exact", y: 2009, m: 3, d: 12 }, birthPlace: "রামপুর" }));
const gm = savePerson(db, base({ nameBn: "ফাতেমা খাতুন", sex: "female", living: "deceased", birth: { q: "about", y: 1942 } }));
const dad = savePerson(db, base({ nameBn: "করিম উদ্দিন", fatherId: gf, motherId: gm, birth: { q: "exact", y: 1965 }, occupation: "শিক্ষক", sourceTitle: "ভাইয়ের সাক্ষাৎকার", sourceKind: "elder_testimony", informant: "চাচা" }));
const mom = savePerson(db, base({ nameBn: "রহিমা বেগম", sex: "female" }));
const me = savePerson(db, base({ nameBn: "রাফি", fatherId: dad, motherId: mom, isMe: true, birth: { q: "exact", y: 1995, m: 5, d: 2 }, biography: "আমার জীবনী" }));
const wife = savePerson(db, base({ nameBn: "সুমি", sex: "female", spouseIds: [me] }));

const g = buildGraph(loadData(db));
eq("ego saved", getEgo(db), me);
eq("grandfather relation", relation(g, me, gf), "দাদা");
eq("wife relation", relation(g, me, wife), "স্ত্রী");
eq("ancestor count", ancestorCount(g, me), 4);
const pr = getProfile(db, dad)!;
eq("profile occupation", pr.occupation, "শিক্ষক");
eq("profile source", pr.sources[0]?.title, "ভাইয়ের সাক্ষাৎকার");
eq("profile father", pr.fatherId, gf);
eq("death date format", formatDate(getProfile(db, gf)!.death), "১২ মার্চ ২০০৯");
eq("about date format", formatDate(getProfile(db, gf)!.birth), "আনুমানিক ১৯৩৮");
eq("birthplace", getProfile(db, gf)!.birthPlace, "রামপুর");
eq("unknown date", formatDate(getProfile(db, mom)!.birth), "অজানা");
eq("spouse in profile", getProfile(db, me)!.spouseIds, [wife]);
// edit: change father, clear occupation
savePerson(db, { ...pr, id: dad, occupation: "", fatherId: null });
eq("father removed", getProfile(db, dad)!.fatherId, null);
eq("occupation cleared", getProfile(db, dad)!.occupation, "");
savePerson(db, { ...getProfile(db, dad)!, id: dad, fatherId: gf });
// guards
throws("cycle blocked", () => savePerson(db, { ...getProfile(db, gf)!, id: gf, fatherId: me }), /নিজেই নিজের পূর্বপুরুষ/);
throws("year required", () => savePerson(db, base({ nameBn: "X", birth: { q: "exact" } })), /বছর দিতে হবে/);
throws("no name", () => savePerson(db, base({})), /একটি নাম/);
throws("death before birth", () => savePerson(db, base({ nameBn: "Y", living: "deceased", birth: { q: "exact", y: 1990 }, death: { q: "exact", y: 1980 } })), /আগে হতে পারে না/);
throws("self parent", () => savePerson(db, { ...getProfile(db, me)!, id: me, fatherId: me }), /নিজের বাবা/);
// delete
deletePerson(db, wife);
eq("wife deleted", loadData(db).people.some((p) => p.id === wife), false);
eq("union gone", loadData(db).unions.length, 0);
deletePerson(db, me);
eq("ego cleared", getEgo(db), null);
const log = db.all<{ n: number }>("SELECT COUNT(*) AS n FROM change_log")[0].n;
eq("history recorded", log > 20, true);
eq("history actor", db.all<{ a: string }>("SELECT DISTINCT actor AS a FROM change_log")[0].a, "owner");
console.log(fail ? `${fail} FAILED` : "ALL PASSED");
process.exit(fail ? 1 : 0);
