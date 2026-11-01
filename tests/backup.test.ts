import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { savePerson, loadData, getEgo, getProfile, type PersonIn } from "../src/db/repo.ts";
import { exportBackup, parseBackup, restoreInto, serializeBackup } from "../src/db/backup.ts";
import { exportGedcom, importGedcom, parseGedDate } from "../src/db/gedcom.ts";
import { buildGraph, relation, findDuplicates } from "../src/core/relations.ts";
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

const A = mk();
const gf = savePerson(A, base({ nameBn: "আব্দুল জব্বার", nameEn: "Abdul Jabbar", nickname: "জব্বার", living: "deceased", birth: { q: "about", y: 1938 }, death: { q: "exact", y: 2009, m: 3, d: 12 }, birthPlace: "রামপুর", sourceTitle: "দাদার সনদ", informant: "চাচা" }));
const gm = savePerson(A, base({ nameBn: "ফাতেমা খাতুন", sex: "female", living: "deceased", spouseIds: [gf] }));
const dad = savePerson(A, base({ nameBn: "করিম উদ্দিন", fatherId: gf, motherId: gm, occupation: "শিক্ষক", biography: "প্রথম লাইন\nদ্বিতীয় লাইন" }));
const kid = savePerson(A, base({ nameBn: "দত্তক সন্তান", fatherId: dad, parentKind: "adoptive", sex: "female" }));
const me = savePerson(A, base({ nameBn: "রাফি", fatherId: dad, isMe: true, birth: { q: "exact", y: 1995, m: 5, d: 2 } }));

// ---- JSON backup / restore ----
const b = exportBackup(A);
const text = serializeBackup(b);
const B = mk();
restoreInto(B, parseBackup(text));
eq("people restored", loadData(B), loadData(A));
eq("ego restored", getEgo(B), me);
eq("history restored", B.all<{ n: number }>("SELECT COUNT(*) AS n FROM change_log")[0].n, A.all<{ n: number }>("SELECT COUNT(*) AS n FROM change_log")[0].n);
eq("profile restored", getProfile(B, gf), getProfile(A, gf));
savePerson(B, base({ nameBn: "নতুন" }));
eq("history still logging after restore", B.all<{ n: number }>("SELECT COUNT(*) AS n FROM change_log")[0].n > b.counts.change_log, true);
throws("cannot restore into non-empty db", () => restoreInto(B, parseBackup(text)), /খালি নয়/);
throws("wrong app", () => parseBackup('{"app":"other"}'), /এই অ্যাপের/);
throws("garbage", () => parseBackup("hello"), /বৈধ/);
const evil = parseBackup(text); (evil.tables.person[0] as Record<string, unknown>)["id) VALUES (1); DROP TABLE person; --"] = "x";
throws("malicious column rejected", () => restoreInto(mk(), evil), /অচেনা/);
const broken = parseBackup(text); broken.tables.person_name[0].person_id = "ghost";
const C = mk(); throws("broken references rejected", () => restoreInto(C, broken), /অসামঞ্জস্য/);
eq("failed restore leaves db empty", C.all("SELECT 1 FROM person").length, 0);
const newer = parseBackup(text); newer.schema = 99;
throws("newer schema refused", () => restoreInto(mk(), newer), /আপডেট/);

// ---- GEDCOM round trip ----
const ged = exportGedcom(A);
eq("gedcom has header+trailer", ged.startsWith("0 HEAD") && ged.trimEnd().endsWith("0 TRLR"), true);
eq("gedcom keeps multiline note", ged.includes("2 CONT দ্বিতীয় লাইন"), true);
const D = mk();
const r = importGedcom(D, ged, "test.ged");
const gD = buildGraph(loadData(D));
const find = (n: string) => loadData(D).people.find((p) => p.name === n)!.id;
eq("imported people", r.people, 5);
eq("imported no warnings", r.warnings, []);
eq("round trip: grandfather", relation(gD, find("রাফি"), find("আব্দুল জব্বার")), "দাদা");
eq("round trip: adoptive kind", D.all<{ kind: string }>("SELECT kind FROM parent_child WHERE child_id = ?", [find("দত্তক সন্তান")])[0].kind, "adoptive");
eq("round trip: spouse", relation(gD, find("আব্দুল জব্বার"), find("ফাতেমা খাতুন")), "স্ত্রী");
eq("round trip: dates", getProfile(D, find("আব্দুল জব্বার"))!.death, { q: "exact", y: 2009, m: 3, d: 12 });
eq("round trip: about", getProfile(D, find("আব্দুল জব্বার"))!.birth, { q: "about", y: 1938, m: null, d: null });
eq("round trip: english name", getProfile(D, find("আব্দুল জব্বার"))!.nameEn, "Abdul Jabbar");
eq("round trip: bio", getProfile(D, find("করিম উদ্দিন"))!.biography, "প্রথম লাইন\nদ্বিতীয় লাইন");
eq("round trip: source", getProfile(D, find("আব্দুল জব্বার"))!.sources.some((s) => s.title === "দাদার সনদ"), true);

// ---- foreign GEDCOM (typical 5.5.1 file from another program) ----
const foreign = `0 HEAD
1 CHAR UTF-8
0 @I1@ INDI
1 NAME John /Smith/
1 SEX M
1 BIRT
2 DATE BET 1900 AND 1905
1 DEAT
2 DATE BEF 1960
1 FAMS @F1@
0 @I2@ INDI
1 NAME Mary /Jones/
1 SEX F
1 BIRT
2 DATE 12 MAR 1905
2 PLAC Dhaka, Bangladesh
1 FAMS @F1@
0 @I3@ INDI
1 NAME Tom /Smith/
1 SEX M
1 NOTE Very long note that continues
2 CONC  on the same line
2 CONT and a new line
1 FAMC @F1@
2 PEDI adopted
0 @I4@ INDI
1 NAME Broken /Dates/
1 BIRT
2 DATE sometime in spring
0 @F1@ FAM
1 HUSB @I1@
1 WIFE @I2@
1 CHIL @I3@
0 TRLR
`;
const E = mk();
const r2 = importGedcom(E, foreign, "other.ged");
eq("foreign people", r2.people, 4);
eq("foreign families", r2.families, 1);
eq("unreadable date warned", r2.warnings.some((w) => w.includes("sometime in spring")), true);
const tom = loadData(E).people.find((p) => p.name === "Tom Smith")!;
eq("CONC/CONT merged", getProfile(E, tom.id)!.biography, "Very long note that continues on the same line\nand a new line");
eq("foreign adopted", E.all<{ kind: string; parent_role: string }>("SELECT kind, parent_role FROM parent_child ORDER BY parent_role").map((x) => `${x.kind}:${x.parent_role}`), ["adoptive:father", "adoptive:mother"]);
eq("BET date is estimated", getProfile(E, loadData(E).people.find((p) => p.name === "John Smith")!.id)!.status, "estimated");
eq("date parse", parseGedDate("ABT 1938")?.d, { q: "about", y: 1938, m: null, d: null });
eq("dup check after import", findDuplicates(loadData(E).people), []);
console.log(fail ? `${fail} FAILED` : "ALL PASSED");
process.exit(fail ? 1 : 0);
