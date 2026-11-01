import { CloudError } from "./errors";

/** Google OAuth 2.0 "Device flow" (TV/limited-input client): কোনো প্লাগইন বা রিডাইরেক্ট লাগে না।
 *  ব্যবহারকারী Google-এর আসল অনুমতি-পর্দা google.com/device-এ দেখেন, তাই অ্যাপের নিজের পপআপ দিয়ে "অনুমতি পাওয়া গেছে" ধরে নেওয়া হয় না। */
export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
export const SCOPES = ["openid", "email", "profile", DRIVE_SCOPE];
const DEVICE_URL = "https://oauth2.googleapis.com/device/code";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";
const TOKENINFO_URL = "https://oauth2.googleapis.com/tokeninfo";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";

export type Fetch = typeof fetch;
export interface GoogleConfig { clientId: string; clientSecret: string }
export interface DeviceCode { deviceCode: string; userCode: string; verificationUrl: string; expiresIn: number; interval: number }
export interface Tokens { accessToken: string; refreshToken?: string; expiresAt: number; scopes: string[] }
export interface Identity { sub: string; email: string; name: string | null }

const form = (o: Record<string, string>) => ({ method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(o).toString() });
async function post(f: Fetch, url: string, o: Record<string, string>): Promise<{ status: number; json: Record<string, unknown> }> {
  let res: Response;
  try { res = await f(url, form(o)); } catch { throw new CloudError("network", "ইন্টারনেট সংযোগ পাওয়া যায়নি।"); }
  let json: Record<string, unknown> = {};
  try { json = (await res.json()) as Record<string, unknown>; } catch { /* empty body */ }
  return { status: res.status, json };
}
const checkCfg = (c: GoogleConfig) => { if (!c.clientId.trim() || !c.clientSecret.trim()) throw new CloudError("config", "Google Client ID ও Client Secret আগে সেটিংসে দিন।"); };
const scopesOf = (s: unknown) => String(s ?? "").split(/\s+/).filter(Boolean);

export async function startDeviceFlow(cfg: GoogleConfig, f: Fetch = fetch): Promise<DeviceCode> {
  checkCfg(cfg);
  const r = await post(f, DEVICE_URL, { client_id: cfg.clientId.trim(), scope: SCOPES.join(" ") });
  if (r.status !== 200 || !r.json.device_code) throw new CloudError("config", `Google সেটআপ ঠিক নয় (${String(r.json.error_description ?? r.json.error ?? r.status)})। Client ID "TVs and Limited Input devices" ধরনের কিনা দেখুন।`);
  return { deviceCode: String(r.json.device_code), userCode: String(r.json.user_code), verificationUrl: String(r.json.verification_url ?? "https://www.google.com/device"), expiresIn: Number(r.json.expires_in ?? 1800), interval: Math.max(1, Number(r.json.interval ?? 5)) };
}

export interface PollOpts { fetch?: Fetch; sleep?: (ms: number) => Promise<void>; now?: () => number; signal?: { aborted: boolean } }
/** ব্যবহারকারী google.com/device-এ কোড দিয়ে অনুমতি না দেওয়া পর্যন্ত অপেক্ষা করে। */
export async function pollDeviceFlow(cfg: GoogleConfig, dc: DeviceCode, o: PollOpts = {}): Promise<Tokens> {
  const f = o.fetch ?? fetch, sleep = o.sleep ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms))), now = o.now ?? Date.now;
  const deadline = now() + dc.expiresIn * 1000;
  let interval = dc.interval;
  for (;;) {
    await sleep(interval * 1000);
    if (o.signal?.aborted) throw new CloudError("denied", "লগইন বাতিল করা হয়েছে।");
    if (now() > deadline) throw new CloudError("expired", "কোডের সময় শেষ। আবার শুরু করুন।");
    const r = await post(f, TOKEN_URL, { client_id: cfg.clientId.trim(), client_secret: cfg.clientSecret.trim(), device_code: dc.deviceCode, grant_type: "urn:ietf:params:oauth:grant-type:device_code" });
    if (r.json.access_token) return { accessToken: String(r.json.access_token), refreshToken: r.json.refresh_token ? String(r.json.refresh_token) : undefined, expiresAt: now() + Number(r.json.expires_in ?? 3600) * 1000, scopes: scopesOf(r.json.scope) };
    const err = String(r.json.error ?? "");
    if (err === "authorization_pending") continue;
    if (err === "slow_down") { interval += 5; continue; }
    if (err === "access_denied") throw new CloudError("denied", "আপনি অনুমতি দেননি। Google ও Drive-এর অনুমতি ছাড়া অ্যাপে ঢোকা যাবে না।");
    if (err === "expired_token") throw new CloudError("expired", "কোডের সময় শেষ। আবার শুরু করুন।");
    throw new CloudError("config", `Google লগইন ব্যর্থ (${String(r.json.error_description ?? err ?? r.status)})।`);
  }
}

