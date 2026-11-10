// `npx cap add android` প্রতি বিল্ডে নতুন android/ ফোল্ডার বানায়। এই স্ক্রিপ্ট তার পরে চলে এবং
// "গেমিং ভয়েস"-এর নেটিভ কোড বসায়। বারবার চালালেও একই ফল (idempotent)। সাইনিং/ভার্সনের কিছু ছোঁয় না।
//   ব্যবহার:  node scripts/patch-android.mjs
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const die = (m) => { console.error("patch-android: " + m); process.exit(1); };

const cfg = JSON.parse(readFileSync(join(root, "capacitor.config.json"), "utf8"));
const pkg = String(cfg.appId || "");
if (!/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/i.test(pkg)) die(`capacitor.config.json-এর appId ঠিক নেই: "${pkg}"`);

const app = join(root, "android", "app", "src", "main");
const manifestPath = join(app, "AndroidManifest.xml");
if (!existsSync(manifestPath)) die("android/ নেই। আগে `npx cap add android` চালান।");
const javaDir = join(app, "java", ...pkg.split("."));
if (!existsSync(javaDir)) mkdirSync(javaDir, { recursive: true });

// ১) নেটিভ Java ফাইল কপি (প্যাকেজের নাম বসিয়ে)
const srcDir = join(root, "native", "android");
const files = readdirSync(srcDir).filter((f) => f.endsWith(".java"));
if (!files.length) die("native/android-এ কোনো .java ফাইল নেই।");
for (const f of files) {
  const text = readFileSync(join(srcDir, f), "utf8").replaceAll("__PKG__", pkg);
  writeFileSync(join(javaDir, f), text);
}
console.log(`patch-android: ${files.length}টি Java ফাইল → ${pkg}`);

// ২) Manifest: অনুমতি + সার্ভিস (মাইক্রোফোনের অনুমতি ইচ্ছাকৃতভাবে নেই)
let m = readFileSync(manifestPath, "utf8");
if (!m.includes("gaming-voice:begin")) {
  if (!/<application[\s>]/.test(m) || !m.includes("</application>")) die("AndroidManifest.xml-এ <application> পাওয়া যায়নি।");
  const perms = `    <!-- gaming-voice:begin -->
    <uses-permission android:name="android.permission.SYSTEM_ALERT_WINDOW" />
    <uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
    <uses-permission android:name="android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK" />
    <uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
    <!-- gaming-voice:end -->
`;
  const svc = `        <!-- gaming-voice:service -->
        <service android:name=".OverlayService" android:exported="false" android:foregroundServiceType="mediaPlayback" />
`;
  m = m.replace(/(\s*)<application[\s>]/, (s) => `\n${perms}${s}`).replace("</application>", `${svc}    </application>`);
  writeFileSync(manifestPath, m);
  console.log("patch-android: AndroidManifest.xml হালনাগাদ");
} else console.log("patch-android: Manifest আগেই হালনাগাদ করা");

// ৩) MainActivity: প্লাগইন নিবন্ধন (বাকি আচরণ অপরিবর্তিত)
const mainPath = join(javaDir, "MainActivity.java");
if (!existsSync(mainPath)) die(`${mainPath} পাওয়া যায়নি।`);
let a = readFileSync(mainPath, "utf8");
if (!a.includes("VoicePacksPlugin")) {
  if (/void\s+onCreate\s*\(/.test(a)) {
    a = a.replace(/(super\.onCreate\s*\()/, "registerPlugin(VoicePacksPlugin.class);\n        $1");
  } else {
    const re = /(public\s+class\s+MainActivity\s+extends\s+BridgeActivity[^{]*)\{/;
    if (!re.test(a)) die("MainActivity.java-র গঠন চেনা যায়নি।");
    a = a.replace(re, `$1{\n    @Override\n    public void onCreate(android.os.Bundle savedInstanceState) {\n        registerPlugin(VoicePacksPlugin.class);\n        super.onCreate(savedInstanceState);\n    }\n`);
  }
  if (!a.includes("VoicePacksPlugin")) die("MainActivity-তে প্লাগইন বসানো গেল না।");
  writeFileSync(mainPath, a);
  console.log("patch-android: MainActivity-তে VoicePacksPlugin নিবন্ধিত");
} else console.log("patch-android: MainActivity আগেই নিবন্ধিত");
