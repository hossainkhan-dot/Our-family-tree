import { Capacitor } from "@capacitor/core";
import { SocialLogin } from "@capgo/capacitor-social-login";
import { CloudError } from "./errors";
import { DRIVE_SCOPE, type Tokens } from "./google";

let ready: string | null = null;
export const nativeAvailable = () => Capacitor.isNativePlatform();

/** অ্যান্ড্রয়েডের নিজস্ব Google সাইন-ইন: এক ট্যাপে Gmail বাছাই + Drive অনুমতি একই পর্দায়। */
export async function nativeLogin(webClientId: string, now: () => number = Date.now): Promise<Tokens> {
  if (!webClientId.trim()) throw new CloudError("config", "Google Web Client ID বসানো নেই (docs/GOOGLE_SETUP.md)।");
  try {
    if (ready !== webClientId) { await SocialLogin.initialize({ google: { webClientId: webClientId.trim() } } as never); ready = webClientId; }
    const r = (await SocialLogin.login({ provider: "google", options: { scopes: ["email", "profile", DRIVE_SCOPE] } } as never)) as unknown as { result?: { accessToken?: { token?: string } | null } };
    const token = r.result?.accessToken?.token;
    if (!token) throw new CloudError("scope", "Google থেকে Drive-এর অনুমতি-টোকেন পাওয়া যায়নি। অনুমতির পর্দায় Drive-এর বাক্সটিও টিক দিন।");
    return { accessToken: token, expiresAt: now() + 50 * 60 * 1000, scopes: [] };
  } catch (e) {
    if (e instanceof CloudError) throw e;
    const m = e instanceof Error ? e.message : String(e);
    if (/cancel|dismiss|no credential|user.*(denied|rejected)/i.test(m)) throw new CloudError("denied", "লগইন বা অনুমতি বাতিল করা হয়েছে। Google ও Drive অনুমতি ছাড়া অ্যাপে ঢোকা যাবে না।");
    throw new CloudError("config", `Google লগইন ব্যর্থ: ${m}`);
  }
}
