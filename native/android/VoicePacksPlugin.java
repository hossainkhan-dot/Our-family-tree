package __PKG__;

import android.Manifest;
import android.app.Activity;
import android.content.ClipData;
import android.content.ContentResolver;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.media.MediaMetadataRetriever;
import android.net.Uri;
import android.os.Build;
import android.provider.OpenableColumns;
import android.provider.Settings;

import androidx.activity.result.ActivityResult;
import androidx.core.content.ContextCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.List;

/** অ্যাপের (React) UI ↔ ফোনের নেটিভ অংশের সেতু। সব ভারী কাজ (ফাইল কপি, প্লেব্যাক, ওভারলে) এখানে/সার্ভিসে। */
@CapacitorPlugin(
        name = "VoicePacks",
        permissions = { @Permission(alias = "notifications", strings = { "android.permission.POST_NOTIFICATIONS" }) }
)
public class VoicePacksPlugin extends Plugin {
    private static final long MAX_BYTES = 50L * 1024 * 1024;

    private final VoiceStore.Listener listener = new VoiceStore.Listener() {
        @Override void onActiveChanged(String id) {
            JSObject o = new JSObject();
            o.put("id", id == null ? JSONObject.NULL : id);
            notifyListeners("activeChanged", o);
        }
        @Override void onRunningChanged(boolean running) {
            JSObject o = new JSObject();
            o.put("running", running);
            notifyListeners("overlayState", o);
        }
    };

    @Override public void load() { VoiceStore.addListener(listener); }
    @Override protected void handleOnDestroy() { VoiceStore.removeListener(listener); }

    private Context ctx() { return getContext(); }
    private boolean canDraw() { return Build.VERSION.SDK_INT < 23 || Settings.canDrawOverlays(ctx()); }
    private boolean notifGranted() {
        return Build.VERSION.SDK_INT < 33
                || ContextCompat.checkSelfPermission(ctx(), Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED;
    }

    @PluginMethod
    public void getState(PluginCall call) {
        JSObject r = new JSObject();
        String active = VoiceStore.activeId(ctx());
        r.put("json", VoiceStore.loadJson(ctx()));
        r.put("activeId", active == null ? JSONObject.NULL : active);
        r.put("running", OverlayService.isRunning());
        r.put("overlayGranted", canDraw());
        r.put("notifGranted", notifGranted());
        r.put("sdk", Build.VERSION.SDK_INT);
        call.resolve(r);
    }

    @PluginMethod
    public void save(PluginCall call) {
        String json = call.getString("json");
        if (json == null) { call.reject("তথ্য খালি"); return; }
        try {
            VoiceStore.saveJson(ctx(), json);
            call.resolve();
        } catch (Exception e) {
            call.reject("সংরক্ষণ করা যায়নি: " + e.getMessage());
        }
    }

    @PluginMethod
    public void setActive(PluginCall call) {
        VoiceStore.setActive(ctx(), call.getString("id"));
        call.resolve();
    }

    @PluginMethod
    public void purge(PluginCall call) {
        final PluginCall c = call;
        new Thread(new Runnable() {
            public void run() {
                JSObject r = new JSObject();
                r.put("removed", VoiceStore.purgeUnreferenced(ctx()));
                c.resolve(r);
            }
        }).start();
    }

    // ---------- অডিও বাছাই: ফোনের ফাইল-পিকার, বাছা ফাইল অ্যাপের নিজস্ব স্টোরেজে কপি ----------
    @PluginMethod
    public void pickAudio(PluginCall call) {
        Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        i.addCategory(Intent.CATEGORY_OPENABLE);
        i.setType("*/*");
        i.putExtra(Intent.EXTRA_MIME_TYPES, new String[]{"audio/*", "application/ogg"});
        i.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
        startActivityForResult(call, i, "pickResult");
    }

    @ActivityCallback
    private void pickResult(final PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null) {
            JSObject r = new JSObject();
            r.put("cancelled", true);
            r.put("files", new JSArray());
            r.put("failed", new JSArray());
            call.resolve(r);
            return;
        }
        final List<Uri> uris = new ArrayList<>();
        Intent d = result.getData();
        ClipData cd = d.getClipData();
        if (cd != null) { for (int i = 0; i < cd.getItemCount(); i++) uris.add(cd.getItemAt(i).getUri()); }
        else if (d.getData() != null) uris.add(d.getData());

        new Thread(new Runnable() {
            public void run() {
                JSArray files = new JSArray(), failed = new JSArray();
                int idx = 0;
                for (Uri u : uris) {
                    String name = displayName(u);
                    try {
                        files.put(importOne(u, name, idx++));
                    } catch (Exception e) {
                        JSObject f = new JSObject();
                        f.put("name", name);
                        f.put("reason", e.getMessage() == null ? "পড়া যায়নি" : e.getMessage());
                        failed.put(f);
                    }
                }
                JSObject r = new JSObject();
                r.put("cancelled", false);
                r.put("files", files);
                r.put("failed", failed);
                call.resolve(r);
            }
        }).start();
    }

