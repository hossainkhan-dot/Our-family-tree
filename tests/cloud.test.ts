import { loadData, savePerson, type PersonIn } from "../src/db/repo.ts";
import { exportBackup } from "../src/db/backup.ts";
import * as A from "../src/db/access.ts";
import { readPackage } from "../src/db/package.ts";
import { CloudError, isOffline, needsReauth } from "../src/cloud/errors.ts";
import { DRIVE_SCOPE, getIdentity, pollDeviceFlow, startDeviceFlow, verifyDriveScope } from "../src/cloud/google.ts";
import { TokenSource, type StoredSession } from "../src/cloud/session.ts";
import { DriveClient } from "../src/cloud/drive.ts";
import { SUBFOLDERS, enterFamily, resolveConflict, syncNow, type Ctx, type SyncState } from "../src/cloud/sync.ts";
import { backupToDrive, fetchDriveBackup, listDriveBackups, retention } from "../src/cloud/driveBackup.ts";
import type { Sql } from "../src/db/sql.ts";
import { FakeGoogle, mkDb, sleepNow } from "./fakes.ts";

let fail = 0;
const eq = (l: string, got: unknown, want: unknown) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) fail++; console.log(ok ? "ok  " : "FAIL", l, ok ? "" : `got=${JSON.stringify(got)} want=${JSON.stringify(want)}`); };
const rejects = async (l: string, fn: () => Promise<unknown>, kind: string, re?: RegExp) => {
  try { await fn(); fail++; console.log("FAIL", l, "(no error)"); }
  catch (e) { const ok = e instanceof CloudError ? e.kind === kind && (!re || re.test(e.message)) : false; if (!ok) fail++; console.log(ok ? "ok  " : "FAIL", l, "->", e instanceof CloudError ? `[${e.kind}] ${e.message}` : String(e)); }
};
const base = (o: Partial<PersonIn>): PersonIn => ({ sex: "male", living: "living", status: "unverified", ...o });
const names = (db: Sql) => loadData(db).people.map((p) => p.name).sort();

const G = new FakeGoogle();
for (const e of ["owner@gmail.com", "mom@gmail.com", "stranger@gmail.com", "mirror@gmail.com"]) G.addAccount(e);
G.addAccount("fake@gmail.com", false);
const cfg = { clientId: "cid", clientSecret: "sec" };
const fetchF = G.fetch as typeof fetch;

/** পূর্ণ লগইন (ধাপ ২-৫): কোড চাওয়া → অনুমতির অপেক্ষা → Drive অনুমতি যাচাই → পরিচয় যাচাই */
async function login(email: string) {
  G.device.email = email;
  const dc = await startDeviceFlow(cfg, fetchF);
  const t = await pollDeviceFlow(cfg, dc, { fetch: fetchF, sleep: sleepNow });
  await verifyDriveScope(t.accessToken, fetchF);
  const id = await getIdentity(t.accessToken, fetchF);
  const s: StoredSession = { email: id.email, sub: id.sub, name: id.name, refreshToken: t.refreshToken!, scopes: t.scopes, connectedAt: new Date().toISOString() };
  const tok = new TokenSource(cfg, s, fetchF);
  tok.seed(t);
  return { id, tok, drive: new DriveClient(tok, fetchF, { sleep: sleepNow }) };
}
const mkStore = () => { let s: SyncState | null = null; return { load: async () => s, save: async (x: SyncState) => { s = x; }, peek: () => s }; };

