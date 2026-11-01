import { Capacitor, CapacitorHttp } from "@capacitor/core";

/** Google-এর লগইন-সংক্রান্ত ঠিকানা ফোনের নিজস্ব নেটওয়ার্ক দিয়ে ডাকা হয় (ব্রাউজারের CORS বাধা এড়াতে)। ব্রাউজারে সাধারণ fetch। */
export const authFetch: typeof fetch = async (input, init) => {
  if (!Capacitor.isNativePlatform()) return fetch(input, init);
  const method = (init?.method ?? "GET").toUpperCase();
  const headers = (init?.headers ?? {}) as Record<string, string>;
  const body = typeof init?.body === "string" ? init.body : undefined;
  const r = await CapacitorHttp.request({
    url: String(input), method, headers,
    ...(body !== undefined ? { data: Object.fromEntries(new URLSearchParams(body)) } : {}),
    responseType: "text",
  });
  const text = typeof r.data === "string" ? r.data : JSON.stringify(r.data ?? {});
  return new Response(text, { status: r.status, headers: { "Content-Type": "application/json" } });
};
