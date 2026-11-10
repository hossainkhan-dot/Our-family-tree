package __PKG__;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.Handler;
import android.os.Looper;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.FileInputStream;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.concurrent.CopyOnWriteArrayList;

/**
 * গেমিং ভয়েস প্যাকের স্থায়ী সংরক্ষণ। অ্যাপের UI ও ভাসমান সার্ভিস একই ফাইল পড়ে।
 *  - filesDir/voicepacks/voicepacks.json  : প্যাক ও সেটিংস (UI লেখে)
 *  - filesDir/voicepacks/audio/           : অডিও ফাইল (অ্যাপ-বন্ধ করলেও থাকে)
 *  - SharedPreferences                    : সক্রিয় প্যাক ও বাটনের অবস্থান (ওভারলে লেখে)
 * পারিবারিক ডেটাবেস/ব্যাকআপের সঙ্গে এর কোনো সম্পর্ক নেই।
 */
final class VoiceStore {
    private VoiceStore() {}

    static final String EMPTY = "{\"version\":1,\"packs\":[],\"settings\":{}}";
    private static final String PREFS = "voicepacks_prefs";
    private static final Object LOCK = new Object();

    /** ছোট অ্যাডাপ্টার: যেটা দরকার শুধু সেটা ওভাররাইড করুন। */
    static abstract class Listener {
        void onPacksChanged() {}
        void onActiveChanged(String id) {}
        void onRunningChanged(boolean running) {}
    }
    private static final List<Listener> LISTENERS = new CopyOnWriteArrayList<>();
    private static final Handler MAIN = new Handler(Looper.getMainLooper());
    static void addListener(Listener l) { if (!LISTENERS.contains(l)) LISTENERS.add(l); }
    static void removeListener(Listener l) { LISTENERS.remove(l); }

    static File dir(Context c) {
        File d = new File(c.getFilesDir(), "voicepacks");
        if (!d.exists()) d.mkdirs();
        return d;
    }
    static File audioDir(Context c) {
        File d = new File(dir(c), "audio");
        if (!d.exists()) d.mkdirs();
        return d;
    }
    /** শুধু নিরাপদ নাম (path-এর বাইরে যাওয়া যাবে না)। */
    static boolean safeName(String n) {
        return n != null && n.matches("[A-Za-z0-9._-]{1,120}") && !n.contains("..");
    }
    static File audioFile(Context c, String name) {
        return safeName(name) ? new File(audioDir(c), name) : null;
    }

    static String loadJson(Context c) {
        synchronized (LOCK) {
            File f = new File(dir(c), "voicepacks.json");
            if (!f.exists()) return EMPTY;
            try (FileInputStream in = new FileInputStream(f); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
                byte[] buf = new byte[8192];
                int n;
                while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
                String s = new String(out.toByteArray(), StandardCharsets.UTF_8);
                new JSONObject(s); // নষ্ট হলে ধরা পড়বে
                return s;
            } catch (Exception e) {
                return EMPTY;
            }
        }
    }

    /** আগে অস্থায়ী ফাইলে লিখে পরে নাম বদলায়, তাই মাঝপথে বন্ধ হলেও পুরোনো তথ্য নষ্ট হয় না। */
    static void saveJson(Context c, String json) throws Exception {
        new JSONObject(json); // অবৈধ হলে এখানেই ব্যর্থ, ফাইল ছোঁয়া হয় না
        synchronized (LOCK) {
            File d = dir(c);
            File tmp = new File(d, "voicepacks.json.tmp"), dst = new File(d, "voicepacks.json");
            try (FileOutputStream out = new FileOutputStream(tmp)) {
                out.write(json.getBytes(StandardCharsets.UTF_8));
                out.getFD().sync();
            }
            if (!tmp.renameTo(dst)) {
                if (dst.exists() && !dst.delete()) throw new Exception("সংরক্ষণ করা যায়নি");
                if (!tmp.renameTo(dst)) throw new Exception("সংরক্ষণ করা যায়নি");
            }
        }
        fire(new Runnable() { public void run() { for (Listener l : LISTENERS) l.onPacksChanged(); } });
    }

    static SharedPreferences prefs(Context c) { return c.getSharedPreferences(PREFS, Context.MODE_PRIVATE); }

    static String activeId(Context c) { return prefs(c).getString("active", null); }
    static void setActive(Context c, final String id) {
        SharedPreferences.Editor e = prefs(c).edit();
        if (id == null) e.remove("active"); else e.putString("active", id);
        e.apply();
        fire(new Runnable() { public void run() { for (Listener l : LISTENERS) l.onActiveChanged(id); } });
    }
    static int posX(Context c) { return prefs(c).getInt("bx", -1); }
    static int posY(Context c) { return prefs(c).getInt("by", -1); }
    static void setPos(Context c, int x, int y) { prefs(c).edit().putInt("bx", x).putInt("by", y).apply(); }

