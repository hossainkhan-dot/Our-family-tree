import { CloudError } from "./errors";
import type { Fetch } from "./google";
import type { TokenSource } from "./session";

const API = "https://www.googleapis.com/drive/v3";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3";
export const FOLDER_MIME = "application/vnd.google-apps.folder";
const FIELDS = "id,name,version,size,md5Checksum,modifiedTime,createdTime,appProperties,mimeType";
export interface DriveFile { id: string; name: string; version?: string; size?: string; md5Checksum?: string; modifiedTime?: string; createdTime?: string; appProperties?: Record<string, string>; mimeType?: string }
const enc = new TextEncoder();
const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
const cat = (parts: Uint8Array[]) => { const o = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let i = 0; for (const p of parts) { o.set(p, i); i += p.length; } return o; };

export interface DriveOpts { sleep?: (ms: number) => Promise<void>; retries?: number }

/** Google Drive REST (v3) ক্লায়েন্ট: শুধু drive.file সীমার ভেতরে কাজ করে। 401 → একবার নতুন টোকেন, তারপর Revoked।
 *  429/5xx/নেটওয়ার্ক-ত্রুটিতে ক্রমবর্ধমান বিরতিতে আবার চেষ্টা। */
export class DriveClient {
  private sleep: (ms: number) => Promise<void>;
  private retries: number;
  private tok: TokenSource; private f: Fetch;
  constructor(tok: TokenSource, f: Fetch = fetch, o: DriveOpts = {}) {
    this.tok = tok; this.f = f;
    this.sleep = o.sleep ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms)));
    this.retries = o.retries ?? 3;
  }
  get email() { return this.tok.email; }

  private async call(url: string, init: RequestInit = {}): Promise<Response> {
    let reauthed = false;
    for (let attempt = 0; ; attempt++) {
      const token = await this.tok.get();
      let res: Response;
      try { res = await this.f(url, { ...init, headers: { ...(init.headers as Record<string, string> | undefined), Authorization: `Bearer ${token}` } }); }
      catch { if (attempt < this.retries) { await this.sleep(400 * 2 ** attempt); continue; } throw new CloudError("network", "ইন্টারনেট সংযোগ পাওয়া যায়নি।"); }
      if (res.ok) return res;
      if (res.status === 401) {
        if (!reauthed) { reauthed = true; this.tok.invalidate(); attempt--; continue; }
        throw new CloudError("revoked", "Google Drive-এর অনুমতি আর নেই। আবার অনুমতি দিন।", 401);
      }
      let reason = "";
      try { const j = (await res.clone().json()) as { error?: { errors?: { reason?: string }[]; message?: string } }; reason = j.error?.errors?.[0]?.reason ?? ""; } catch { /* no body */ }
      if (res.status === 403) {
        if (/rateLimit|quotaExceeded/i.test(reason)) { if (attempt < this.retries) { await this.sleep(800 * 2 ** attempt); continue; } throw new CloudError("quota", "Google Drive-এর সীমা পূর্ণ, কিছুক্ষণ পরে চেষ্টা করুন।", 403); }
        if (/storageQuotaExceeded/i.test(reason)) throw new CloudError("quota", "আপনার Google Drive-এ জায়গা নেই।", 403);
        throw new CloudError("forbidden", "এই ফাইল/ফোল্ডারে আপনার অনুমতি নেই।", 403);
      }
      if (res.status === 404) throw new CloudError("notfound", "Drive-এ ফাইলটি পাওয়া যায়নি।", 404);
      if (res.status === 429 || res.status >= 500) { if (attempt < this.retries) { await this.sleep(500 * 2 ** attempt); continue; } throw new CloudError("server", "Google Drive সাময়িকভাবে সাড়া দিচ্ছে না।", res.status); }
      throw new CloudError("server", `Drive ত্রুটি (${res.status})।`, res.status);
    }
  }

  async list(q: string): Promise<DriveFile[]> {
    const out: DriveFile[] = [];
    let page = "";
    do {
      const r = await this.call(`${API}/files?q=${encodeURIComponent(q)}&fields=${encodeURIComponent(`nextPageToken,files(${FIELDS})`)}&pageSize=200&orderBy=createdTime${page ? `&pageToken=${encodeURIComponent(page)}` : ""}`);
      const j = (await r.json()) as { files?: DriveFile[]; nextPageToken?: string };
      out.push(...(j.files ?? [])); page = j.nextPageToken ?? "";
    } while (page);
    return out;
  }
  async findFolders(name: string, parent?: string): Promise<DriveFile[]> {
    return this.list(`mimeType='${FOLDER_MIME}' and name='${esc(name)}' and trashed=false${parent ? ` and '${esc(parent)}' in parents` : ""}`);
  }
  /** একই নামে একাধিক হলে সবচেয়ে পুরোনোটি (দুই ফোনে একসঙ্গে তৈরি হলেও সবাই একই ফোল্ডার বেছে নেয়)। */
  async ensureFolder(name: string, parent?: string): Promise<string> {
    const have = await this.findFolders(name, parent);
    if (have.length) return have[0].id;
    const r = await this.call(`${API}/files?fields=id`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, mimeType: FOLDER_MIME, ...(parent ? { parents: [parent] } : {}) }) });
    const id = ((await r.json()) as { id: string }).id;
    const again = await this.findFolders(name, parent);
    return again.length ? again[0].id : id;
  }
  async children(parent: string, namePrefix?: string): Promise<DriveFile[]> {
    return this.list(`'${esc(parent)}' in parents and trashed=false and mimeType!='${FOLDER_MIME}'${namePrefix ? ` and name contains '${esc(namePrefix)}'` : ""}`);
  }
  async findFile(name: string, parent: string): Promise<DriveFile | null> {
    return (await this.list(`'${esc(parent)}' in parents and name='${esc(name)}' and trashed=false and mimeType!='${FOLDER_MIME}'`))[0] ?? null;
  }
  async meta(id: string): Promise<DriveFile> { return (await (await this.call(`${API}/files/${encodeURIComponent(id)}?fields=${encodeURIComponent(FIELDS)}`)).json()) as DriveFile; }
  async download(id: string): Promise<Uint8Array> { return new Uint8Array(await (await this.call(`${API}/files/${encodeURIComponent(id)}?alt=media`)).arrayBuffer()); }
  async remove(id: string): Promise<void> { await this.call(`${API}/files/${encodeURIComponent(id)}`, { method: "DELETE" }); }

  /** id দিলে ফাইল হালনাগাদ, না দিলে নতুন ফাইল। */
  async put(o: { name: string; parent?: string; bytes: Uint8Array; mime?: string; id?: string; props?: Record<string, string> }): Promise<DriveFile> {
    const boundary = `fla${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
    const metadata: Record<string, unknown> = { name: o.name, ...(o.props ? { appProperties: o.props } : {}) };
    if (!o.id && o.parent) metadata.parents = [o.parent];
    const body = cat([enc.encode(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: ${o.mime ?? "application/octet-stream"}\r\n\r\n`), o.bytes, enc.encode(`\r\n--${boundary}--`)]);
    const url = o.id ? `${UPLOAD}/files/${encodeURIComponent(o.id)}?uploadType=multipart&fields=${encodeURIComponent(FIELDS)}` : `${UPLOAD}/files?uploadType=multipart&fields=${encodeURIComponent(FIELDS)}`;
    const r = await this.call(url, { method: o.id ? "PATCH" : "POST", headers: { "Content-Type": `multipart/related; boundary=${boundary}` }, body: body as BodyInit });
    return (await r.json()) as DriveFile;
  }
  /** পরিবারের সদস্যের সঙ্গে ফোল্ডার শেয়ার (মালিকের অ্যাপ থেকে)। Drive-এ Editor হওয়া মানেই অ্যাপে Admin হওয়া নয়: অ্যাপের Role আলাদা ডেটাবেস নিয়মে বাধ্য। */
  async share(folderId: string, email: string, role: "reader" | "writer"): Promise<void> {
    await this.call(`${API}/files/${encodeURIComponent(folderId)}/permissions?sendNotificationEmail=false`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "user", role, emailAddress: email }) });
  }
}