// ───────── ধাপ ২–৫: Google লগইন ও Drive অনুমতি
{
  const dc = await startDeviceFlow(cfg, fetchF);
  eq("device code shown to user", [dc.userCode, dc.verificationUrl], ["ABCD-EFGH", "https://www.google.com/device"]);
  await rejects("missing client id refused", () => startDeviceFlow({ clientId: "", clientSecret: "" }, fetchF), "config");
  G.device.state = "pending"; G.device.pendingCount = 2;
  const t = await pollDeviceFlow(cfg, dc, { fetch: fetchF, sleep: sleepNow });
  eq("waits while user has not approved, then gets token", [!!t.accessToken, !!t.refreshToken, t.scopes.includes(DRIVE_SCOPE)], [true, true, true]);
  G.device.state = "slow"; G.device.pendingCount = 1;
  const sleeps: number[] = [];
  await pollDeviceFlow(cfg, dc, { fetch: fetchF, sleep: async (ms) => { sleeps.push(ms); } });
  eq("slow_down raises the polling interval", sleeps, [1000, 6000]);
  G.device.state = "denied";
  await rejects("user denies permission -> no entry", () => pollDeviceFlow(cfg, dc, { fetch: fetchF, sleep: sleepNow }), "denied");
  G.device.state = "expired";
  await rejects("code expired", () => pollDeviceFlow(cfg, dc, { fetch: fetchF, sleep: sleepNow }), "expired");
  let clock = 0;
  G.device.state = "pending"; G.device.pendingCount = 1e9;
  await rejects("gives up after the code's lifetime", () => pollDeviceFlow(cfg, { ...dc, expiresIn: 10 }, { fetch: fetchF, sleep: async (ms) => { clock += ms; }, now: () => clock }), "expired");
  G.device.state = "ok";

  // user unticks the Drive box on Google's screen: must be caught (step 5), not assumed
  G.device.email = "owner@gmail.com";
  G.device.scopes = "openid email profile";
  const t2 = await pollDeviceFlow(cfg, dc, { fetch: fetchF, sleep: sleepNow });
  await rejects("Drive permission not granted -> refused", () => verifyDriveScope(t2.accessToken, fetchF), "scope", /Drive/);
  eq("scope error forces a new permission request", needsReauth(new CloudError("scope", "x")), true);
  G.device.scopes = "openid email profile " + DRIVE_SCOPE;
  await rejects("unverified Gmail refused", async () => { G.tokens.set("tk-fake", "fake@gmail.com"); await getIdentity("tk-fake", fetchF); }, "denied");
  await rejects("bad token = revoked", () => getIdentity("garbage", fetchF), "revoked");
}

// ───────── মালিকের ফোন: নতুন পরিবার শুরু → Drive-এ কাঠামো
const ownerDb = mkDb(), ownerStore = mkStore();
const O = await login("owner@gmail.com");
const octx = (over: Partial<Ctx> = {}): Ctx => ({ db: ownerDb, drive: O.drive, store: ownerStore, device: "phone-owner", email: "owner@gmail.com", ...over });
savePerson(ownerDb, base({ nameBn: "করিম উদ্দিন", biography: "প্রথম" }));
await rejects("no family on Drive and not creating -> told what to do", () => enterFamily({ ...octx(), db: mkDb(), sub: O.id.sub, name: "x", mode: "auto" }), "notfound");
const created = await enterFamily({ ...octx(), sub: O.id.sub, name: "মালিক", mode: "create" });
eq("owner created the family", [created.how, created.member.role, created.member.status], ["created", "owner", "active"]);
eq("Drive folders per spec", SUBFOLDERS.every((s) => G.names().includes(s)) && G.names().includes("Our_Family_Archive"), true);
eq("manifest, members, approvals written", ["FamilyManifest.json", "members.json", "approvals.json"].every((n) => G.names().includes(n)), true);
eq("immutable tree file for revision 1", G.names().some((n) => /^tree-r000001-phone-owner\.json$/.test(n)), true);
const man1 = JSON.parse(new TextDecoder().decode(G.byName("FamilyManifest.json")!.bytes));
eq("manifest revision & author", [man1.revision, man1.written_by], [1, "owner@gmail.com"]);

const n0 = G.names().length;
eq("sync with no change = up to date, no new files", [(await syncNow(octx())).status, G.names().length], ["uptodate", n0]);

// সদস্য আমন্ত্রণ: মালিকের ফোনে তালিকায় যোগ হয়, সিঙ্কে Drive-এ যায়
const ownerM = created.member;
A.inviteMember(ownerDb, ownerM, { email: "mom@gmail.com", name: "মা", role: "editor" });
await O.drive.share((await O.drive.findFolders("Our_Family_Archive"))[0].id, "mom@gmail.com", "writer");
const r2 = await syncNow(octx());
eq("local change pushed as revision 2", [r2.status, (r2 as { revision: number }).revision], ["pushed", 2]);
eq("old revision kept (never overwritten)", G.names().filter((n) => n.startsWith("tree-r")).length, 2);
eq("activity log uploaded", G.names().some((n) => n.startsWith("log-r000002")), true);

