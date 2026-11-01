/** Minimal, dependency-free ZIP (store method) + SHA-256. Plain ZIP so any tool can open it 100 years from now. */
const T = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
export function crc32(b: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = T[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export async function sha256Hex(b: Uint8Array): Promise<string> {
  const s = globalThis.crypto?.subtle;
  if (!s) throw new Error("এই পরিবেশে SHA-256 যাচাই চলে না (নিরাপদ সংযোগ দরকার)।");
  const h = new Uint8Array(await s.digest("SHA-256", b as BufferSource));
  return Array.from(h, (x) => x.toString(16).padStart(2, "0")).join("");
}

export interface ZipFile { name: string; data: Uint8Array }
const enc = new TextEncoder(), dec = new TextDecoder("utf-8");
const MAX_FILE = 200 * 1024 * 1024;

export function zipWrite(files: ZipFile[], when = new Date()): Uint8Array {
  const time = (when.getUTCHours() << 11) | (when.getUTCMinutes() << 5) | (when.getUTCSeconds() >> 1);
  const date = (Math.max(0, when.getUTCFullYear() - 1980) << 9) | ((when.getUTCMonth() + 1) << 5) | when.getUTCDate();
  const parts: Uint8Array[] = [], central: Uint8Array[] = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name), crc = crc32(f.data);
    const lh = new Uint8Array(30 + name.length), v = new DataView(lh.buffer);
    v.setUint32(0, 0x04034b50, true); v.setUint16(4, 20, true); v.setUint16(6, 0x0800, true); v.setUint16(8, 0, true);
    v.setUint16(10, time, true); v.setUint16(12, date, true); v.setUint32(14, crc, true);
    v.setUint32(18, f.data.length, true); v.setUint32(22, f.data.length, true); v.setUint16(26, name.length, true); v.setUint16(28, 0, true);
    lh.set(name, 30);
    const ch = new Uint8Array(46 + name.length), c = new DataView(ch.buffer);
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, 0, true);
    c.setUint16(12, time, true); c.setUint16(14, date, true); c.setUint32(16, crc, true);
    c.setUint32(20, f.data.length, true); c.setUint32(24, f.data.length, true); c.setUint16(28, name.length, true);
    c.setUint32(42, offset, true);
    ch.set(name, 46);
    parts.push(lh, f.data); central.push(ch);
    offset += lh.length + f.data.length;
  }
  const cdSize = central.reduce((n, x) => n + x.length, 0);
  const end = new Uint8Array(22), e = new DataView(end.buffer);
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true);
  e.setUint32(12, cdSize, true); e.setUint32(16, offset, true);
  const all = [...parts, ...central, end], out = new Uint8Array(all.reduce((n, x) => n + x.length, 0));
  let p = 0; for (const x of all) { out.set(x, p); p += x.length; }
  return out;
}

export const isZip = (b: Uint8Array) => b.length > 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 3 && b[3] === 4;

const BAD = "ZIP ফাইলটি নষ্ট বা অসম্পূর্ণ, পড়া যায়নি।";
/** Reads a ZIP fully in memory (never touches the disk, so path tricks are harmless). Supports store and deflate. */
export async function zipRead(b: Uint8Array): Promise<Map<string, Uint8Array>> {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 22 - 65535); i--) if (v.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error(BAD);
  const n = v.getUint16(eocd + 10, true), cdSize = v.getUint32(eocd + 12, true);
  let p = v.getUint32(eocd + 16, true);
  if (n > 20000 || p + cdSize > b.length) throw new Error(BAD);
  const out = new Map<string, Uint8Array>();
  for (let i = 0; i < n; i++) {
    if (p + 46 > b.length || v.getUint32(p, true) !== 0x02014b50) throw new Error(BAD);
    const flags = v.getUint16(p + 8, true), method = v.getUint16(p + 10, true), crc = v.getUint32(p + 16, true);
    const csize = v.getUint32(p + 20, true), usize = v.getUint32(p + 24, true);
    const nl = v.getUint16(p + 28, true), xl = v.getUint16(p + 30, true), cl = v.getUint16(p + 32, true), lho = v.getUint32(p + 42, true);
    const name = dec.decode(b.subarray(p + 46, p + 46 + nl));
    p += 46 + nl + xl + cl;
    if (name.endsWith("/")) continue;
    if (flags & 1) throw new Error("এনক্রিপ্টেড ZIP পড়া যায় না।");
    if (csize === 0xffffffff || usize === 0xffffffff || usize > MAX_FILE) throw new Error("ZIP-এর ফাইল খুব বড়।");
    if (lho + 30 > b.length || v.getUint32(lho, true) !== 0x04034b50) throw new Error(BAD);
    const start = lho + 30 + v.getUint16(lho + 26, true) + v.getUint16(lho + 28, true);
    if (start + csize > b.length) throw new Error(BAD);
    const raw = b.subarray(start, start + csize);
    let data: Uint8Array;
    if (method === 0) data = raw.slice();
    else if (method === 8) {
      if (typeof DecompressionStream === "undefined") throw new Error("এই পরিবেশে সংকুচিত ZIP খোলা যায় না।");
      data = new Uint8Array(await new Response(new Blob([raw as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate-raw"))).arrayBuffer());
    } else throw new Error("ZIP-এর সংকোচন পদ্ধতি চেনা যায়নি।");
    if (data.length !== usize || crc32(data) !== crc) throw new Error(`ZIP-এর ভেতরে "${name}" নষ্ট হয়ে গেছে।`);
    out.set(name, data);
  }
  return out;
}
