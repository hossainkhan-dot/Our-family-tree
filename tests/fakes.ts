import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import type { Sql } from "../src/db/sql.ts";

/** পরীক্ষার ডেটাবেস (reset সহ, যেমন আসল অ্যাপে)। */
export function mkDb(): Sql {
  let raw: DatabaseSync;
  const init = () => {
    raw = new DatabaseSync(":memory:");
    raw.exec("PRAGMA foreign_keys = ON");
    raw.exec(readFileSync("src/db/migrations/001_core.sql", "utf8"));
    raw.exec(readFileSync("src/db/migrations/002_access.sql", "utf8"));
    raw.exec("CREATE TABLE IF NOT EXISTS schema_migration (version INTEGER PRIMARY KEY, name TEXT, applied_at TEXT); INSERT INTO schema_migration(version,name) VALUES (1,'core'),(2,'access')");
    raw.exec("INSERT OR REPLACE INTO app_context(key,value) VALUES('actor','owner')");
  };
  init();
  return {
    run: (s, p) => { if (p && p.length) raw.prepare(s).run(...(p as never[])); else raw.exec(s); },
    all: (s, p) => raw.prepare(s).all(...((p ?? []) as never[])) as never,
    reset: () => { raw.close(); init(); },
  };
}

interface FFile { id: string; name: string; mimeType: string; parents: string[]; bytes: Uint8Array; version: number; props: Record<string, string>; created: number; trashed: boolean }
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json" } });
const unq = (s: string) => s.replace(/\\'/g, "'").replace(/\\\\/g, "\\");

/** Google OAuth + Drive v3 এর নকল সার্ভার (শুধু পরীক্ষার জন্য: অ্যাপের কোড আসল HTTP অনুরোধই পাঠায়, এটি তার উত্তর দেয়)। */
export class FakeGoogle {
  files = new Map<string, FFile>();
  accounts = new Map<string, { sub: string; email: string; verified: boolean }>();
  tokens = new Map<string, string>();         // accessToken -> email
  refresh = new Map<string, string>();        // refreshToken -> email
  device = { state: "ok" as "ok" | "pending" | "denied" | "expired" | "slow", email: "owner@gmail.com", scopes: "openid email profile https://www.googleapis.com/auth/drive.file", pendingCount: 0 };
  revoked = new Set<string>();
  offline = false;
  fail403Once = 0; fail500Once = 0;
  calls: string[] = [];
  private n = 0;
  private nid = () => `id${++this.n}`;
  addAccount(email: string, verified = true) { this.accounts.set(email, { sub: `sub-${email}`, email, verified }); }
  expireAccessTokens() { this.tokens.clear(); }
  revokeRefresh(email: string) { for (const [r, e] of this.refresh) if (e === email) this.revoked.add(r); this.tokens.clear(); }
  names() { return [...this.files.values()].filter((f) => !f.trashed).map((f) => f.name); }
  byName(name: string) { return [...this.files.values()].find((f) => f.name === name && !f.trashed); }

  fetch = async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    if (this.offline) throw new TypeError("offline");
    const url = new URL(String(input)), method = (init.method ?? "GET").toUpperCase();
    this.calls.push(`${method} ${url.pathname}`);
    const h = (init.headers ?? {}) as Record<string, string>;
    const form = () => new URLSearchParams(String(init.body ?? ""));
    if (url.host === "oauth2.googleapis.com" && url.pathname === "/device/code") return json({ device_code: "dc1", user_code: "ABCD-EFGH", verification_url: "https://www.google.com/device", expires_in: 1800, interval: 1 });
    if (url.host === "oauth2.googleapis.com" && url.pathname === "/token") {
      const f = form();
      if (f.get("grant_type") === "refresh_token") {
        const r = f.get("refresh_token")!, email = this.refresh.get(r);
        if (!email || this.revoked.has(r)) return json({ error: "invalid_grant" }, 400);
        const t = `at${this.nid()}`; this.tokens.set(t, email);
        return json({ access_token: t, expires_in: 3600, scope: this.device.scopes });
      }
      const s = this.device.state;
      if (s === "pending" && this.device.pendingCount-- > 0) return json({ error: "authorization_pending" }, 428);
      if (s === "slow" && this.device.pendingCount-- > 0) return json({ error: "slow_down" }, 400);
      if (s === "denied") return json({ error: "access_denied" }, 403);
      if (s === "expired") return json({ error: "expired_token" }, 400);
      const t = `at${this.nid()}`, r = `rt${this.nid()}`;
      this.tokens.set(t, this.device.email); this.refresh.set(r, this.device.email);
      return json({ access_token: t, refresh_token: r, expires_in: 3600, scope: this.device.scopes });
    }
    if (url.host === "oauth2.googleapis.com" && url.pathname === "/tokeninfo") {
      const e = this.tokens.get(url.searchParams.get("access_token") ?? "");
      return e ? json({ scope: this.device.scopes, email: e }) : json({ error: "invalid_token" }, 400);
    }
    const auth = (h.Authorization ?? "").replace(/^Bearer /, ""), email = this.tokens.get(auth);
    if (url.host === "openidconnect.googleapis.com") {
      if (!email) return json({}, 401);
      const a = this.accounts.get(email)!;
      return json({ sub: a.sub, email: a.email, email_verified: a.verified, name: email.split("@")[0] });
    }
    if (url.host !== "www.googleapis.com") return json({ error: "unknown host" }, 404);
    if (!email) return json({ error: { message: "Invalid Credentials" } }, 401);
    if (this.fail403Once > 0) { this.fail403Once--; return json({ error: { errors: [{ reason: "userRateLimitExceeded" }] } }, 403); }
    if (this.fail500Once > 0) { this.fail500Once--; return json({ error: {} }, 503); }
    return this.drive(url, method, init, h);
  };

  private view(f: FFile) { return { id: f.id, name: f.name, version: String(f.version), size: String(f.bytes.length), md5Checksum: "x", modifiedTime: new Date(f.created + f.version).toISOString(), createdTime: new Date(f.created).toISOString(), appProperties: f.props, mimeType: f.mimeType }; }
  private match(f: FFile, q: string): boolean {
    for (const c of q.split(" and ")) {
      let m: RegExpExecArray | null;
      if ((m = /^mimeType='(.*)'$/.exec(c))) { if (f.mimeType !== unq(m[1])) return false; }
      else if ((m = /^mimeType!='(.*)'$/.exec(c))) { if (f.mimeType === unq(m[1])) return false; }
      else if ((m = /^name='(.*)'$/.exec(c))) { if (f.name !== unq(m[1])) return false; }
      else if ((m = /^name contains '(.*)'$/.exec(c))) { if (!f.name.includes(unq(m[1]))) return false; }
      else if ((m = /^'(.*)' in parents$/.exec(c))) { if (!f.parents.includes(unq(m[1]))) return false; }
      else if (c === "trashed=false") { if (f.trashed) return false; }
      else throw new Error(`fake drive: unsupported query part: ${c}`);
    }
    return true;
  }
  private async drive(url: URL, method: string, init: RequestInit, h: Record<string, string>): Promise<Response> {
    const p = url.pathname;
    if (p === "/drive/v3/files" && method === "GET") {
      const q = url.searchParams.get("q") ?? "";
      return json({ files: [...this.files.values()].filter((f) => this.match(f, q)).sort((a, b) => a.created - b.created).map((f) => this.view(f)) });
    }
    if (p === "/drive/v3/files" && method === "POST") {
      const b = JSON.parse(String(init.body)) as { name: string; mimeType: string; parents?: string[] };
      const f: FFile = { id: this.nid(), name: b.name, mimeType: b.mimeType, parents: b.parents ?? [], bytes: new Uint8Array(), version: 1, props: {}, created: Date.now() + this.n, trashed: false };
      this.files.set(f.id, f); return json(this.view(f));
    }
    let m = /^\/upload\/drive\/v3\/files(?:\/([^/]+))?$/.exec(p);
    if (m) {
      const ct = h["Content-Type"] ?? "", boundary = /boundary=(.+)$/.exec(ct)![1];
      const buf = Buffer.from(init.body as Uint8Array), sep = Buffer.from(`--${boundary}`);
      const a = buf.indexOf(sep), hdrEnd = buf.indexOf("\r\n\r\n", a) + 4, metaEnd = buf.indexOf(Buffer.from(`\r\n--${boundary}`), hdrEnd);
      const meta = JSON.parse(buf.subarray(hdrEnd, metaEnd).toString("utf8")) as { name?: string; parents?: string[]; appProperties?: Record<string, string> };
      const mh = buf.indexOf("\r\n\r\n", metaEnd) + 4, end = buf.lastIndexOf(Buffer.from(`\r\n--${boundary}--`));
      const bytes = new Uint8Array(buf.subarray(mh, end));
      if (m[1]) {
        const f = this.files.get(decodeURIComponent(m[1]));
        if (!f || f.trashed) return json({ error: {} }, 404);
        f.bytes = bytes; f.version++; if (meta.name) f.name = meta.name; if (meta.appProperties) f.props = meta.appProperties;
        return json(this.view(f));
      }
      const f: FFile = { id: this.nid(), name: meta.name!, mimeType: "application/octet-stream", parents: meta.parents ?? [], bytes, version: 1, props: meta.appProperties ?? {}, created: Date.now() + this.n, trashed: false };
      this.files.set(f.id, f); return json(this.view(f));
    }
    m = /^\/drive\/v3\/files\/([^/]+)\/permissions$/.exec(p);
    if (m && method === "POST") return json({ id: "perm" });
    m = /^\/drive\/v3\/files\/([^/]+)$/.exec(p);
    if (m) {
      const f = this.files.get(decodeURIComponent(m[1]));
      if (!f || f.trashed) return json({ error: {} }, 404);
      if (method === "DELETE") { this.files.delete(f.id); return new Response(null, { status: 204 }); }
      if (url.searchParams.get("alt") === "media") return new Response(f.bytes as BodyInit);
      return json(this.view(f));
    }
    return json({ error: "unhandled " + p }, 404);
  }
}

export const sleepNow = async () => undefined;
