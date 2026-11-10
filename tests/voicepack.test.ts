import { INITIAL_SLOTS, addPack, addSlots, clearClip, clipCount, cleanSettings, deletePack, effectiveActive, emptyState, fillClips, moveCommand, removeCommand, renameCommand, renamePack, sanitize, serialize, setClip, setSettings, usedFiles, type Clip } from "../src/voice/model.ts";

let fail = 0;
const eq = (l: string, got: unknown, want: unknown) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) fail++; console.log(ok ? "ok  " : "FAIL", l, ok ? "" : `got=${JSON.stringify(got)} want=${JSON.stringify(want)}`); };
const throws = (l: string, fn: () => unknown, re: RegExp) => { try { fn(); fail++; console.log("FAIL", l, "(no error)"); } catch (e) { const ok = re.test(String((e as Error).message)); if (!ok) fail++; console.log(ok ? "ok  " : "FAIL", l, "->", (e as Error).message); } };
const clip = (n: string): Clip => ({ file: `a_${n}.mp3`, name: `${n}.mp3`, ms: 1200, bytes: 5000 });

let s = emptyState();
const a = addPack(s, "  PUBG   টিম  "); s = a.state;
eq("new pack has 12 empty slots, name cleaned", [s.packs[0].name, s.packs[0].commands.length, clipCount(s.packs[0])], ["PUBG টিম", INITIAL_SLOTS, 0]);
eq("default labels numbered in Bangla", [s.packs[0].commands[0].label, s.packs[0].commands[11].label], ["ভয়েস ১", "ভয়েস ১২"]);
throws("duplicate pack name refused (case-insensitive)", () => addPack(s, "pubg টিম"), /আরেকটি প্যাক/);
throws("empty name refused", () => addPack(s, "   "), /নাম লিখুন/);

const b = addPack(s, "Free Fire", 3); s = b.state;
eq("custom slot count", s.packs[1].commands.length, 3);

s = addSlots(s, a.id, 5);
eq("Add Voice has no limit (12+5, then 200 more)", [s.packs[0].commands.length, addSlots(s, a.id, 200).packs[0].commands.length], [17, 217]);

const c0 = s.packs[0].commands[0].id;
s = setClip(s, a.id, c0, clip("gg"));
eq("assigning audio names an unnamed button after the file", [s.packs[0].commands[0].label, s.packs[0].commands[0].clip?.file], ["gg", "a_gg.mp3"]);
s = renameCommand(s, a.id, c0, "  ভালো খেলা ");
s = setClip(s, a.id, c0, clip("new"));
eq("custom label kept when audio is replaced", [s.packs[0].commands[0].label, s.packs[0].commands[0].clip?.file], ["ভালো খেলা", "a_new.mp3"]);

s = fillClips(s, a.id, [clip("1"), clip("2"), clip("3")]);
eq("batch import fills empty buttons first", [s.packs[0].commands.length, clipCount(s.packs[0]), s.packs[0].commands[1].clip?.file], [17, 4, "a_1.mp3"]);
const many = Array.from({ length: 20 }, (_, i) => clip(`m${i}`));
const big = fillClips(s, b.id, many);
eq("batch import adds new buttons when slots run out", [big.packs[1].commands.length, clipCount(big.packs[1])], [20, 20]);

s = moveCommand(s, a.id, c0, 1);
eq("move down swaps neighbours", [s.packs[0].commands[1].id, s.packs[0].commands[0].id === c0], [c0, false]);
eq("move past the end does nothing", moveCommand(s, a.id, s.packs[0].commands[16].id, 1).packs[0].commands.length, 17);

s = clearClip(s, a.id, c0);
eq("clear audio keeps the button", [s.packs[0].commands.length, s.packs[0].commands[1].clip], [17, null]);
s = removeCommand(s, a.id, c0);
eq("remove button", s.packs[0].commands.length, 16);
throws("unknown pack", () => renamePack(s, "nope", "x"), /পাওয়া যায়নি/);
s = renamePack(s, a.id, "PUBG Mobile");
eq("rename pack", s.packs[0].name, "PUBG Mobile");
throws("rename onto another pack's name refused", () => renamePack(s, a.id, "free fire"), /আরেকটি প্যাক/);
eq("rename to its own name (different case) allowed", renamePack(s, a.id, "pubg mobile").packs[0].name, "pubg mobile");

eq("usedFiles lists each audio once", usedFiles(fillClips(s, b.id, [clip("1")])).sort(), ["a_1.mp3", "a_2.mp3", "a_3.mp3"]);
const gone = deletePack(s, a.id);
eq("deleting a pack frees its files for cleanup", [gone.packs.map((p) => p.name), usedFiles(gone)], [["Free Fire"], []]);

eq("active falls back to first pack, null when none", [effectiveActive(s, null), effectiveActive(s, "zzz"), effectiveActive(s, b.id), effectiveActive(emptyState(), "x")], [a.id, a.id, b.id, null]);

// persistence round trip (what is written to the phone and read back after a restart)
const back = sanitize(serialize(s));
eq("save → load round trip is identical", back, s);
eq("corrupt text gives an empty, usable state", [sanitize("{{not json").packs.length, sanitize(null).packs.length, sanitize("123").packs.length], [0, 0, 0]);
const hostile = sanitize({ packs: [{ id: "p1", name: "x", commands: [{ id: "c1", label: "a", clip: { file: "../../etc/passwd", name: "x" } }, { id: "c1", label: "dup" }, { id: "c2", label: "ok", clip: { file: "good.mp3", name: "good.mp3", ms: 5, bytes: 9 } }] }, { id: "p1", name: "dup" }, 5] });
eq("path tricks, duplicate ids and junk are dropped", [hostile.packs.length, hostile.packs[0].commands.length, hostile.packs[0].commands[0].clip, hostile.packs[0].commands[1].clip?.file], [1, 2, null, "good.mp3"]);

eq("settings clamp to safe ranges", cleanSettings({ holdMs: 99999, size: 1, opacity: 5, volume: -3, interrupt: "x" }), { holdMs: 3000, size: 40, opacity: 1, volume: 0, interrupt: true, speaker: true, outsideClose: true, autoClose: false });
eq("settings patch", setSettings(s, { holdMs: 2500, speaker: false }).settings.holdMs + "/" + setSettings(s, { speaker: false }).settings.speaker, "2500/false");

if (fail) { console.log(`\n${fail} FAILED`); process.exit(1); }
console.log("\nall voicepack tests passed");
