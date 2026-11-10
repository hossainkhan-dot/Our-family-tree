package __PKG__;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.content.res.Configuration;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.PixelFormat;
import android.graphics.drawable.GradientDrawable;
import android.graphics.drawable.StateListDrawable;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.provider.Settings;
import android.util.DisplayMetrics;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.HapticFeedbackConstants;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewConfiguration;
import android.view.WindowManager;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import androidx.core.app.NotificationCompat;

import java.util.ArrayList;
import java.util.List;

/**
 * গেমের ওপরের ভাসমান ভয়েস-বাটন ও প্যানেল।
 *
 * দুটি আলাদা ছোট উইন্ডো (বাটন, প্যানেল) — কোনোটিই পুরো স্ক্রিন ঢাকে না এবং কোনোটিই ফোকাস নেয় না
 * (FLAG_NOT_FOCUSABLE + FLAG_NOT_TOUCH_MODAL), তাই উইন্ডোর বাইরের সব স্পর্শ সরাসরি গেমে যায়।
 *
 * বাটনের ব্যবহার:
 *  - ছোট ট্যাপ            : প্যানেল খোলে/বন্ধ করে (সক্রিয় প্যাকের ভয়েস-বাটন)
 *  - সাইডে টেনে ধরা        : প্যাক-তালিকা খোলে; যে প্যাকের ওপর আঙুল ছাড়বেন সেটি সক্রিয় হয়
 *  - ২–৩ সেকেন্ড চেপে ধরা  : সরানোর মোড (কাঁপে); তারপর যেখানে খুশি টেনে ছাড়ুন
 */
public class OverlayService extends Service {
    static final String ACTION_STOP = "__PKG__.VOICE_STOP";
    private static final String CHANNEL = "gaming_voice";
    private static final int NOTIF_ID = 4711;

    private static volatile boolean running = false;
    static boolean isRunning() { return running; }

    // রং — অ্যাপের কালো-সোনালি থিমের সঙ্গে মেলানো
    private static final int C_BG = 0xF20E0D0B, C_CELL = 0xFF171510, C_LINE = 0xFF8A6D1F, C_GOLD = 0xFFD4AF37,
            C_GOLD_L = 0xFFF0D78C, C_IVORY = 0xFFF3EBD8, C_MUTED = 0xFFA79B80, C_BLACK = 0xFF000000;

    private final Handler h = new Handler(Looper.getMainLooper());
    private WindowManager wm;
    private float density;

    private VoiceStore.Data data = new VoiceStore.Data();
    private String activeId;

    private Bubble bubble;
    private WindowManager.LayoutParams bubbleLp;
    private boolean bubbleAttached;

    private LinearLayout panelRoot;
    private TextView panelTitle;
    private ScrollView panelScroll;
    private LinearLayout panelContent;
    private WindowManager.LayoutParams panelLp;
    private boolean panelAttached, panelOpen, listMode, selecting;
    private long closedAt;
    private final List<View> rowViews = new ArrayList<>();
    private final List<String> rowIds = new ArrayList<>();
    private String hoverId;

    private final VoiceStore.Listener listener = new VoiceStore.Listener() {
        @Override void onPacksChanged() { reload(); }
        @Override void onActiveChanged(String id) { activeId = id; refreshActive(); }
    };

    @Override public IBinder onBind(Intent intent) { return null; }

