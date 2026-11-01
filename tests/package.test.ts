import { DatabaseSync } from "node:sqlite";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { savePerson, loadData, type PersonIn } from "../src/db/repo.ts";
import { restoreInto } from "../src/db/backup.ts";
import { addLog, buildPackage, readLog, readPackage } from "../src/db/package.ts";
import { crc32, sha256Hex, zipRead, zipWrite } from "../src/db/zip.ts";
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
const rejects = async (l: string, fn: () => Promise<unknown>, re: RegExp) => { try { await fn(); fail++; console.log("FAIL", l, "(no error)"); } catch (e) { const ok = re.test(String((e as Error).message)); if (!ok) fail++; console.log(ok ? "ok  " : "FAIL", l, "->", (e as Error).message); } };
const base = (o: Partial<PersonIn>): PersonIn => ({ sex: "male", living: "living", status: "unverified", ...o });

const A = mk();
const dad = savePerson(A, base({ nameBn: "করিম উদ্দিন", nameEn: "Karim", birth: { q: "exact", y: 1960, m: 1, d: 2 }, biography: "প্রথম\nদ্বিতীয়" }));
savePerson(A, base({ nameBn: "রাফি", fatherId: dad, isMe: true }));

// zip primitives
eq("crc32 known value", crc32(new TextEncoder().encode("123456789")), 0xcbf43926);
eq("sha256 known value", await sha256Hex(new TextEncoder().encode("abc")), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
const z = await zipRead(zipWrite([{ name: "a.txt", data: new TextEncoder().encode("হ্যালো") }]));
eq("zip round trip (utf-8)", new TextDecoder().decode(z.get("a.txt")!), "হ্যালো");

// package build + verify + restore
const pkg = await buildPackage(A);
eq("filename", /^family-backup-\d{4}-\d{2}-\d{2}\.zip$/.test(pkg.filename), true);
const rp = await readPackage(pkg.bytes);
eq("3 files checked", rp.checked, 3);
eq("people in manifest", rp.manifest.people, 2);
const B = mk(); restoreInto(B, rp.backup);
eq("restored equals original", loadData(B), loadData(A));

// real-world interoperability: system unzip + sha256sum must accept it
try {
  const d = mkdtempSync(join(tmpdir(), "pkg-")); writeFileSync(join(d, "b.zip"), pkg.bytes);
  execFileSync("unzip", ["-tq", join(d, "b.zip")]);
  execFileSync("unzip", ["-qo", join(d, "b.zip"), "-d", join(d, "x")]);
  execFileSync("sha256sum", ["-c", "SHA256SUMS.txt"], { cwd: join(d, "x") });
  console.log("ok   system unzip + sha256sum -c accept the package");
} catch (e) { fail++; console.log("FAIL system tools", (e as Error).message); }

// tampering must be caught
const files = await zipRead(pkg.bytes);
const tamper = (name: string, f: (b: Uint8Array) => Uint8Array | null) => {
  const out = [...files].map(([n, d]) => ({ name: n, data: n === name ? f(d) : d })).filter((x) => x.data) as { name: string; data: Uint8Array }[];
  return zipWrite(out);
};
await rejects("edited data.json caught", () => readPackage(tamper("data.json", (d) => { const c = d.slice(); c[c.length - 3] ^= 1; return c; })), /SHA-256/);
await rejects("missing file caught", () => readPackage(tamper("family-tree.ged", () => null)), /নেই/);
await rejects("manifest missing", () => readPackage(tamper("manifest.json", () => null)), /manifest/);
const bad = pkg.bytes.slice(); bad[60] ^= 0xff;
await rejects("corrupted bytes caught", () => readPackage(bad), /নষ্ট|ZIP/);
await rejects("not a zip", () => readPackage(new TextEncoder().encode("hello world")), /ZIP ফাইল নয়/);
await rejects("truncated zip", () => readPackage(pkg.bytes.slice(0, pkg.bytes.length - 40)), /নষ্ট|অসম্পূর্ণ/);

// backup log
addLog(A, { at: pkg.at, kind: "zip", file: pkg.filename, sha256: pkg.sha256, people: pkg.people });
eq("log kept", readLog(A).map((e) => e.file), [pkg.filename]);
for (let i = 0; i < 60; i++) addLog(A, { at: pkg.at, kind: "json", file: `f${i}`, people: 2 });
eq("log capped at 50", readLog(A).length, 50);

console.log(fail ? `\n${fail} FAILED` : "\npackage tests passed");
process.exit(fail ? 1 : 0);
