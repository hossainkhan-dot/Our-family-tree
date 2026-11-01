/** kind বলে দেয় অ্যাপ কী করবে: revoked/scope/denied = আবার অনুমতি চাইবে, network = পরে আবার চেষ্টা (অফলাইন কিউ)। */
export type CloudKind = "config" | "denied" | "scope" | "expired" | "revoked" | "forbidden" | "notfound" | "network" | "quota" | "server" | "conflict" | "membership";
export class CloudError extends Error {
  kind: CloudKind;
  status?: number;
  constructor(kind: CloudKind, message: string, status?: number) { super(message); this.name = "CloudError"; this.kind = kind; this.status = status; }
}
/** এই ধরনের ত্রুটিতে সুরক্ষিত কাজ (সিঙ্ক/ব্যাকআপ) বন্ধ হবে এবং আবার Google অনুমতি লাগবে। */
export const needsReauth = (e: unknown): boolean => e instanceof CloudError && (e.kind === "revoked" || e.kind === "scope" || e.kind === "denied" || e.kind === "forbidden");
export const isOffline = (e: unknown): boolean => e instanceof CloudError && e.kind === "network";