// ───────── নতুন ফোন
const momDb = mkDb(), momStore = mkStore();
const M = await login("mom@gmail.com");
const mctx = (over: Partial<Ctx> = {}): Ctx => ({ db: momDb, drive: M.drive, store: momStore, device: "phone-mom", email: "mom@gmail.com", ...over });
const joined = await enterFamily({ ...mctx(), sub: M.id.sub, name: "মা", mode: "auto" });
eq("new phone: family restored automatically after login", [joined.how, names(momDb), joined.member.email, joined.member.status], ["joined", ["করিম উদ্দিন"], "mom@gmail.com", "active"]);

// সদস্য নয় এমন Gmail: তথ্য ফোনে নামেই না
const strangerDb = mkDb();
const S = await login("stranger@gmail.com");
await rejects("Google login alone does not make a member", () => enterFamily({ ...octx(), db: strangerDb, drive: S.drive, store: mkStore(), email: "stranger@gmail.com", sub: S.id.sub, name: "s", mode: "auto" }), "membership", /তালিকায় নেই/);
eq("stranger's phone received NO family data", [names(strangerDb), strangerDb.all("SELECT 1 AS x FROM member").length], [[], 0]);

// ───────── দ্বন্দ্ব: দুই ফোনে অফলাইনে আলাদা পরিবর্তন
const momMember = A.currentMember(momDb)!;
savePerson(ownerDb, base({ nameBn: "রহিমা (মালিকের ফোনে)" }));
await syncNow(octx());                                   // owner → revision 3
const reqMom = A.submitChange(momDb, momMember, { kind: "save_person", input: base({ nameBn: "জামাল (মায়ের ফোনে)" }) });
eq("editor's change stays pending (needs approvals)", reqMom.applied, false);
savePerson(momDb, base({ nameBn: "স্থানীয়-১ (মায়ের ফোনে)" }));
const rc = await syncNow(mctx());
eq("both changed -> conflict reported, nothing overwritten", [rc.status, names(momDb).includes("করিম উদ্দিন")], ["conflict", true]);
eq("conflict remembered in state", !!momStore.peek()?.conflict, true);
eq("Drive head untouched by the conflicting phone", JSON.parse(new TextDecoder().decode(G.byName("FamilyManifest.json")!.bytes)).revision, 3);

const before = G.names().length;
const resTheirs = await resolveConflict(mctx({ beforeReplace: async () => undefined }), "theirs");
eq("choose Drive's version: phone gets it", [resTheirs.status, names(momDb).includes("রহিমা (মালিকের ফোনে)")], ["pulled", true]);
eq("the discarded local copy was saved to Drive first", G.names().filter((n) => n.startsWith("local-before-pull")).length, 1);
eq("no data files lost", G.names().length > before, true);

// আবার দ্বন্দ্ব, এবার "আমারটা রাখি"
savePerson(momDb, base({ nameBn: "স্থানীয়-২ (মায়ের ফোনে)" }));
savePerson(ownerDb, base({ nameBn: "সালমা" }));
await syncNow(octx());                                   // owner → revision 4
eq("second conflict", (await syncNow(mctx())).status, "conflict");
const resMine = await resolveConflict(mctx(), "mine");
eq("choose mine: pushed on top, older revisions stay", [resMine.status, (resMine as { revision: number }).revision, G.names().filter((n) => n.startsWith("tree-r")).length >= 5], ["pushed", 5, true]);

// অন্য দিকের পরিবর্তন সরাসরি নামে (দ্বন্দ্ব ছাড়া)
await syncNow(octx());                                   // owner has local = revision 4 base; remote is 5 -> pull
eq("owner pulls newer remote when it has no local changes", names(ownerDb).includes("স্থানীয়-২ (মায়ের ফোনে)"), true);
const r4 = G.byName("tree-r000004-phone-owner.json")!;
eq("the version the owner's phone lost in 'mine' is still on Drive (revision 4)", new TextDecoder().decode(r4.bytes).includes("সালমা"), true);
const nfiles = G.names().length;
await syncNow(octx()); await syncNow(octx());
eq("repeat sync does not create duplicates", G.names().length, nfiles);

// ───────── নেটওয়ার্ক, টোকেন, অনুমতি প্রত্যাহার
G.offline = true;
await rejects("offline -> network error (app keeps local copy, retries later)", () => syncNow(octx()), "network");
eq("offline classified as retryable, not as lost permission", [isOffline(new CloudError("network", "x")), needsReauth(new CloudError("network", "x"))], [true, false]);
G.offline = false;
G.expireAccessTokens();
savePerson(ownerDb, base({ nameBn: "টোকেন-পরীক্ষা" }));
eq("expired access token refreshed silently", (await syncNow(octx())).status, "pushed");
G.fail403Once = 2; G.fail500Once = 1;
savePerson(ownerDb, base({ nameBn: "রেট-লিমিট" }));
eq("rate limit / 503 retried with back-off", (await syncNow(octx())).status, "pushed");

