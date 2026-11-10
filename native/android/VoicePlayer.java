package __PKG__;

import android.content.Context;
import android.media.AudioAttributes;
import android.media.AudioDeviceInfo;
import android.media.AudioManager;
import android.media.MediaPlayer;
import android.os.Build;

import java.io.File;
import java.io.FileInputStream;
import java.util.ArrayList;
import java.util.List;

/**
 * ক্লিপ বাজায়। কয়েকটি ইচ্ছাকৃত নিয়ম:
 *  - অডিও-ফোকাস চাওয়া হয় না, তাই গেমের শব্দ থামে না/কমে না (নিজের ক্লিপ গেমের সঙ্গে মিশে বাজে)।
 *  - মাইক্রোফোন খোলা হয় না (RECORD_AUDIO অনুমতিই নেই), তাই গেমের ভয়েস-চ্যাটের মাইকের সঙ্গে সংঘাত নেই।
 *  - সিস্টেম-ভলিউম বদলানো হয় না; শুধু প্লেয়ারের নিজস্ব ভলিউম ব্যবহার হয়।
 */
final class VoicePlayer {
    private static final List<MediaPlayer> ACTIVE = new ArrayList<>();

    private VoicePlayer() {}

    /** @return null হলে বাজানো শুরু হয়েছে; নইলে বাংলা ত্রুটির বার্তা */
    static synchronized String play(Context ctx, String fileName, float volume, boolean speaker, boolean interrupt) {
        File f = VoiceStore.audioFile(ctx, fileName);
        if (f == null || !f.exists()) return "অডিও ফাইলটি এই ফোনে পাওয়া যায়নি।";
        if (interrupt) stopAllLocked();
        final MediaPlayer p = new MediaPlayer();
        FileInputStream in = null;
        try {
            p.setAudioAttributes(new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_MEDIA)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                    .build());
            in = new FileInputStream(f);
            p.setDataSource(in.getFD());
            in.close();
            in = null;
            float v = Math.max(0f, Math.min(1f, volume));
            p.setVolume(v, v);
            if (speaker) preferSpeaker(ctx, p);
            p.setOnPreparedListener(new MediaPlayer.OnPreparedListener() {
                public void onPrepared(MediaPlayer mp) { mp.start(); }
            });
            p.setOnCompletionListener(new MediaPlayer.OnCompletionListener() {
                public void onCompletion(MediaPlayer mp) { release(mp); }
            });
            p.setOnErrorListener(new MediaPlayer.OnErrorListener() {
                public boolean onError(MediaPlayer mp, int what, int extra) { release(mp); return true; }
            });
            ACTIVE.add(p);
            p.prepareAsync();
            return null;
        } catch (Exception e) {
            try { if (in != null) in.close(); } catch (Exception ignored) { }
            try { p.release(); } catch (Exception ignored) { }
            ACTIVE.remove(p);
            return "অডিওটি বাজানো যায়নি।";
        }
    }

    /** ফোনের নিজস্ব স্পিকারে জোর করে বাজায় (Android 9+)। ইয়ারফোন লাগানো থাকলেও গেম ইয়ারফোনে, ক্লিপ স্পিকারে। */
    private static void preferSpeaker(Context ctx, MediaPlayer p) {
        if (Build.VERSION.SDK_INT < 28) return;
        try {
            AudioManager am = (AudioManager) ctx.getSystemService(Context.AUDIO_SERVICE);
            if (am == null) return;
            for (AudioDeviceInfo d : am.getDevices(AudioManager.GET_DEVICES_OUTPUTS)) {
                if (d.getType() == AudioDeviceInfo.TYPE_BUILTIN_SPEAKER) { p.setPreferredDevice(d); return; }
            }
        } catch (Exception ignored) { /* সাধারণ রাউটিংয়ে বাজবে */ }
    }

    private static synchronized void release(MediaPlayer mp) {
        ACTIVE.remove(mp);
        try { mp.release(); } catch (Exception ignored) { }
    }

    static synchronized void stopAll() { stopAllLocked(); }

    private static void stopAllLocked() {
        for (MediaPlayer m : new ArrayList<>(ACTIVE)) {
            try { m.stop(); } catch (Exception ignored) { }
            try { m.release(); } catch (Exception ignored) { }
        }
        ACTIVE.clear();
    }
}
