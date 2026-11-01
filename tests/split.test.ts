import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { savePerson, type PersonIn } from "../src/db/repo.ts";
import { buildPackage, readPackage } from "../src/db/package.ts";
import { joinParts, parsePartsManifest, splitPackage, type Part } from "../src/db/split.ts";
import { mkDb } from "./fakes.ts";

let fail = 0;
const eq = (l: string, got: unknown, want: unknown) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) fail++; console.log(ok ? "ok  " : "FAIL", l, ok ? "" : `got=${JSON.stringify(got)} want=${JSON.stringify(want)}`); };
const rejects = async (l: string, fn: () => Promise<unknown>, re: RegExp) => { try { await fn(); fail++; console.log("FAIL", l, "(no error)"); } catch (e) { const ok = re.test(String((e as Error).message)); if (!ok) fail++; console.log(ok ? "ok  " : "FAIL", l, "->", (e as Error).message); } };

const bytes = new Uint8Array(300_000).map((_, i) => (i * 31 + (i >> 8)) & 255);
const K = 1024;
const none = await splitPackage("a.zip", bytes, 0);
eq("size 0 = one file, no manifest", [none.parts.length, none.manifest], [1, null]);
eq("bigger than file = one file", (await splitPackage("a.zip", bytes, 10 * K * K)).parts.length, 1);
await rejects("too small part refused", () => splitPackage("a.zip", bytes, 1000), /৬৪ কিলোবাইট/);

const sp = await splitPackage("a.zip", bytes, 100 * K);
eq("300000 bytes / 100KiB = 3 parts", sp.parts.map((p) => p.name), ["a.zip.001", "a.zip.002", "a.zip.003"]);
eq("every part within limit", sp.parts.every((p) => p.data.length <= 100 * K), true);
const man = parsePartsManifest(new TextDecoder().decode(sp.manifestFile!.data));
eq("join with manifest = original", Buffer.compare(Buffer.from(await joinParts(sp.parts, man)), Buffer.from(bytes)), 0);
eq("join without manifest = original (any order)", Buffer.compare(Buffer.from(await joinParts([sp.parts[2], sp.parts[0], sp.parts[1]])), Buffer.from(bytes)), 0);

// no app needed: plain `cat` joins it (the promise written in the manifest)
const d = mkdtempSync(join(tmpdir(), "split-"));
for (const p of sp.parts) writeFileSync(join(d, p.name), p.data);
execFileSync("bash", ["-c", `${man.join} 2>/dev/null; cat a.zip.[0-9][0-9][0-9] > a.zip`], { cwd: d });
eq("shell cat join = original", Buffer.compare(readFileSync(join(d, "a.zip")), Buffer.from(bytes)), 0);

await rejects("missing part named", () => joinParts([sp.parts[0], sp.parts[2]]), /2/);
await rejects("missing last part caught via manifest", () => joinParts([sp.parts[0], sp.parts[1]], man), /3/);
await rejects("duplicate part", () => joinParts([sp.parts[0], sp.parts[0], sp.parts[1]]), /দুবার/);
const bad: Part = { name: sp.parts[1].name, data: sp.parts[1].data.slice() }; bad.data[5] ^= 1;
await rejects("corrupt part caught", () => joinParts([sp.parts[0], bad, sp.parts[2]], man), /2 নম্বর অংশ/);
await rejects("no parts", () => joinParts([{ name: "x.txt", data: bytes }]), /কোনো অংশ/);
await rejects("foreign manifest", async () => parsePartsManifest('{"app":"other"}'), /অ্যাপের অংশ-তালিকা নয়/);

// the real thing: a backup package big enough to split, restored through readPackage
const db = mkDb();
const base = (o: Partial<PersonIn>): PersonIn => ({ sex: "male", living: "living", status: "unverified", ...o });
let seed = 7; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff).toString(36);
for (let i = 0; i < 60; i++) savePerson(db, base({ nameBn: `সদস্য ${i}`, biography: Array.from({ length: 400 }, rnd).join(" ") }));
const pkg = await buildPackage(db);
console.log("     package size", pkg.bytes.length);
const sp2 = await splitPackage(pkg.filename, pkg.bytes, 64 * K, pkg.at);
eq("real package splits into several parts", sp2.parts.length > 1, true);
const joined = await joinParts(sp2.parts, sp2.manifest);
const rp = await readPackage(joined);
eq("joined package passes its own SHA-256 checks", [rp.manifest.people, rp.checked], [60, 3]);

console.log(fail ? `\n${fail} FAILED` : "\nsplit tests passed");
process.exit(fail ? 1 : 0);
