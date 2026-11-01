import { savePerson, type PersonIn } from "../src/db/repo.ts";
import { addMedia, allMedia, mediaFor, memoryStore, readMedia, removeMediaFromPerson } from "../src/db/media.ts";
import { buildPackage, readPackage } from "../src/db/package.ts";
import { restoreInto } from "../src/db/backup.ts";
import { syncNow, type Ctx, type SyncState } from "../src/cloud/sync.ts";
import { TokenSource, type StoredSession } from "../src/cloud/session.ts";
import { DriveClient } from "../src/cloud/drive.ts";
import { DRIVE_SCOPE, getIdentity, pollDeviceFlow, startDeviceFlow, verifyDriveScope } from "../src/cloud/google.ts";
import { enterFamily } from "../src/cloud/sync.ts";
import { sha256Hex } from "../src/db/zip.ts";
import { FakeGoogle, mkDb, sleepNow } from "./fakes.ts";

let fail = 0;
const eq = (l: string, got: unknown, want: unknown) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) fail++; console.log(ok ? "ok  " : "FAIL", l, ok ? "" : `got=${JSON.stringify(got)} want=${JSON.stringify(want)}`); };
const rejects = async (l: string, fn: () => Promise<unknown>, re: RegExp) => { try { await fn(); fail++; console.log("FAIL", l, "(no error)"); } catch (e) { const ok = re.test(String((e as Error).message)); if (!ok) fail++; console.log(ok ? "ok  " : "FAIL", l, "->", (e as Error).message); } };
const base = (o: Partial<PersonIn>): PersonIn => ({ sex: "male", living: "living", status: "unverified", ...o });
const photo = (n: number) => new Uint8Array(5000).map((_, i) => (i * n + 7) & 255);

const db = mkDb(), st = memoryStore();
const a = savePerson(db, base({ nameBn: "করিম" })), b = savePerson(db, base({ nameBn: "রহিম" }));
const r1 = await addMedia(db, st, { name: "dada.jpg", mime: "image/jpeg", bytes: photo(3), title: "দাদা", year: 1975, personIds: [a] });
eq("added photo", [r1.duplicate, st.map.size, mediaFor(db, a).map((m) => m.title)], [false, 1, ["দাদা"]]);
const r2 = await addMedia(db, st, { name: "copy.jpg", mime: "image/jpeg", bytes: photo(3), personIds: [b] });
eq("same file again = no duplicate, linked to second person", [r2.duplicate, r2.id === r1.id, st.map.size, mediaFor(db, b).length], [true, true, 1, 1]);
eq("kind detected", mediaFor(db, a)[0].kind, "photo");
await rejects("empty refused", () => addMedia(db, st, { name: "x", mime: "image/png", bytes: new Uint8Array(), personIds: [a] }), /খালি/);
await rejects("too big refused", () => addMedia(db, st, { name: "x", mime: "video/mp4", bytes: new Uint8Array(26 * 1024 * 1024), personIds: [a] }), /বড়/);
await rejects("person needed", () => addMedia(db, st, { name: "x", mime: "image/png", bytes: photo(5), personIds: [] }), /সদস্য/);
const sha = mediaFor(db, a)[0].sha256;
eq("read verifies hash", (await readMedia(st, sha))!.length, 5000);
const bad = st.map.get(sha)!.slice(); bad[0] ^= 1; st.map.set(sha, bad);
await rejects("corrupted file detected on read", () => readMedia(st, sha), /নষ্ট/);
st.map.set(sha, photo(3));

// ব্যাকআপ ZIP-এ ছবি
const pkg = await buildPackage(db, st);
eq("package carries the photo", [pkg.media, pkg.mediaMissing], [1, 0]);
const rp = await readPackage(pkg.bytes);
eq("read back media", [rp.media.size, rp.media.has(sha), await sha256Hex(rp.media.get(sha)!)], [1, true, sha]);
const db2 = mkDb(); restoreInto(db2, rp.backup);
eq("restored rows point to same file", mediaFor(db2, b).map((m) => m.sha256), [sha]);
const st3 = memoryStore(); st3.map.delete(sha);
eq("missing bytes reported, not faked", (await buildPackage(db, st3)).mediaMissing, 1);
const noStore = await buildPackage(db);
eq("no store = old behaviour (3 files)", (await readPackage(noStore.bytes)).checked, 3);

// Drive সিঙ্কে ছবি
const G = new FakeGoogle(); G.addAccount("owner@gmail.com"); G.addAccount("mom@gmail.com");
const cfg = { clientId: "c", clientSecret: "s" }, f = G.fetch as typeof fetch;
async function login(email: string) {
  G.device.email = email;
  const dc = await startDeviceFlow(cfg, f), t = await pollDeviceFlow(cfg, dc, { fetch: f, sleep: sleepNow });
  await verifyDriveScope(t.accessToken, f); const id = await getIdentity(t.accessToken, f);
  const s: StoredSession = { email: id.email, sub: id.sub, name: id.name, refreshToken: t.refreshToken!, scopes: [DRIVE_SCOPE], connectedAt: "" };
  const tok = new TokenSource(cfg, s, f); tok.seed(t);
  return { id, drive: new DriveClient(tok, f, { sleep: sleepNow }) };
}
const store = () => { let s: SyncState | null = null; return { load: async () => s, save: async (x: SyncState) => { s = x; } }; };
const ownerDb = mkDb(), ownerMedia = memoryStore();
const pid = savePerson(ownerDb, base({ nameBn: "ফাতেমা" }));
await addMedia(ownerDb, ownerMedia, { name: "f.jpg", mime: "image/jpeg", bytes: photo(9), personIds: [pid] });
const O = await login("owner@gmail.com");
const octx: Ctx = { db: ownerDb, drive: O.drive, store: store(), device: "o", email: "owner@gmail.com", media: ownerMedia };
await enterFamily({ ...octx, sub: O.id.sub, name: "মালিক", mode: "create" });
const msha = allMedia(ownerDb)[0].sha256;
eq("photo uploaded to Photos/ by SHA-256 name", G.names().includes(msha), true);
const n = G.names().length; await syncNow(octx);
eq("no duplicate upload on repeat sync", G.names().length, n);

const { activateOnSignIn, inviteMember, currentMember } = await import("../src/db/access.ts");
inviteMember(ownerDb, currentMember(ownerDb), { email: "mom@gmail.com", role: "editor" });
await syncNow(octx);
const momDb = mkDb(), momMedia = memoryStore(), M = await login("mom@gmail.com");
const mctx: Ctx = { db: momDb, drive: M.drive, store: store(), device: "m", email: "mom@gmail.com", media: momMedia };
await enterFamily({ ...mctx, sub: M.id.sub, name: "মা", mode: "auto" });
await syncNow(mctx);
eq("new phone gets the photo bytes", [momMedia.map.has(msha), (await readMedia(momMedia, msha))!.length], [true, 5000]);
G.byName(msha)!.bytes[3] ^= 1; const momMedia2 = memoryStore();
await rejects("corrupted photo on Drive is not accepted", () => syncNow({ ...mctx, media: momMedia2 }), /নষ্ট/);
eq("nothing bad stored", momMedia2.map.size, 0);
void activateOnSignIn;

removeMediaFromPerson(ownerDb, allMedia(ownerDb)[0].id, pid);
eq("remove hides (soft) and keeps file", [allMedia(ownerDb).length, ownerMedia.map.has(msha)], [0, true]);

console.log(fail ? `\n${fail} FAILED` : "\nmedia tests passed");
process.exit(fail ? 1 : 0);