    private String displayName(Uri uri) {
        String name = null;
        Cursor c = null;
        try {
            c = ctx().getContentResolver().query(uri, new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null);
            if (c != null && c.moveToFirst()) name = c.getString(0);
        } catch (Exception ignored) {
        } finally {
            if (c != null) c.close();
        }
        if (name == null || name.isEmpty()) name = uri.getLastPathSegment();
        return name == null || name.isEmpty() ? "audio" : name;
    }

    private static String extOf(String name) {
        int dot = name.lastIndexOf('.');
        if (dot < 0 || dot == name.length() - 1) return "";
        String e = name.substring(dot + 1).toLowerCase();
        return e.matches("[a-z0-9]{1,5}") ? e : "";
    }

    private JSObject importOne(Uri uri, String name, int idx) throws Exception {
        String ext = extOf(name);
        String stored = "a" + Long.toString(System.currentTimeMillis(), 36) + Long.toString(System.nanoTime() % 100000, 36) + idx + (ext.isEmpty() ? "" : "." + ext);
        File dst = new File(VoiceStore.audioDir(ctx()), stored);
        ContentResolver cr = ctx().getContentResolver();
        long total = 0;
        try {
            InputStream in = cr.openInputStream(uri);
            if (in == null) throw new Exception("ফাইল খোলা যায়নি");
            FileOutputStream out = new FileOutputStream(dst);
            try {
                byte[] buf = new byte[16384];
                int n;
                while ((n = in.read(buf)) > 0) {
                    total += n;
                    if (total > MAX_BYTES) throw new Exception("ফাইল খুব বড় (সর্বোচ্চ ৫০ MB)");
                    out.write(buf, 0, n);
                }
            } finally {
                try { out.close(); } catch (Exception ignored) { }
                try { in.close(); } catch (Exception ignored) { }
            }
            long ms = durationMs(dst);
            if (total == 0 || ms <= 0) throw new Exception("এই ফাইল ফোনে বাজানো যায় না (সমর্থিত অডিও নয়)");
            JSObject o = new JSObject();
            o.put("file", stored);
            o.put("name", name);
            o.put("ms", ms);
            o.put("bytes", total);
            return o;
        } catch (Exception e) {
            //noinspection ResultOfMethodCallIgnored
            dst.delete();
            throw e;
        }
    }

    private static long durationMs(File f) {
        MediaMetadataRetriever r = new MediaMetadataRetriever();
        try {
            r.setDataSource(f.getAbsolutePath());
            String d = r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION);
            return d == null ? -1 : Long.parseLong(d);
        } catch (Exception e) {
            return -1;
        } finally {
            try { r.release(); } catch (Exception ignored) { }
        }
    }

    // ---------- প্রিভিউ ----------
    @PluginMethod
    public void play(PluginCall call) {
        Float vol = call.getFloat("volume", 1f);
        Boolean spk = call.getBoolean("speaker", true);
        String err = VoicePlayer.play(ctx(), call.getString("file"), vol == null ? 1f : vol, spk == null || spk, true);
        if (err != null) call.reject(err); else call.resolve();
    }

    @PluginMethod
    public void stopAll(PluginCall call) {
        VoicePlayer.stopAll();
        call.resolve();
    }

    // ---------- অনুমতি ও ওভারলে চালু/বন্ধ ----------
    @PluginMethod
    public void requestOverlayPermission(PluginCall call) {
        try {
            Intent i = new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:" + ctx().getPackageName()));
            getActivity().startActivity(i);
            call.resolve();
        } catch (Exception e) {
            call.reject("সেটিংস খোলা যায়নি। ফোনের সেটিংস > অ্যাপ > এই অ্যাপ > অন্য অ্যাপের ওপরে দেখানো — চালু করুন।");
        }
    }

    @PluginMethod
    public void requestNotificationPermission(PluginCall call) {
        if (notifGranted()) {
            JSObject r = new JSObject();
            r.put("granted", true);
            call.resolve(r);
            return;
        }
        requestPermissionForAlias("notifications", call, "notifResult");
    }

    @PermissionCallback
    private void notifResult(PluginCall call) {
        JSObject r = new JSObject();
        r.put("granted", getPermissionState("notifications") == PermissionState.GRANTED);
        call.resolve(r);
    }

    @PluginMethod
    public void startOverlay(PluginCall call) {
        if (!canDraw()) { call.reject("overlay_permission"); return; }
        try {
            ContextCompat.startForegroundService(ctx(), new Intent(ctx(), OverlayService.class));
            call.resolve();
        } catch (Exception e) {
            call.reject("ভাসমান বাটন চালু করা যায়নি: " + e.getMessage());
        }
    }

    @PluginMethod
    public void stopOverlay(PluginCall call) {
        ctx().stopService(new Intent(ctx(), OverlayService.class));
        call.resolve();
    }
}
