import { uid } from "./repo";
import type { Sql } from "./sql";
import { sha256Hex } from "./zip";

/** ছবি/ডকুমেন্টের আসল বাইট ডেটাবেসের বাইরে রাখা হয় (নাম = SHA-256)। ডেটাবেসে শুধু বিবরণ ও সম্পর্ক থাকে। */
export interface MediaStore { get(sha: string): Promise<Uint8Array | null>; put(sha: string, bytes: Uint8Array): Promise<void>; has(sha: string): Promise<boolean> }
export const MAX_MEDIA = 25 * 1024 * 1024;
export interface MediaRow { id: string; kind: string; file_name: string; mime_type: string | null; byte_size: number | null; sha256: string; title: string | null; description: string | null; year: number | null; created_at: string }

const kindOf = (mime: string, name: string) =>
  mime.startsWith("image/") ? "photo" : mime.startsWith("video/") ? "video" : mime.startsWith("audio/") ? "audio" : /pdf|word|text/.test(mime) || /\.(pdf|docx?|txt)$/i.test(name) ? "document" : "other";

export interface MediaIn { name: string; mime: string; bytes: Uint8Array; title?: string; description?: string; year?: number | null; personIds: string[] }
/** একই ফাইল (SHA-256 মিললে) দ্বিতীয়বার জমা হয় না; শুধু নতুন সদস্যের সঙ্গে যুক্ত হয়। */
export async function addMedia(db: Sql, store: MediaStore, m: MediaIn, actor = "owner"): Promise<{ id: string; duplicate: boolean }> {
  if (!m.bytes.length) throw new Error("ফাইলটি খালি।");
  if (m.bytes.length > MAX_MEDIA) throw new Error("ফাইল খুব বড় (সর্বোচ্চ ২৫ MB)।");
  if (!m.personIds.length) throw new Error("অন্তত একজন সদস্য বেছে নিন।");
  const sha = await sha256Hex(m.bytes);
  const have = db.all<{ id: string }>("SELECT id FROM media WHERE sha256 = ? AND deleted_at IS NULL", [sha])[0];
  let id = have?.id;
  if (!id) {
    await store.put(sha, m.bytes);
    if (!(await store.has(sha))) throw new Error("ফাইল সংরক্ষণ করা যায়নি।");
    id = uid();
    db.run("INSERT INTO media (id, kind, file_name, mime_type, byte_size, sha256, storage_key, title, description, year, created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
      [id, kindOf(m.mime, m.name), m.name, m.mime || null, m.bytes.length, sha, `sha256/${sha}`, (m.title ?? "").trim() || null, (m.description ?? "").trim() || null, m.year ?? null, actor]);
  }
  for (const p of m.personIds) {
    if (db.all("SELECT 1 AS x FROM media_person WHERE media_id = ? AND person_id = ? AND deleted_at IS NULL", [id, p]).length) continue;
    db.run("INSERT INTO media_person (id, media_id, person_id, created_by) VALUES (?,?,?,?)", [uid(), id, p, actor]);
  }
  return { id, duplicate: !!have };
}
export const mediaFor = (db: Sql, personId: string): MediaRow[] => db.all<MediaRow>(
  `SELECT m.id, m.kind, m.file_name, m.mime_type, m.byte_size, m.sha256, m.title, m.description, m.year, m.created_at FROM media m JOIN media_person mp ON mp.media_id = m.id
   WHERE mp.person_id = ? AND mp.deleted_at IS NULL AND m.deleted_at IS NULL ORDER BY m.created_at`, [personId]);
export const allMedia = (db: Sql): MediaRow[] => db.all<MediaRow>("SELECT id, kind, file_name, mime_type, byte_size, sha256, title, description, year, created_at FROM media WHERE deleted_at IS NULL");
/** বাইট ফেরত দেয় শুধু যদি SHA-256 মেলে; নষ্ট হলে ত্রুটি। */
export async function readMedia(store: MediaStore, sha: string): Promise<Uint8Array | null> {
  const b = await store.get(sha);
  if (!b) return null;
  if ((await sha256Hex(b)) !== sha) throw new Error("ছবি/ফাইলটি নষ্ট হয়ে গেছে (SHA-256 মেলেনি)। ব্যাকআপ থেকে ফেরান।");
  return b;
}
/** মোছা = লুকানো (soft delete); আসল ফাইল ও History থেকে যায়। */
export function removeMediaFromPerson(db: Sql, mediaId: string, personId: string): void {
  db.run("UPDATE media_person SET deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE media_id = ? AND person_id = ? AND deleted_at IS NULL", [mediaId, personId]);
  if (!db.all("SELECT 1 AS x FROM media_person WHERE media_id = ? AND deleted_at IS NULL", [mediaId]).length)
    db.run("UPDATE media SET deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?", [mediaId]);
}
export const memoryStore = (): MediaStore & { map: Map<string, Uint8Array> } => {
  const map = new Map<string, Uint8Array>();
  return { map, get: async (s) => map.get(s) ?? null, put: async (s, b) => { map.set(s, b); }, has: async (s) => map.has(s) };
};
