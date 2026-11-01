import { sha256Hex } from "./zip";

/** ZIP আকার-ভাগ: বড় ব্যাকআপ ছোট ছোট অংশে ভাগ হয় (family-backup-DATE.zip.001, .002 ...).
 *  অংশগুলো সাধারণ বাইট-কাটা, তাই অ্যাপ ছাড়াও জোড়া যায়:  cat family-backup-DATE.zip.[0-9][0-9][0-9] > family-backup-DATE.zip */
export const PARTS_FORMAT = 1;
export const MIN_PART = 64 * 1024;
export const MAX_PARTS = 999;
const APP_NAME = "family-legacy-archive";

export interface Part { name: string; data: Uint8Array }
export interface PartsManifest {
  app: string; kind: "backup-parts"; format: number; base: string; created_at: string;
  total_size: number; total_sha256: string; part_size: number;
  parts: { name: string; size: number; sha256: string }[]; join: string;
}
export interface Split { parts: Part[]; manifest: PartsManifest | null; manifestFile: Part | null }

const enc = new TextEncoder(), dec = new TextDecoder("utf-8");
const pad = (n: number) => String(n).padStart(3, "0");
export const manifestName = (base: string) => `${base}.parts.json`;
export const partIndex = (name: string): number | null => { const m = /\.(\d{3})$/.exec(name); return m ? Number(m[1]) : null; };

/** maxBytes = 0 (বা ফাইলের চেয়ে বড়) হলে ভাগ হয় না, একটি ফাইলই থাকে। */
export async function splitPackage(base: string, bytes: Uint8Array, maxBytes: number, at = new Date().toISOString()): Promise<Split> {
  if (!maxBytes || maxBytes >= bytes.length) return { parts: [{ name: base, data: bytes }], manifest: null, manifestFile: null };
  if (maxBytes < MIN_PART) throw new Error("প্রতিটি অংশ অন্তত ৬৪ কিলোবাইট হতে হবে।");
  const n = Math.ceil(bytes.length / maxBytes);
  if (n > MAX_PARTS) throw new Error(`অংশ খুব বেশি হয়ে যাচ্ছে (${n}টি)। বড় আকার বেছে নিন।`);
  const parts: Part[] = [];
  for (let i = 0; i < n; i++) parts.push({ name: `${base}.${pad(i + 1)}`, data: bytes.subarray(i * maxBytes, Math.min(bytes.length, (i + 1) * maxBytes)) });
  const manifest: PartsManifest = {
    app: APP_NAME, kind: "backup-parts", format: PARTS_FORMAT, base, created_at: at, total_size: bytes.length, total_sha256: await sha256Hex(bytes), part_size: maxBytes,
    parts: await Promise.all(parts.map(async (p) => ({ name: p.name, size: p.data.length, sha256: await sha256Hex(p.data) }))),
    join: `cat ${base}.[0-9][0-9][0-9] > ${base}`,
  };
  return { parts, manifest, manifestFile: { name: manifestName(base), data: enc.encode(JSON.stringify(manifest, null, 2)) } };
}

export function parsePartsManifest(text: string): PartsManifest {
  let m: PartsManifest;
  try { m = JSON.parse(text.replace(/^﻿/, "")); } catch { throw new Error("অংশের তালিকা-ফাইল (.parts.json) পড়া যায়নি।"); }
  if (!m || m.app !== APP_NAME || m.kind !== "backup-parts" || !Array.isArray(m.parts)) throw new Error("এটি এই অ্যাপের অংশ-তালিকা নয়।");
  if (m.format > PARTS_FORMAT) throw new Error("এই অংশ-তালিকা অ্যাপের নতুন সংস্করণের, আগে অ্যাপ আপডেট করুন।");
  return m;
}

export const isPartName = (name: string) => partIndex(name) !== null;

/** অংশগুলো ক্রমানুসারে জোড়ে। কোনো অংশ না থাকলে, দুবার থাকলে বা বদলে গেলে বাংলায় কারণসহ ব্যর্থ হয়।
 *  পুরো ZIP-এর ভেতরের SHA-256 যাচাই পরে readPackage করে, তাই তালিকা-ফাইল না থাকলেও ক্ষতি ধরা পড়ে। */
export async function joinParts(files: Part[], manifest?: PartsManifest | null): Promise<Uint8Array> {
  const idx = new Map<number, Part>();
  for (const f of files) {
    const i = partIndex(f.name);
    if (i === null) continue;
    if (idx.has(i)) throw new Error(`${i} নম্বর অংশ দুবার দেওয়া হয়েছে।`);
    idx.set(i, f);
  }
  if (!idx.size) throw new Error("কোনো অংশ (.001, .002 ...) পাওয়া যায়নি।");
  const want = manifest ? manifest.parts.length : Math.max(...idx.keys());
  const missing: number[] = [];
  for (let i = 1; i <= want; i++) if (!idx.has(i)) missing.push(i);
  if (missing.length) throw new Error(`এই অংশগুলো নেই: ${missing.slice(0, 10).join(", ")}${missing.length > 10 ? " ..." : ""}। সব অংশ একসঙ্গে বেছে নিন।`);
  if (manifest) {
    for (let i = 0; i < manifest.parts.length; i++) {
      const info = manifest.parts[i], got = idx.get(i + 1)!;
      if (got.data.length !== info.size || (await sha256Hex(got.data)) !== info.sha256) throw new Error(`${i + 1} নম্বর অংশ নষ্ট বা বদলে গেছে (SHA-256 মেলেনি)।`);
    }
  }
  const out = new Uint8Array(Array.from(idx.values()).reduce((n, p) => n + p.data.length, 0));
  let p = 0;
  for (let i = 1; i <= want; i++) { const d = idx.get(i)!.data; out.set(d, p); p += d.length; }
  if (manifest && (out.length !== manifest.total_size || (await sha256Hex(out)) !== manifest.total_sha256)) throw new Error("জোড়া লাগানো ফাইলের SHA-256 মেলেনি। এই ব্যাকআপ ব্যবহার করা নিরাপদ নয়।");
  return out;
}

export const textOf = (b: Uint8Array) => dec.decode(b);
