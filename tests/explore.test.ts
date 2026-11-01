import { savePerson, addSource, type PersonIn } from "../src/db/repo.ts";
import { addEvent, dashboard, places, project, searchAll, setPlaceCoords, timeline } from "../src/db/explore.ts";
import { mkDb } from "./fakes.ts";

let fail = 0;
const eq = (l: string, got: unknown, want: unknown) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) fail++; console.log(ok ? "ok  " : "FAIL", l, ok ? "" : `got=${JSON.stringify(got)} want=${JSON.stringify(want)}`); };
const throws = (l: string, fn: () => unknown, re: RegExp) => { try { fn(); fail++; console.log("FAIL", l, "(no error)"); } catch (e) { const ok = re.test(String((e as Error).message)); if (!ok) fail++; console.log(ok ? "ok  " : "FAIL", l, "->", (e as Error).message); } };
const base = (o: Partial<PersonIn>): PersonIn => ({ sex: "male", living: "living", status: "unverified", ...o });

const db = mkDb();
const dad = savePerson(db, base({ nameBn: "করিম উদ্দিন", nameEn: "Karim Uddin", nickname: "কেরু", sex: "male", living: "deceased", status: "verified",
  birth: { q: "exact", y: 1940, m: 3, d: 5 }, birthPlace: "বরিশাল", death: { q: "about", y: 2001 }, occupation: "শিক্ষক", biography: "তিনি গ্রামের স্কুলে ত্রিশ বছর পড়িয়েছেন।" }));
const me = savePerson(db, base({ nameBn: "রাফি হোসেন", fatherId: dad, isMe: true, birth: { q: "exact", y: 1990 }, birthPlace: "ঢাকা" }));
savePerson(db, base({ nameBn: "সালমা", sex: "female", birth: { q: "unknown" } }));
addSource(db, dad, "elder_testimony", "দাদির মুখে শোনা", "দাদি");

// অনুসন্ধান
eq("search by Bangla name", searchAll(db, "করিম").map((h) => h.title), ["করিম উদ্দিন"]);
eq("search by English name", searchAll(db, "karim")[0]?.personId, dad);
eq("search nickname says so", searchAll(db, "কেরু")[0]?.detail, "ডাকনাম: কেরু");
eq("search occupation", searchAll(db, "শিক্ষক").some((h) => h.detail.includes("পেশা")), true);
eq("search in biography text", searchAll(db, "স্কুলে").some((h) => h.kind === "note" && h.personId === dad), true);
eq("search place", searchAll(db, "বরিশাল").some((h) => h.kind === "place"), true);
eq("no match -> empty (nothing invented)", searchAll(db, "অমুক"), []);
eq("percent/underscore are literal", searchAll(db, "%"), []);
eq("empty query", searchAll(db, "  "), []);

// টাইমলাইন
const t = timeline(db);
eq("sorted by date, unknown last", t.map((r) => `${r.type}:${r.date.y ?? "?"}`), ["birth:1940", "birth:1990", "death:2001"]);
eq("person filter", timeline(db, { personId: me }).map((r) => r.type), ["birth"]);
eq("type filter", timeline(db, { type: "death" }).length, 1);
addEvent(db, { type: "migration", personId: dad, title: "ঢাকায় চলে আসেন", date: { q: "about", y: 1965 }, place: "ঢাকা" });
addEvent(db, { type: "family_history", title: "বাড়ির ভিত্তি", description: "পুরোনো বাড়ি", date: { q: "unknown" } });
const t2 = timeline(db);
eq("new event sorted between", t2.map((r) => r.date.y ?? null), [1940, 1965, 1990, 2001, null]);
eq("family history without person allowed", t2.at(-1)?.type, "family_history");
eq("event reuses existing place (no duplicate)", places(db).filter((p) => p.name === "ঢাকা").length, 1);
throws("person needed", () => addEvent(db, { type: "residence", date: { q: "unknown" } }), /সদস্য/);
throws("bad year", () => addEvent(db, { type: "residence", personId: me, date: { q: "exact", y: 0 } }), /সাল/);
throws("bad month", () => addEvent(db, { type: "residence", personId: me, date: { q: "exact", y: 2000, m: 13 } }), /মাস/);
const unk = addEvent(db, { type: "occupation", personId: me, title: "চাকরি", date: { q: "unknown", y: 1999, m: 2 } });
eq("unknown date never stores guessed numbers", db.all("SELECT d_y, d_m FROM event WHERE id = ?", [unk]), [{ d_y: null, d_m: null }]);

// মানচিত্র
const ps = places(db), dhaka = ps.find((p) => p.name === "ঢাকা")!, bar = ps.find((p) => p.name === "বরিশাল")!;
eq("place counts", [dhaka.events, dhaka.people], [2, 2]);
setPlaceCoords(db, dhaka.id, 23.8103, 90.4125); setPlaceCoords(db, bar.id, 22.701, 90.3535);
throws("lat out of range", () => setPlaceCoords(db, dhaka.id, 91, 10), /অক্ষাংশ/);
throws("one coordinate only", () => setPlaceCoords(db, dhaka.id, 10, null), /দুটোই/);
const pts = project([{ lat: 23.8103, lng: 90.4125 }, { lat: 22.701, lng: 90.3535 }], 300, 200);
eq("north is up (Dhaka above Barishal)", pts[0].y < pts[1].y, true);
eq("points inside canvas", pts.every((p) => p.x >= 0 && p.x <= 300 && p.y >= 0 && p.y <= 200), true);
eq("single point centred", project([{ lat: 1, lng: 2 }], 300, 200), [{ x: 150, y: 100 }]);

// ড্যাশবোর্ড
const d = dashboard(db);
eq("counts", [d.people, d.living, d.deceased, d.male, d.female], [3, 2, 1, 2, 1]);
eq("status split", d.byStatus, { verified: 1, unverified: 2, estimated: 0, unknown: 0 });
eq("quality gaps are listed honestly", [d.noBirth, d.noSource, d.deceasedNoDeath], [1, 2, 0]);
eq("places mapped", [d.places, d.placesMapped], [2, 2]);
eq("oldest year", d.oldestYear, 1940);
eq("recent changes present", d.recent.length > 0, true);

console.log(fail ? `\n${fail} FAILED` : "\nexplore tests passed");
process.exit(fail ? 1 : 0);