/** Refresh token দিয়ে নতুন access token। invalid_grant = ব্যবহারকারী অনুমতি তুলে নিয়েছেন (Revoked)। */
export async function refreshAccessToken(cfg: GoogleConfig, refreshToken: string, f: Fetch = fetch, now: () => number = Date.now): Promise<Tokens> {
  checkCfg(cfg);
  const r = await post(f, TOKEN_URL, { client_id: cfg.clientId.trim(), client_secret: cfg.clientSecret.trim(), refresh_token: refreshToken, grant_type: "refresh_token" });
  if (r.json.access_token) return { accessToken: String(r.json.access_token), refreshToken, expiresAt: now() + Number(r.json.expires_in ?? 3600) * 1000, scopes: scopesOf(r.json.scope) };
  if (r.json.error === "invalid_grant" || r.json.error === "invalid_token") throw new CloudError("revoked", "Google Drive-এর অনুমতি আর নেই (তুলে নেওয়া বা মেয়াদ শেষ)। আবার অনুমতি দিন।");
  if (r.status >= 500) throw new CloudError("server", "Google সাময়িকভাবে সাড়া দিচ্ছে না।", r.status);
  throw new CloudError("config", `টোকেন নবায়ন ব্যর্থ (${String(r.json.error_description ?? r.json.error ?? r.status)})।`);
}

/** ধাপ ২: Google অ্যাকাউন্টের পরিচয় যাচাই। যাচাই-না-হওয়া ইমেইল গ্রহণযোগ্য নয়। */
export async function getIdentity(accessToken: string, f: Fetch = fetch): Promise<Identity> {
  let res: Response;
  try { res = await f(USERINFO_URL, { headers: { Authorization: `Bearer ${accessToken}` } }); } catch { throw new CloudError("network", "ইন্টারনেট সংযোগ পাওয়া যায়নি।"); }
  if (res.status === 401) throw new CloudError("revoked", "Google অনুমতি বাতিল।");
  if (!res.ok) throw new CloudError("server", "Google পরিচয় যাচাই করা যায়নি।", res.status);
  const j = (await res.json()) as { sub?: string; email?: string; email_verified?: boolean | string; name?: string };
  if (!j.sub || !j.email) throw new CloudError("denied", "Google থেকে ইমেইল পাওয়া যায়নি।");
  if (j.email_verified === false || j.email_verified === "false") throw new CloudError("denied", "এই Gmail যাচাই করা নয়।");
  return { sub: j.sub, email: j.email.trim().toLowerCase(), name: j.name ?? null };
}

/** ধাপ ৫: সত্যিই Drive অনুমতি পাওয়া গেছে কিনা Google-কে জিজ্ঞেস করে নিশ্চিত হওয়া (ব্যবহারকারী টিক খুলে রাখলে ধরা পড়ে)। */
export async function verifyDriveScope(accessToken: string, f: Fetch = fetch): Promise<string[]> {
  let res: Response;
  try { res = await f(`${TOKENINFO_URL}?access_token=${encodeURIComponent(accessToken)}`); } catch { throw new CloudError("network", "ইন্টারনেট সংযোগ পাওয়া যায়নি।"); }
  if (!res.ok) throw new CloudError("revoked", "Google অনুমতি যাচাই করা যায়নি (বাতিল বা মেয়াদোত্তীর্ণ)।");
  const sc = scopesOf(((await res.json()) as { scope?: string }).scope);
  if (!sc.includes(DRIVE_SCOPE)) throw new CloudError("scope", "Google Drive-এর অনুমতি দেওয়া হয়নি। অনুমতির পর্দায় Drive-এর বাক্সটিও টিক দিয়ে আবার চেষ্টা করুন।");
  return sc;
}

export async function revokeToken(token: string, f: Fetch = fetch): Promise<void> {
  try { await f(REVOKE_URL, form({ token })); } catch { /* best effort */ }
}
