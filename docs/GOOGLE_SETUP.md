# Google সেটআপ (একবারই, বিনামূল্যে) — এক-ট্যাপ লগইন

অ্যাপ খুললেই Google লগইন আসবে; Gmail বাছলে Drive-এর অনুমতিও একই Google পর্দায় চাওয়া হবে (কোড লেখা লাগে না)।

## ধাপ
1. console.cloud.google.com → নতুন Project।
2. APIs & Services → Library → **Google Drive API** → Enable।
3. **OAuth consent screen**: External; অ্যাপের নাম ও ইমেইল। Scopes: `email`, `profile`, `openid`, `.../auth/drive.file`। **Publishing status = "In production"** (Testing থাকলে প্রতি ৭ দিনে লগইন মুছে যায়)। প্রথমবার "unverified app" সতর্কতা এলে Advanced → Continue।
4. Credentials → OAuth client ID → **Android**:
   - Package name: `com.hossainkhan.familytree`
   - SHA-1: `3D:C5:2D:28:77:39:2C:C9:DA:97:F9:33:F0:B9:60:30:D8:56:74:BC` (signing/release.keystore-এর)
5. Credentials → OAuth client ID → **Web application** (নাম যেকোনো) → এর **Client ID** কপি করুন।
6. সেই Web Client ID আমাকে দিন; আমি `src/cloud/baked.ts`-এ বসিয়ে দেব। (বিকল্প: অ্যাপের লগইন-পর্দার ঘরে একবার লিখুন।)
