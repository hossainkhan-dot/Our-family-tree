# Roadmap & Progress (নতুন চ্যাটে এই ফাইলটি পেস্ট করুন)

Stack: React + TypeScript + Vite (PWA), SQLite WASM (offline), D3.js, Firebase/Supabase Auth (Google Sign-In).
Rule: কোড পাবলিক হতে পারে, আসল পারিবারিক ডেটা কখনো নয়।

- [x] ধাপ ১ – ভিত্তি: রিপো, README, ফোল্ডার, TypeScript/Vite, GitHub Actions বিল্ড
- [x] ধাপ ২ – ডিজাইন সিস্টেম: Black & Gold টোকেন, কম্পোনেন্ট CSS, preview.html
- [ ] ধাপ ৩ – ডেটাবেস স্কিমা (Person, Union, ParentChild, Event, Source, Place, Media; status; null = অজানা)
- [ ] ধাপ ৪ – সম্পর্কের লজিক ও ডুপ্লিকেট শনাক্ত
- [ ] ধাপ ৫ – প্রোফাইল ও ফর্ম
- [ ] ধাপ ৬ – ট্রি ভিউ (D3, জুম/পান, সোনালি লাইন)
- [ ] ধাপ ৭ – Google লগইন, Role, ২–৩ জনের অনুমোদন, History
- [ ] ধাপ ৮ – ব্যাকআপ, JSON/GEDCOM, Restore
- [ ] ধাপ ৯ – মিডিয়া, টাইমলাইন, ম্যাপ, সার্চ, ড্যাশবোর্ড
- [ ] ধাপ ১০ – Legacy Transfer, Time Capsule, Knowledge AI, Cinematic View

অগ্রগতি: ২/১০
- [x] APK বিল্ড: GitHub Actions → Artifacts → family-tree-apk

## আপডেট নিয়ম (গুরুত্বপূর্ণ)
- signing/release.keystore স্থায়ী চাবি। এটি ও পাসওয়ার্ড (workflow ফাইলে আছে) আলাদা জায়গায় ব্যাকআপ রাখুন। হারালে পরের APK পুরোনোটির ওপর ইনস্টল হবে না।
- প্রতিটি বিল্ডে versionCode বাড়ে, তাই আনইনস্টল ছাড়াই আপডেট হয়।
- প্রতিবার জিপের নামে নতুন সংস্করণ (-v3, -v4...)।
