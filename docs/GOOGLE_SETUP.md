# Google সেটআপ (একবারই, বিনামূল্যে)

অ্যাপ Google লগইন ও Drive-এর জন্য "Device flow" ব্যবহার করে: অ্যাপ একটি কোড দেখায়, আপনি google.com/device-এ কোড দিয়ে Google-এর আসল অনুমতি-পর্দায় অনুমতি দেন। কোনো প্লাগইন বা রিডাইরেক্ট লাগে না।

## ধাপ
1. console.cloud.google.com → নতুন Project (নাম: Family Legacy Archive)।
2. APIs & Services → Library → **Google Drive API** → Enable।
3. APIs & Services → **OAuth consent screen**: User type = External; অ্যাপের নাম, আপনার ইমেইল দিন।
   - Scopes: `openid`, `email`, `profile`, `.../auth/drive.file` (শুধু এই Drive স্কোপ; এটি "non-sensitive", Google-এর ভেরিফিকেশন লাগে না)।
   - **Publishing status = "In production"** করুন। "Testing" অবস্থায় Google প্রতি ৭ দিনে লগইন মুছে দেয়।
   - প্রথমবার Google "unverified app" সতর্কতা দেখাতে পারে: Advanced → Continue।
4. Credentials → Create credentials → OAuth client ID → Application type = **TVs and Limited Input devices**।
5. যে Client ID ও Client Secret আসবে সেগুলো অ্যাপে: ব্যাকআপ ট্যাব → "Google Drive: ব্যাকআপ ও সিঙ্ক" → সংরক্ষণ।
   - এগুলো রিপোতে বা কোডে রাখবেন না (পাবলিক রিপো)। প্রতিটি সদস্যের ফোনে একবার বসাতে হবে।
6. "Google লগইন চালু করুন" চাপুন → গোপনীয়তা-সম্মতি → কোড → Google পর্দায় Gmail ও **Drive-এর বাক্স টিক** দিন।

## সীমা (সৎভাবে)
- Drive স্কোপ `drive.file`: অ্যাপ শুধু নিজের তৈরি/খোলা ফাইলই দেখে; আপনার অন্য কোনো ফাইল দেখে না।
- Google বিনামূল্যে নীতি ও কোটা বদলাতে পারে; তাই ফাইল-ব্যাকআপ (ZIP) আলাদা রাখা চলবে।
