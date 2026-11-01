# Roadmap & Progress (নতুন চ্যাটে এই ফাইলটি পেস্ট করুন)

Stack: React + TypeScript + Vite (PWA), SQLite WASM (offline), D3.js, Firebase/Supabase Auth (Google Sign-In).
Rule: কোড পাবলিক হতে পারে, আসল পারিবারিক ডেটা কখনো নয়।

- [x] ধাপ ১ – ভিত্তি: রিপো, README, ফোল্ডার, TypeScript/Vite, GitHub Actions বিল্ড
- [x] ধাপ ২ – ডিজাইন সিস্টেম: Black & Gold টোকেন, কম্পোনেন্ট CSS, preview.html
- [x] ধাপ ৩ – ডেটাবেস স্কিমা (Person, Union, ParentChild, Event, Source, Place, Media; status; null = অজানা)
- [x] ধাপ ৪ – সম্পর্কের লজিক (src/core/relations.ts + tests/relations.test.ts, পরীক্ষিত) ও ডুপ্লিকেট শনাক্ত
- [x] ধাপ ৫ – প্রোফাইল ও ফর্ম (src/db/repo.ts + sql.js + IndexedDB; src/components/PersonForm.tsx, People.tsx; repo টেস্ট পাস)
- [x] ধাপ ৬ – ট্রি ভিউ (ফোকাস ক্যানভাস, জুম/পান, silhouette; আসল ডেটায় সংযুক্ত। বাকি: Expand/Collapse, Compact/Portrait/Cinematic মোড)
- [ ] ধাপ ৭ – Google লগইন, Role, ২–৩ জনের অনুমোদন, History
  - [x] ৭ক – Role, সদস্য-তালিকা, ২/৩ জনের অনুমোদন (ডেটাবেস ট্রিগারে), History স্ক্রিন; tests/access.test.ts পাস
  - [ ] ৭খ – Google Sign-In (OAuth Client ID লাগবে) ও সদস্য যাচাই
- [x] ধাপ ৮ – ব্যাকআপ, JSON/GEDCOM 5.5.1, Restore (src/db/backup.ts, gedcom.ts, snapshots.ts, components/Backup.tsx; tests/backup.test.ts পাস)
  - [x] ৮ক – ZIP ব্যাকআপ প্যাকেজ (data.json + GEDCOM + README + SHA-256 চেকসাম, src/db/zip.ts, package.ts), যাচাইসহ Restore, ব্যাকআপের খাতা; tests/package.test.ts পাস
  - [x] ৫ক – সম্পর্ক বাছাই (বাবা, মা, ভাই, বোন, দাদা-দাদি, নানা-নানী, সন্তান, স্বামী/স্ত্রী; একাধিক), একই সম্পর্কে একটিই রেখা; tests/relations_add.test.ts পাস
  - [x] ফোনের ব্যাক বাটন: পপআপ বন্ধ > আগের স্ক্রিন > হোম > "আবার চাপলে বের হবে" (@capacitor/app)
  - [ ] ৮খ – Google Drive অটো-ব্যাকআপ ও অন্য Drive অ্যাকাউন্টে কপি (ধাপ ৭-এর Google OAuth শেষ হলে; তার আগে ZIP শেয়ার-শিট দিয়ে যেকোনো Drive-এ রাখা যায়)
- [ ] ধাপ ৯ – মিডিয়া, টাইমলাইন, ম্যাপ, সার্চ, ড্যাশবোর্ড
- [ ] ধাপ ১০ – Legacy Transfer, Time Capsule, Knowledge AI, Cinematic View

অগ্রগতি: ৭/১০ (ধাপ ১-৬, ৮ সম্পন্ন; ৭, ৯, ১০ বাকি)
- [x] APK বিল্ড: GitHub Actions → Artifacts → family-tree-apk

## আপডেট নিয়ম (গুরুত্বপূর্ণ)
- signing/release.keystore স্থায়ী চাবি। এটি ও পাসওয়ার্ড (workflow ফাইলে আছে) আলাদা জায়গায় ব্যাকআপ রাখুন। হারালে পরের APK পুরোনোটির ওপর ইনস্টল হবে না।
- প্রতিটি বিল্ডে versionCode বাড়ে, তাই আনইনস্টল ছাড়াই আপডেট হয়।
- প্রতিবার জিপের নামে নতুন সংস্করণ (-v3, -v4...)।

টেস্ট চালাতে: npm test (Node 22+)
