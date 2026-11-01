import { CloudError } from "./errors";
import { refreshAccessToken, verifyDriveScope, type Fetch, type GoogleConfig, type Tokens } from "./google";

export interface StoredSession { email: string; sub: string; name: string | null; refreshToken: string; scopes: string[]; connectedAt: string }

/** access token শুধু মেমরিতে থাকে; refresh token ফোনের ভেতরে (অ্যাপের নিজস্ব সংরক্ষণে) থাকে। */
export class TokenSource {
  private cur: Tokens | null = null;
  private cfg: GoogleConfig; private session: StoredSession; private f: Fetch; private now: () => number; private onRevoked?: () => void;
  constructor(cfg: GoogleConfig, session: StoredSession, f: Fetch = fetch, now: () => number = Date.now, onRevoked?: () => void) {
    this.cfg = cfg; this.session = session; this.f = f; this.now = now; this.onRevoked = onRevoked;
  }
  seed(t: Tokens) { this.cur = t; }
  invalidate() { this.cur = null; }
  get email() { return this.session.email; }
  async get(): Promise<string> {
    if (this.cur && this.cur.expiresAt - 60_000 > this.now()) return this.cur.accessToken;
    try { this.cur = await refreshAccessToken(this.cfg, this.session.refreshToken, this.f, this.now); }
    catch (e) { if (e instanceof CloudError && e.kind === "revoked") this.onRevoked?.(); throw e; }
    return this.cur.accessToken;
  }
  /** প্রতিটি সুরক্ষিত কাজের আগে: অনুমতি এখনো আছে কিনা Google-কে জিজ্ঞেস করে। */
  async checkPermission(): Promise<void> {
    try { await verifyDriveScope(await this.get(), this.f); }
    catch (e) { if (e instanceof CloudError && (e.kind === "revoked" || e.kind === "scope")) this.onRevoked?.(); throw e; }
  }
}