    static void fireRunning(final boolean running) {
        fire(new Runnable() { public void run() { for (Listener l : LISTENERS) l.onRunningChanged(running); } });
    }
    private static void fire(Runnable r) {
        if (Looper.myLooper() == Looper.getMainLooper()) r.run(); else MAIN.post(r);
    }

    /**
     * সংরক্ষিত তথ্যে (JSON) যে অডিও ফাইলের উল্লেখ নেই সেগুলো মুছে ফেলে। কতগুলো মুছল তা ফেরত দেয়।
     * সুরক্ষা: তথ্য-ফাইল পড়া না গেলে কিছুই মোছে না; আর গত ২ মিনিটে আনা ফাইল ছোঁয় না
     * (এইমাত্র বাছা, কিন্তু এখনো সংরক্ষণ হয়নি এমন ফাইল যেন না হারায়)।
     */
    static int purgeUnreferenced(Context c) {
        File meta = new File(dir(c), "voicepacks.json");
        if (!meta.exists()) return 0;
        String json = loadJson(c);
        if (json == EMPTY) return 0; // পড়া যায়নি বা নষ্ট — ঝুঁকি নেই
        Set<String> keep = new HashSet<>();
        for (Pack p : parse(json).packs) for (Cmd cm : p.cmds) if (cm.file != null) keep.add(cm.file);
        long cutoff = System.currentTimeMillis() - 2 * 60 * 1000L;
        int n = 0;
        File[] fs = audioDir(c).listFiles();
        if (fs == null) return 0;
        for (File f : fs) {
            if (!keep.contains(f.getName()) && f.lastModified() < cutoff && f.delete()) n++;
        }
        return n;
    }

    // ---------- ডেটা পড়া (ওভারলের জন্য) ----------
    static final class Cmd { String id, label, file; }
    static final class Pack { String id, name; List<Cmd> cmds = new ArrayList<>(); }
    static final class Cfg {
        int holdMs = 2000, size = 52;
        float opacity = 0.9f, volume = 1f;
        boolean interrupt = true, speaker = true, outsideClose = true, autoClose = false;
    }
    static final class Data { List<Pack> packs = new ArrayList<>(); Cfg cfg = new Cfg(); }

    private static float clampF(double v, float lo, float hi) { return (float) Math.min(hi, Math.max(lo, v)); }
    private static int clampI(int v, int lo, int hi) { return Math.min(hi, Math.max(lo, v)); }

    /** JS-এর cleanSettings-এর সঙ্গে একই সীমা। */
    static Data parse(String json) {
        Data d = new Data();
        try {
            JSONObject o = new JSONObject(json);
            JSONObject s = o.optJSONObject("settings");
            if (s != null) {
                d.cfg.holdMs = clampI(s.optInt("holdMs", 2000), 1000, 3000);
                d.cfg.size = clampI(s.optInt("size", 52), 40, 72);
                d.cfg.opacity = clampF(s.optDouble("opacity", 0.9), 0.4f, 1f);
                d.cfg.volume = clampF(s.optDouble("volume", 1), 0f, 1f);
                d.cfg.interrupt = s.optBoolean("interrupt", true);
                d.cfg.speaker = s.optBoolean("speaker", true);
                d.cfg.outsideClose = s.optBoolean("outsideClose", true);
                d.cfg.autoClose = s.optBoolean("autoClose", false);
            }
            JSONArray ps = o.optJSONArray("packs");
            if (ps == null) return d;
            for (int i = 0; i < ps.length(); i++) {
                JSONObject po = ps.optJSONObject(i);
                if (po == null) continue;
                Pack p = new Pack();
                p.id = po.optString("id", "");
                p.name = po.optString("name", "প্যাক");
                if (p.id.isEmpty()) continue;
                JSONArray cs = po.optJSONArray("commands");
                if (cs != null) {
                    for (int j = 0; j < cs.length(); j++) {
                        JSONObject co = cs.optJSONObject(j);
                        if (co == null) continue;
                        Cmd c = new Cmd();
                        c.id = co.optString("id", "");
                        c.label = co.optString("label", "");
                        JSONObject clip = co.optJSONObject("clip");
                        c.file = clip == null ? null : clip.optString("file", null);
                        p.cmds.add(c);
                    }
                }
                d.packs.add(p);
            }
        } catch (Exception ignored) { /* খালি তথ্য ফেরত যাবে */ }
        return d;
    }

    /** সংরক্ষিত আইডি মিললে সেটি, নইলে প্রথম প্যাক (JS-এর effectiveActive-এর মতো)। */
    static Pack activePack(Data d, String id) {
        if (d.packs.isEmpty()) return null;
        if (id != null) for (Pack p : d.packs) if (p.id.equals(id)) return p;
        return d.packs.get(0);
    }
}