let revokedCalled = 0;
const s2: StoredSession = { email: "owner@gmail.com", sub: O.id.sub, name: null, refreshToken: [...G.refresh].find(([, e]) => e === "owner@gmail.com")![0], scopes: [], connectedAt: "" };
const tok2 = new TokenSource(cfg, s2, fetchF, Date.now, () => { revokedCalled++; });
G.revokeRefresh("owner@gmail.com");
await rejects("permission revoked in Google settings -> protected op blocked", () => new DriveClient(tok2, fetchF, { sleep: sleepNow }).list("trashed=false"), "revoked");
eq("revocation triggers re-authorisation flow", [revokedCalled > 0, needsReauth(new CloudError("revoked", "x"))], [true, true]);
await rejects("checkPermission also reports revoked", () => tok2.checkPermission(), "revoked");

// ───────── Drive-এ ব্যাকআপ (আকার-ভাগসহ), যাচাই, ফেরানো
const O2 = await login("owner@gmail.com");
for (let i = 0; i < 70; i++) savePerson(ownerDb, base({ nameBn: `বড় ${i}`, biography: Array.from({ length: 300 }, (_, k) => `শব্দ${i * k}`).join(" ") }));
const whole = await backupToDrive(ownerDb, O2.drive, { partMb: 0, today: "2026-11-01" });
eq("backup without split = one zip in Backups/", [whole.files.length, whole.files[0].endsWith(".zip")], [1, true]);
const split = await backupToDrive(ownerDb, O2.drive, { partMb: 0.0625, today: "2026-11-01" });   // 64 KiB per part
eq("same day re-backup with split replaces the single file", [split.files.length > 2, split.files.at(-1)!.endsWith(".parts.json")], [true, true]);
eq("no leftover single zip next to parts", G.names().filter((n) => n === split.base).length, 0);
const list = await listDriveBackups(O2.drive);
eq("backup list shows parts", [list[0].base, list[0].parts > 1], [split.base, true]);
const zipBytes = await fetchDriveBackup(O2.drive, split.base);
const pk = await readPackage(zipBytes);
eq("downloaded & joined backup verifies and has all people", pk.manifest.people, loadData(ownerDb).people.length);
const part2 = G.byName(`${split.base}.002`)!; part2.bytes[10] ^= 1;
let caught = ""; try { await fetchDriveBackup(O2.drive, split.base); } catch (e) { caught = (e as Error).message; }
eq("corruption message", /SHA-256/.test(caught), true);

// দ্বিতীয় Drive অ্যাকাউন্টে কপি
const MIR = await login("mirror@gmail.com");
const mir = await backupToDrive(ownerDb, MIR.drive, { partMb: 0, kind: "mirror", rootName: "Our_Family_Archive_Mirror", today: "2026-11-01" });
const mlist = await listDriveBackups(MIR.drive, "Our_Family_Archive_Mirror");
eq("mirror account holds its own verified copy", [mlist.length, mlist[0].base === mir.base], [1, true]);
eq("mirror got only Backups (no family live data)", G.names().filter((n) => n === "FamilyManifest.json").length, 1);

// পুরোনো ব্যাকআপ রাখার নিয়ম
const r = retention(["family-backup-2026-10-30.zip", "family-backup-2026-10-01.zip", "family-backup-2026-08-03.zip", "family-backup-2026-08-20.zip", "family-backup-2026-08-21.zip", "family-backup-2025-01-05.zip", "mystery.zip"], "2026-11-01", 30);
eq("retention: recent all, then one per month, unknown names never dropped", r, { keep: ["family-backup-2026-10-30.zip", "family-backup-2026-10-01.zip", "family-backup-2026-08-21.zip", "family-backup-2025-01-05.zip", "mystery.zip"], drop: ["family-backup-2026-08-03.zip", "family-backup-2026-08-20.zip"] });
// ডেটা অক্ষত
eq("export still equals local data", exportBackup(ownerDb).counts.person, loadData(ownerDb).people.length);

console.log(fail ? `\n${fail} FAILED` : "\ncloud tests passed");
process.exit(fail ? 1 : 0);