    @Override public void onCreate() {
        super.onCreate();
        wm = (WindowManager) getSystemService(Context.WINDOW_SERVICE);
        density = getResources().getDisplayMetrics().density;
        createChannel();
        VoiceStore.addListener(listener);
    }

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_STOP.equals(intent.getAction())) {
            stopSelf();
            return START_NOT_STICKY;
        }
        if (!startForegroundSafe()) { stopSelf(); return START_NOT_STICKY; }
        if (bubble == null) {
            if (Build.VERSION.SDK_INT >= 23 && !Settings.canDrawOverlays(this)) { stopSelf(); return START_NOT_STICKY; }
            try { buildUi(); } catch (Exception e) { stopSelf(); return START_NOT_STICKY; }
            running = true;
            VoiceStore.fireRunning(true);
        }
        return START_NOT_STICKY;
    }

    @Override public void onDestroy() {
        hidePanel();
        if (bubbleAttached) { try { wm.removeView(bubble); } catch (Exception ignored) { } bubbleAttached = false; }
        VoicePlayer.stopAll();
        VoiceStore.removeListener(listener);
        h.removeCallbacksAndMessages(null);
        boolean was = running;
        running = false;
        if (was) VoiceStore.fireRunning(false);
        super.onDestroy();
    }

    /** স্ক্রিন ঘুরলে (গেম ল্যান্ডস্কেপে যায়) বাটন স্ক্রিনের ভেতরে ফিরিয়ে আনে। */
    @Override public void onConfigurationChanged(Configuration c) {
        super.onConfigurationChanged(c);
        density = getResources().getDisplayMetrics().density;
        hidePanel();
        if (bubbleAttached) { clampBubble(); update(bubble, bubbleLp); }
    }

    // ---------- নোটিফিকেশন (ফোরগ্রাউন্ড সার্ভিস বাধ্যতামূলক) ----------
    private void createChannel() {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;
        NotificationChannel ch = new NotificationChannel(CHANNEL, "গেমিং ভয়েস", NotificationManager.IMPORTANCE_LOW);
        ch.setShowBadge(false);
        nm.createNotificationChannel(ch);
    }

    private boolean startForegroundSafe() {
        int imm = Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0;
        Intent stop = new Intent(this, OverlayService.class).setAction(ACTION_STOP);
        PendingIntent stopPi = PendingIntent.getService(this, 1, stop, PendingIntent.FLAG_UPDATE_CURRENT | imm);
        NotificationCompat.Builder b = new NotificationCompat.Builder(this, CHANNEL)
                .setSmallIcon(android.R.drawable.ic_lock_silent_mode_off)
                .setContentTitle("গেমিং ভয়েস চালু")
                .setContentText("ভাসমান বাটন সক্রিয় আছে")
                .setOngoing(true)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .addAction(0, "বন্ধ করুন", stopPi);
        Intent open = getPackageManager().getLaunchIntentForPackage(getPackageName());
        if (open != null) b.setContentIntent(PendingIntent.getActivity(this, 2, open, PendingIntent.FLAG_UPDATE_CURRENT | imm));
        Notification n = b.build();
        try {
            if (Build.VERSION.SDK_INT >= 29) startForeground(NOTIF_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
            else startForeground(NOTIF_ID, n);
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    // ---------- মাপ ও হিসাব ----------
    private int dp(float v) { return Math.round(v * density); }
    private int screenW() {
        if (Build.VERSION.SDK_INT >= 30) return wm.getMaximumWindowMetrics().getBounds().width();
        DisplayMetrics m = new DisplayMetrics();
        wm.getDefaultDisplay().getRealMetrics(m);
        return m.widthPixels;
    }
    private int screenH() {
        if (Build.VERSION.SDK_INT >= 30) return wm.getMaximumWindowMetrics().getBounds().height();
        DisplayMetrics m = new DisplayMetrics();
        wm.getDefaultDisplay().getRealMetrics(m);
        return m.heightPixels;
    }
    private WindowManager.LayoutParams newParams(int w, int hgt, boolean watchOutside) {
        int type = Build.VERSION.SDK_INT >= 26 ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY : WindowManager.LayoutParams.TYPE_PHONE;
        int flags = WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL | WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN;
        if (watchOutside) flags |= WindowManager.LayoutParams.FLAG_WATCH_OUTSIDE_TOUCH;
        WindowManager.LayoutParams p = new WindowManager.LayoutParams(w, hgt, type, flags, PixelFormat.TRANSLUCENT);
        p.gravity = Gravity.TOP | Gravity.START;
        return p;
    }
    private void update(View v, WindowManager.LayoutParams p) { try { wm.updateViewLayout(v, p); } catch (Exception ignored) { } }

    private GradientDrawable rect(int fill, int stroke, float radiusDp) {
        GradientDrawable g = new GradientDrawable();
        g.setColor(fill);
        g.setStroke(Math.max(1, dp(1)), stroke);
        g.setCornerRadius(dp(radiusDp));
        return g;
    }

    // ---------- তৈরি ----------
    private void buildUi() {
        reloadData();
        int size = dp(data.cfg.size);
        bubble = new Bubble(this);
        bubble.setAlpha(data.cfg.opacity);
        bubbleLp = newParams(size, size, false);
        int sx = VoiceStore.posX(this), sy = VoiceStore.posY(this);
        bubbleLp.x = sx >= 0 ? sx : screenW() - size - dp(6);
        bubbleLp.y = sy >= 0 ? sy : screenH() / 3;
        clampBubble();
        bubble.setOnTouchListener(new BubbleTouch());
        refreshBubbleLabel();
        wm.addView(bubble, bubbleLp);
        bubbleAttached = true;
        buildPanelShell();
    }

    private void reloadData() {
        data = VoiceStore.parse(VoiceStore.loadJson(this));
        activeId = VoiceStore.activeId(this);
    }

    /** UI থেকে প্যাক/সেটিংস বদলালে ডেটা নতুন করে পড়ে বাটন ও (খোলা থাকলে) প্যানেল হালনাগাদ করে। */
    private void reload() {
        if (bubble == null) return;
        reloadData();
        int size = dp(data.cfg.size);
        bubbleLp.width = size; bubbleLp.height = size;
        bubble.setAlpha(data.cfg.opacity);
        clampBubble();
        if (bubbleAttached) update(bubble, bubbleLp);
        refreshBubbleLabel();
        if (panelOpen) showPanel(listMode, false);
    }

    private void refreshActive() {
        if (bubble == null) return;
        refreshBubbleLabel();
        if (panelOpen) showPanel(false, false);
    }

    private void refreshBubbleLabel() {
        VoiceStore.Pack p = VoiceStore.activePack(data, activeId);
        bubble.setLabel(p == null || p.name == null || p.name.isEmpty() ? "" : new String(Character.toChars(p.name.codePointAt(0))));
    }

    private void clampBubble() {
        int size = bubbleLp.width;
        bubbleLp.x = Math.max(0, Math.min(screenW() - size, bubbleLp.x));
        bubbleLp.y = Math.max(0, Math.min(screenH() - size, bubbleLp.y));
    }

    // ---------- প্যানেল ----------
    private void buildPanelShell() {
        panelRoot = new LinearLayout(this);
        panelRoot.setOrientation(LinearLayout.VERTICAL);
        panelRoot.setPadding(dp(8), dp(8), dp(8), dp(8));
        panelRoot.setBackground(rect(C_BG, C_LINE, 14));

        LinearLayout head = new LinearLayout(this);
        head.setOrientation(LinearLayout.HORIZONTAL);
        head.setGravity(Gravity.CENTER_VERTICAL);

        panelTitle = new TextView(this);
        panelTitle.setTextColor(C_GOLD_L);
        panelTitle.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14);
        panelTitle.setTypeface(panelTitle.getTypeface(), android.graphics.Typeface.BOLD);
        panelTitle.setSingleLine(true);
        panelTitle.setEllipsize(android.text.TextUtils.TruncateAt.END);
        panelTitle.setPadding(dp(6), dp(6), dp(6), dp(6));
        panelTitle.setOnClickListener(v -> showPanel(!listMode, false));
        head.addView(panelTitle, new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f));

        TextView close = new TextView(this);
        close.setText("✕");
        close.setTextColor(C_MUTED);
        close.setTextSize(TypedValue.COMPLEX_UNIT_SP, 16);
        close.setGravity(Gravity.CENTER);
        close.setOnClickListener(v -> hidePanel());
        head.addView(close, new LinearLayout.LayoutParams(dp(40), dp(36)));
        panelRoot.addView(head, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT));

        panelScroll = new ScrollView(this);
        panelScroll.setVerticalScrollBarEnabled(false);
        panelContent = new LinearLayout(this);
        panelContent.setOrientation(LinearLayout.VERTICAL);
        panelScroll.addView(panelContent, new ScrollView.LayoutParams(ScrollView.LayoutParams.MATCH_PARENT, ScrollView.LayoutParams.WRAP_CONTENT));
        panelRoot.addView(panelScroll, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT));

        // গেমের অন্য কোথাও ছুঁলে প্যানেল সরে যায়; স্পর্শটি গেমেই পৌঁছায় (আমরা এটি আটকাই না)।
        panelRoot.setOnTouchListener((v, e) -> {
            if (e.getActionMasked() == MotionEvent.ACTION_OUTSIDE && data.cfg.outsideClose && !selecting) {
                hidePanel();
                closedAt = System.currentTimeMillis();
            }
            return false;
        });
    }

    /** @param asList true হলে প্যাক-তালিকা, false হলে সক্রিয় প্যাকের ভয়েস-বাটন। */
    private void showPanel(boolean asList, boolean fromSelect) {
        if (bubble == null || panelRoot == null) return;
        listMode = asList;
        panelOpen = true;
        VoiceStore.Pack act = VoiceStore.activePack(data, activeId);
        panelTitle.setText(asList ? "Voice Pack বাছুন" : (act == null ? "Voice Pack নেই" : act.name + "  ▾"));

        int sw = screenW(), sh = screenH();
        int panelW = Math.min(dp(300), sw - dp(16));
        int maxScrollH = Math.max(dp(80), Math.min(sh - dp(24), (int) (sh * 0.8f)) - dp(70));

        panelContent.removeAllViews();
        rowViews.clear(); rowIds.clear(); hoverId = null;
        if (asList) fillPackList(panelW); else fillCommands(panelW, act);

        panelContent.measure(View.MeasureSpec.makeMeasureSpec(panelW - dp(16), View.MeasureSpec.EXACTLY),
                View.MeasureSpec.makeMeasureSpec(0, View.MeasureSpec.UNSPECIFIED));
        panelScroll.getLayoutParams().height = Math.min(panelContent.getMeasuredHeight(), maxScrollH);
        panelScroll.requestLayout();
        int panelH = dp(8) + dp(36) + panelScroll.getLayoutParams().height + dp(8) + dp(4);

        boolean fresh = !panelAttached;
        if (fresh) panelLp = newParams(panelW, WindowManager.LayoutParams.WRAP_CONTENT, data.cfg.outsideClose && !fromSelect);
        panelLp.width = panelW;
        int gap = dp(8), size = bubbleLp.width;
        if (sw - (bubbleLp.x + size) >= panelW + gap) panelLp.x = bubbleLp.x + size + gap;
        else if (bubbleLp.x >= panelW + gap) panelLp.x = bubbleLp.x - panelW - gap;
        else panelLp.x = Math.max(0, Math.min(sw - panelW, bubbleLp.x));
        panelLp.y = Math.max(dp(4), Math.min(sh - panelH - dp(4), bubbleLp.y + size / 2 - panelH / 2));
        panelFrameH = panelH;
        try {
            if (fresh) { wm.addView(panelRoot, panelLp); panelAttached = true; }
            else wm.updateViewLayout(panelRoot, panelLp);
        } catch (Exception e) {
            panelAttached = false; panelOpen = false;
        }
    }
    private int panelFrameH;

    private void hidePanel() {
        panelOpen = false; selecting = false; hoverId = null;
        if (panelAttached) { try { wm.removeView(panelRoot); } catch (Exception ignored) { } panelAttached = false; }
    }

    private TextView cell(String text, int widthPx, int heightPx) {
        TextView t = new TextView(this);
        t.setText(text);
        t.setTextColor(C_IVORY);
        t.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13);
        t.setGravity(Gravity.CENTER);
        t.setMaxLines(2);
        t.setEllipsize(android.text.TextUtils.TruncateAt.END);
        t.setPadding(dp(6), dp(4), dp(6), dp(4));
        StateListDrawable sl = new StateListDrawable();
        sl.addState(new int[]{android.R.attr.state_pressed}, rect(C_GOLD, C_GOLD_L, 10));
        sl.addState(new int[]{}, rect(C_CELL, C_LINE, 10));
        t.setBackground(sl);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(widthPx, heightPx);
        lp.setMargins(dp(3), dp(3), dp(3), dp(3));
        t.setLayoutParams(lp);
        return t;
    }

    private void fillCommands(int panelW, VoiceStore.Pack act) {
        if (act == null) { note("কোনো Voice Pack নেই। অ্যাপ খুলে একটি তৈরি করুন।"); return; }
        List<VoiceStore.Cmd> playable = new ArrayList<>();
        for (VoiceStore.Cmd c : act.cmds) if (c.file != null && !c.file.isEmpty()) playable.add(c);
        if (playable.isEmpty()) { note("এই প্যাকে কোনো অডিও যোগ করা হয়নি। অ্যাপ খুলে অডিও যোগ করুন।"); return; }
        int cols = 3, cellW = (panelW - dp(16)) / cols - dp(6);
        LinearLayout row = null;
        for (int i = 0; i < playable.size(); i++) {
            if (i % cols == 0) {
                row = new LinearLayout(this);
                row.setOrientation(LinearLayout.HORIZONTAL);
                panelContent.addView(row, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT));
            }
            final VoiceStore.Cmd c = playable.get(i);
            TextView t = cell(c.label == null || c.label.isEmpty() ? "▶" : c.label, cellW, dp(50));
            t.setOnClickListener(v -> {
                v.performHapticFeedback(HapticFeedbackConstants.KEYBOARD_TAP);
                String err = VoicePlayer.play(OverlayService.this, c.file, data.cfg.volume, data.cfg.speaker, data.cfg.interrupt);
                if (err != null) Toast.makeText(OverlayService.this, err, Toast.LENGTH_SHORT).show();
                else if (data.cfg.autoClose) hidePanel();
            });
            row.addView(t);
        }
    }

    private void fillPackList(int panelW) {
        if (data.packs.isEmpty()) { note("কোনো Voice Pack নেই। অ্যাপ খুলে একটি তৈরি করুন।"); return; }
        VoiceStore.Pack act = VoiceStore.activePack(data, activeId);
        for (final VoiceStore.Pack p : data.packs) {
            boolean on = act != null && act.id.equals(p.id);
            TextView t = cell((on ? "●  " : "") + p.name, panelW - dp(16) - dp(6), dp(46));
            t.setMaxLines(1);
            t.setGravity(Gravity.CENTER_VERTICAL | Gravity.START);
            if (on) t.setTextColor(C_GOLD_L);
            t.setOnClickListener(v -> activate(p.id, p.name));
            panelContent.addView(t);
            rowViews.add(t); rowIds.add(p.id);
        }
    }

    private void note(String s) {
        TextView t = new TextView(this);
        t.setText(s);
        t.setTextColor(C_MUTED);
        t.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13);
        t.setPadding(dp(6), dp(8), dp(6), dp(8));
        panelContent.addView(t);
    }

    private void activate(String id, String name) {
        VoicePlayer.stopAll();                // আগের প্যাকের বাজতে থাকা শব্দ বন্ধ
        VoiceStore.setActive(this, id);       // অ্যাপের UI-ও জানতে পারে
        Toast.makeText(this, "সক্রিয়: " + name, Toast.LENGTH_SHORT).show();
        listMode = false;
        if (selecting) hidePanel();
    }

    // ---------- টেনে-বাছাই: আঙুল কোন প্যাকের ওপর ----------
    private void highlightAt(float rawX, float rawY) {
        String found = null;
        boolean inPanel = panelAttached && rawX >= panelLp.x && rawX <= panelLp.x + panelLp.width
                && rawY >= panelLp.y && rawY <= panelLp.y + panelFrameH;
        int[] loc = new int[2];
        for (int i = 0; i < rowViews.size(); i++) {
            View v = rowViews.get(i);
            boolean hit = false;
            if (inPanel) {
                v.getLocationOnScreen(loc);
                hit = rawX >= loc[0] && rawX <= loc[0] + v.getWidth() && rawY >= loc[1] && rawY <= loc[1] + v.getHeight();
            }
            TextView t = (TextView) v;
            if (hit) { found = rowIds.get(i); t.setBackground(rect(C_GOLD, C_GOLD_L, 10)); t.setTextColor(C_BLACK); }
            else { t.setBackground(rect(C_CELL, C_LINE, 10)); t.setTextColor(C_IVORY); }
        }
        if (found != null && !found.equals(hoverId)) bubble.performHapticFeedback(HapticFeedbackConstants.KEYBOARD_TAP);
        hoverId = found;
    }

    // ---------- বাটনের স্পর্শ ----------
    private final class BubbleTouch implements View.OnTouchListener {
        private float downX, downY;
        private int startX, startY;
        private boolean moving;
        private final int slop = ViewConfiguration.get(OverlayService.this).getScaledTouchSlop();
        private final Runnable holdFired = new Runnable() {
            @Override public void run() {
                if (selecting) return;
                moving = true;
                bubble.setMoveMode(true);
                bubble.performHapticFeedback(HapticFeedbackConstants.LONG_PRESS);
                if (panelOpen) hidePanel();
            }
        };

        @Override public boolean onTouch(View v, MotionEvent e) {
            switch (e.getActionMasked()) {
                case MotionEvent.ACTION_DOWN:
                    downX = e.getRawX(); downY = e.getRawY();
                    startX = bubbleLp.x; startY = bubbleLp.y;
                    moving = false; selecting = false;
                    h.postDelayed(holdFired, data.cfg.holdMs);
                    return true;
                case MotionEvent.ACTION_MOVE: {
                    float dx = e.getRawX() - downX, dy = e.getRawY() - downY;
                    if (moving) {
                        bubbleLp.x = startX + Math.round(dx);
                        bubbleLp.y = startY + Math.round(dy);
                        clampBubble();
                        update(bubble, bubbleLp);
                    } else if (selecting) {
                        highlightAt(e.getRawX(), e.getRawY());
                    } else if (Math.hypot(dx, dy) > slop * 1.5f) {
                        h.removeCallbacks(holdFired);
                        selecting = true;
                        showPanel(true, true);
                        highlightAt(e.getRawX(), e.getRawY());
                    }
                    return true;
                }
                case MotionEvent.ACTION_UP:
                case MotionEvent.ACTION_CANCEL: {
                    h.removeCallbacks(holdFired);
                    boolean cancel = e.getActionMasked() == MotionEvent.ACTION_CANCEL;
                    if (moving) {
                        moving = false;
                        bubble.setMoveMode(false);
                        VoiceStore.setPos(OverlayService.this, bubbleLp.x, bubbleLp.y);
                    } else if (selecting) {
                        String id = hoverId;
                        selecting = false;
                        hidePanel();
                        if (!cancel && id != null) {
                            for (VoiceStore.Pack p : data.packs) if (p.id.equals(id)) { activate(p.id, p.name); break; }
                        }
                    } else if (!cancel) {
                        if (panelOpen) hidePanel();
                        else if (System.currentTimeMillis() - closedAt > 400) showPanel(false, false);
                    }
                    return true;
                }
                default:
                    return true;
            }
        }
    }

    // ---------- ভাসমান বাটনের চেহারা ----------
    private static final class Bubble extends View {
        private final Paint fill = new Paint(Paint.ANTI_ALIAS_FLAG), ring = new Paint(Paint.ANTI_ALIAS_FLAG), glow = new Paint(Paint.ANTI_ALIAS_FLAG), text = new Paint(Paint.ANTI_ALIAS_FLAG);
        private String label = "";
        private boolean moveMode;

        Bubble(Context c) {
            super(c);
            fill.setColor(0xF2000000);
            ring.setStyle(Paint.Style.STROKE);
            glow.setStyle(Paint.Style.STROKE);
            text.setColor(C_GOLD);
            text.setTextAlign(Paint.Align.CENTER);
            text.setFakeBoldText(true);
        }
        void setLabel(String s) { label = s == null ? "" : s; invalidate(); }
        void setMoveMode(boolean on) { moveMode = on; invalidate(); }

        @Override protected void onDraw(Canvas cv) {
            float w = getWidth(), hh = getHeight(), r = Math.min(w, hh) / 2f, d = getResources().getDisplayMetrics().density;
            float sw = (moveMode ? 3.5f : 2f) * d;
            if (moveMode) {
                glow.setColor(0x55F0D78C);
                glow.setStrokeWidth(4f * d);
                cv.drawCircle(w / 2f, hh / 2f, r - 2f * d, glow);
            }
            cv.drawCircle(w / 2f, hh / 2f, r - sw, fill);
            ring.setColor(moveMode ? C_GOLD_L : C_GOLD);
            ring.setStrokeWidth(sw);
            cv.drawCircle(w / 2f, hh / 2f, r - sw, ring);
            String g = label.isEmpty() ? "♪" : label;
            text.setTextSize(r * 0.95f);
            Paint.FontMetrics fm = text.getFontMetrics();
            cv.drawText(g, w / 2f, hh / 2f - (fm.ascent + fm.descent) / 2f, text);
        }
    }
}
