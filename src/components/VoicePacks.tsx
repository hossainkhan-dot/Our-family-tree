import { useCallback, useEffect, useRef, useState } from "react";
import { App as CapApp } from "@capacitor/app";
import { useBack } from "../core/back";
import { toBn } from "../core/relations";
import {
  addPack, addSlots, clearClip, clipCount, deletePack, effectiveActive, fillClips, moveCommand, removeCommand, renameCommand, renamePack,
  sanitize, serialize, setClip, setSettings, emptyState, type Clip, type Settings, type VoiceState,
} from "../voice/model";
import { VP, voiceSupported } from "../voice/native";
import "../voice/voice.css";

interface Status { overlay: boolean; notif: boolean; running: boolean; sdk: number }
type Msg = { ok: boolean; text: string } | null;
const errText = (e: unknown) => (e instanceof Error ? e.message : typeof e === "object" && e && "message" in e ? String((e as { message: unknown }).message) : String(e));
const secs = (ms: number) => `${toBn((ms / 1000).toFixed(1))}s`;

/** স্লাইডার: টানার সময় শুধু স্ক্রিনে বদলায়; আঙুল তুললে একবার সংরক্ষণ হয়। */
function Slider({ label, value, min, max, step, show, onCommit }: { label: string; value: number; min: number; max: number; step: number; show: (v: number) => string; onCommit: (v: number) => void }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  const done = () => { if (v !== value) onCommit(v); };
  return (
    <div className="rng">
      <div><span>{label}</span><b>{show(v)}</b></div>
      <input type="range" min={min} max={max} step={step} value={v} aria-label={label}
        onChange={(e) => setV(Number(e.target.value))} onPointerUp={done} onTouchEnd={done} onKeyUp={done} onBlur={done} />
    </div>
  );
}

export default function VoicePacks() {
  const [st, setSt] = useState<VoiceState | null>(null);
  const stRef = useRef<VoiceState>(emptyState());
  const [activeId, setActiveId] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>({ overlay: false, notif: true, running: false, sdk: 0 });
  const [editId, setEditId] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const [nonce, setNonce] = useState(0);
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  const supported = voiceSupported();
  useBack(editId !== null, () => { setEditId(null); setConfirmDel(false); });

  const refreshStatus = useCallback(async () => {
    try { const s = await VP.getState(); setStatus({ overlay: s.overlayGranted, notif: s.notifGranted, running: s.running, sdk: s.sdk }); setActiveId(s.activeId ?? null); }
    catch { /* পরের বার আবার চেষ্টা হবে */ }
  }, []);

  useEffect(() => {
    if (!supported) return;
    let dead = false;
    const handles: { remove: () => Promise<void> }[] = [];
    void (async () => {
      try {
        const s = await VP.getState();
        if (dead) return;
        const parsed = sanitize(s.json);
        stRef.current = parsed; setSt(parsed); setActiveId(s.activeId ?? null);
        setStatus({ overlay: s.overlayGranted, notif: s.notifGranted, running: s.running, sdk: s.sdk });
      } catch (e) { if (!dead) { setSt(emptyState()); setMsg({ ok: false, text: `ভয়েস প্যাক লোড হয়নি: ${errText(e)}` }); } }
      const add = async (p: Promise<{ remove: () => Promise<void> }>) => { const h = await p; if (dead) void h.remove(); else handles.push(h); };
      await add(VP.addListener("activeChanged", (e) => setActiveId(e.id ?? null)));
      await add(VP.addListener("overlayState", (e) => setStatus((x) => ({ ...x, running: e.running }))));
      await add(CapApp.addListener("appStateChange", (s) => { if (s.isActive) void refreshStatus(); }));
    })();
    return () => { dead = true; handles.forEach((h) => void h.remove()); };
  }, [supported, refreshStatus]);

  if (!supported) return <div className="card"><p><b>গেমিং ভয়েস</b></p><p className="muted small">এই ফিচার শুধু ফোনের (Android) অ্যাপে চলে, কারণ গেমের ওপরে ভাসমান বাটন দেখাতে ফোনের নিজস্ব অনুমতি লাগে।</p></div>;
  if (!st) return <p className="muted">প্রস্তুত হচ্ছে…</p>;

  /** পরিবর্তন সঙ্গে সঙ্গে ফোনে সংরক্ষণ হয় (অ্যাপ বন্ধ করলেও থাকে)। ক্রমানুসারে লেখা হয়, তাই এলোমেলো হয় না। */
  const commit = (next: VoiceState, purge = false) => {
    stRef.current = next; setSt(next);
    chain.current = chain.current.then(async () => { await VP.save({ json: serialize(next) }); if (purge) await VP.purge(); })
      .catch((e) => setMsg({ ok: false, text: `সংরক্ষণ করা যায়নি: ${errText(e)}` }));
  };
  const run = (fn: (s: VoiceState) => VoiceState, purge = false) => {
    try { commit(fn(stRef.current), purge); setMsg(null); return true; }
    catch (e) { setMsg({ ok: false, text: errText(e) }); setNonce((n) => n + 1); return false; }
  };
  const activate = async (id: string) => {
    try { await VP.stopAll(); await VP.setActive({ id }); setActiveId(id); setMsg({ ok: true, text: "সক্রিয় প্যাক বদলেছে।" }); }
    catch (e) { setMsg({ ok: false, text: errText(e) }); }
  };
  const importInto = async (packId: string, cmdId?: string) => {
    setBusy(true); setMsg(null);
    try {
      const r = await VP.pickAudio();
      if (r.cancelled) return;
      const clips: Clip[] = r.files;
      if (clips.length) {
        run((s) => {
          let n = s;
          if (cmdId) { n = setClip(n, packId, cmdId, clips[0]); return clips.length > 1 ? fillClips(n, packId, clips.slice(1)) : n; }
          return fillClips(n, packId, clips);
        }, !!cmdId);
      }
      const bad = r.failed.map((f) => `${f.name}: ${f.reason}`).join("\n");
      setMsg({ ok: !r.failed.length, text: `${toBn(clips.length)}টি অডিও যোগ হয়েছে।${bad ? `\nযোগ হয়নি:\n${bad}` : ""}` });
    } catch (e) { setMsg({ ok: false, text: errText(e) }); }
    finally { setBusy(false); }
  };
  const preview = async (file: string) => {
    try { await VP.play({ file, volume: st.settings.volume, speaker: st.settings.speaker }); }
    catch (e) { setMsg({ ok: false, text: errText(e) }); }
  };
  const start = async () => {
    setMsg(null);
    try {
      if (!status.notif && status.sdk >= 33) await VP.requestNotificationPermission();
      await VP.startOverlay();
      setTimeout(() => void refreshStatus(), 700);
    } catch (e) { const t = errText(e); setMsg({ ok: false, text: t === "overlay_permission" ? "আগে \"অন্য অ্যাপের ওপরে দেখানো\" অনুমতি দিন।" : t }); void refreshStatus(); }
  };
  const stop = async () => { try { await VP.stopOverlay(); setTimeout(() => void refreshStatus(), 400); } catch (e) { setMsg({ ok: false, text: errText(e) }); } };
  const setting = <K extends keyof Settings>(k: K, v: Settings[K]) => run((s) => setSettings(s, { [k]: v } as Partial<Settings>));

  const active = effectiveActive(st, activeId);
  const pack = editId ? st.packs.find((p) => p.id === editId) ?? null : null;

  // ---------------- একটি প্যাকের সম্পাদনা ----------------
  if (pack) {
    return (
      <div className="vp">
        <button className="link back" onClick={() => { setEditId(null); setConfirmDel(false); }}>← সব প্যাক</button>
        {msg && <p className={msg.ok ? "notice" : "error"} role="status" style={{ whiteSpace: "pre-wrap" }}>{msg.text}</p>}
        <div className="field"><span>প্যাকের নাম</span>
          <input key={`${pack.id}${pack.name}${nonce}`} defaultValue={pack.name} maxLength={40}
            onBlur={(e) => { if (e.target.value.trim() !== pack.name) run((s) => renamePack(s, pack.id, e.target.value)); }} />
        </div>
        <div className="row">
          <button className="btn btn-primary" disabled={busy} onClick={() => void importInto(pack.id)}>{busy ? "যোগ হচ্ছে…" : "অডিও যোগ করুন (একসঙ্গে অনেকগুলো)"}</button>
          <button className="btn" onClick={() => run((s) => addSlots(s, pack.id, 1))}>+ Add Voice</button>
        </div>
        <p className="muted small">{toBn(clipCount(pack))}টি অডিও · {toBn(pack.commands.length)}টি বাটন। MP3, WAV, OGG, M4A, AAC, FLAC সহ ফোন যা বাজাতে পারে সবই চলবে। বাটনের কোনো সীমা নেই।</p>
        <div className="list">
          {pack.commands.map((c, i) => (
            <div key={c.id} className={`vp-slot${c.clip ? " has" : ""}`}>
              <input key={`${c.id}${c.label}${nonce}`} defaultValue={c.label} maxLength={40} aria-label="বাটনের নাম" placeholder="বাটনের নাম"
                onBlur={(e) => { if (e.target.value.trim() !== c.label) run((s) => renameCommand(s, pack.id, c.id, e.target.value)); }} />
              <div className={`meta${c.clip ? "" : " empty"}`}>{c.clip ? `${c.clip.name} · ${secs(c.clip.ms)}` : "অডিও নেই"}</div>
              <div className="vp-tools">
                <button className="vp-ico go" disabled={!c.clip} aria-label="শুনুন" onClick={() => c.clip && void preview(c.clip.file)}>▶</button>
                <button className="vp-ico" disabled={busy} onClick={() => void importInto(pack.id, c.id)}>{c.clip ? "বদলান" : "অডিও বাছুন"}</button>
                {c.clip && <button className="vp-ico" onClick={() => run((s) => clearClip(s, pack.id, c.id), true)}>অডিও সরান</button>}
                <button className="vp-ico" disabled={i === 0} aria-label="ওপরে" onClick={() => run((s) => moveCommand(s, pack.id, c.id, -1))}>↑</button>
                <button className="vp-ico" disabled={i === pack.commands.length - 1} aria-label="নিচে" onClick={() => run((s) => moveCommand(s, pack.id, c.id, 1))}>↓</button>
                <button className="vp-ico danger" aria-label="বাটন মুছুন" onClick={() => run((s) => removeCommand(s, pack.id, c.id), true)}>✕</button>
              </div>
            </div>
          ))}
        </div>
        <div className="row" style={{ marginTop: 16 }}>
          <button className="btn" onClick={() => run((s) => addSlots(s, pack.id, 1))}>+ Add Voice</button>
        </div>
        <div className="card">
          {!confirmDel ? <button className="btn danger" onClick={() => setConfirmDel(true)}>এই প্যাক মুছুন</button> : (
            <>
              <p><b>"{pack.name}" মুছবেন?</b><br /><span className="muted small">প্যাক ও এর অডিও ফোন থেকে মুছে যাবে। ফেরানো যাবে না।</span></p>
              <div className="row">
                <button className="btn danger" onClick={async () => {
                  const was = active === pack.id;
                  if (run((s) => deletePack(s, pack.id), true)) { setEditId(null); setConfirmDel(false); if (was) { try { await VP.setActive({ id: null }); setActiveId(null); } catch { /* ঠিক আছে */ } } }
                }}>হ্যাঁ, মুছুন</button>
                <button className="btn" onClick={() => setConfirmDel(false)}>না</button>
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  // ---------------- মূল পর্দা ----------------
  const s = st.settings;
  return (
    <div className="vp">
      {msg && <p className={msg.ok ? "notice" : "error"} role="status" style={{ whiteSpace: "pre-wrap" }}>{msg.text}</p>}

      <div className="card">
        <p><b>ভাসমান গেমিং বাটন</b> {status.running && <span className="status verified">চালু</span>}</p>
        {!status.overlay ? (
          <>
            <p className="muted small">গেমের ওপরে বাটন দেখাতে ফোনের "অন্য অ্যাপের ওপরে দেখানো" অনুমতি লাগে। বাটন চাপলে সেটিংস খুলবে; সেখানে এই অ্যাপ বেছে চালু করে ফিরে আসুন।</p>
            <button className="btn btn-primary" onClick={() => void VP.requestOverlayPermission().catch((e) => setMsg({ ok: false, text: errText(e) }))}>অনুমতি দিন</button>
          </>
        ) : status.running ? (
          <>
            <p className="muted small">এখন গেম খুলুন। বাটন ট্যাপ করলে ভয়েস-প্যানেল, সাইডে টেনে ধরলে প্যাক বদল, ২–৩ সেকেন্ড চেপে ধরলে বাটন সরানো যায়।</p>
            <button className="btn danger" onClick={() => void stop()}>বন্ধ করুন</button>
          </>
        ) : (
          <>
            <p className="muted small">চালু করলে একটি নোটিফিকেশন থাকবে (সিস্টেমের নিয়ম)। মাইক্রোফোন ব্যবহার হয় না।</p>
            <button className="btn btn-primary" onClick={() => void start()}>ভাসমান বাটন চালু করুন</button>
          </>
        )}
      </div>

      <h2 className="sec">আমার Voice Pack</h2>
      {st.packs.length === 0 && <p className="muted">এখনো কোনো প্যাক নেই। নিচে নাম দিয়ে প্রথমটি তৈরি করুন।</p>}
      <div className="list">
        {st.packs.map((p) => (
          <div className="card" key={p.id} style={{ marginTop: 0 }}>
            <p><b>{p.name}</b> {active === p.id && <span className="status verified">সক্রিয়</span>}<br />
              <span className="muted small">{toBn(clipCount(p))}টি অডিও · {toBn(p.commands.length)}টি বাটন</span></p>
            <div className="row">
              <button className="btn btn-primary" onClick={() => { setEditId(p.id); setMsg(null); }}>খুলুন</button>
              {active !== p.id && <button className="btn" onClick={() => void activate(p.id)}>সক্রিয় করুন</button>}
            </div>
          </div>
        ))}
      </div>
      <div className="card">
        <div className="field"><input placeholder="নতুন Voice Pack-এর নাম" value={newName} maxLength={40} onChange={(e) => setNewName(e.target.value)} /></div>
        <button className="btn btn-primary" onClick={() => { const r = (() => { try { return addPack(stRef.current, newName); } catch (e) { setMsg({ ok: false, text: errText(e) }); return null; } })(); if (r) { commit(r.state); setNewName(""); setEditId(r.id); setMsg(null); } }}>Voice Pack তৈরি করুন</button>
        <p className="muted small">নতুন প্যাকে শুরুতে ১২টি ভয়েস-বাটন থাকে। পরে "Add Voice" চেপে যত খুশি বাড়ানো যায়।</p>
      </div>

      <h2 className="sec">সেটিংস</h2>
      <div className="card" style={{ marginTop: 0 }}>
        <Slider label="বাটন সরাতে চেপে ধরার সময়" value={s.holdMs} min={1000} max={3000} step={500} show={(v) => secs(v)} onCommit={(v) => setting("holdMs", v)} />
        <Slider label="বাটনের মাপ" value={s.size} min={40} max={72} step={4} show={(v) => toBn(v)} onCommit={(v) => setting("size", v)} />
        <Slider label="বাটনের স্বচ্ছতা" value={Math.round(s.opacity * 100)} min={40} max={100} step={5} show={(v) => `${toBn(v)}%`} onCommit={(v) => setting("opacity", v / 100)} />
        <Slider label="ক্লিপের ভলিউম" value={Math.round(s.volume * 100)} min={0} max={100} step={5} show={(v) => `${toBn(v)}%`} onCommit={(v) => setting("volume", v / 100)} />
        <label className="check"><input type="checkbox" checked={s.speaker} onChange={(e) => setting("speaker", e.target.checked)} />ফোনের স্পিকারে বাজান (ইয়ারফোন থাকলেও)</label>
        <label className="check"><input type="checkbox" checked={s.interrupt} onChange={(e) => setting("interrupt", e.target.checked)} />নতুন ক্লিপ বাজলে আগেরটি থামুক</label>
        <label className="check"><input type="checkbox" checked={s.outsideClose} onChange={(e) => setting("outsideClose", e.target.checked)} />গেমের অন্য জায়গায় ছুঁলে প্যানেল বন্ধ হোক</label>
        <label className="check"><input type="checkbox" checked={s.autoClose} onChange={(e) => setting("autoClose", e.target.checked)} />ক্লিপ বাজানোর পর প্যানেল বন্ধ হোক</label>
      </div>

      <div className="card">
        <details>
          <summary><b>গেমের ভয়েস-চ্যাটে কীভাবে পৌঁছায়?</b></summary>
          <ul className="vp-info">
            <li>এই অ্যাপ মাইক্রোফোন খোলে না, তাই গেমের মাইক চালু রেখেই ক্লিপ বাজানো যায়; কোনো সংঘাত হয় না।</li>
            <li>Android অন্য অ্যাপের মাইকে সরাসরি অডিও ঢোকাতে দেয় না (root ছাড়া)। তাই ক্লিপ ফোনের স্পিকারে বাজে, আর গেম নিজের মাইক দিয়ে সেটি ধরলে টিমমেটরা শোনে।</li>
            <li>ভালো ফলের জন্য: ফোনের নিজস্ব মাইক ব্যবহার হতে হবে (ব্লুটুথ হেডসেটের মাইক নয়), গেমের ভয়েস-চ্যাট "Open mic" হলে ভালো, আর ক্লিপের ভলিউম বেশি রাখুন।</li>
            <li>গেমের নয়েজ-ক্যানসেলেশন কখনো শব্দ কমিয়ে দেয়। তখন ভলিউম বাড়ান বা স্পিকার মাইকের কাছে রাখুন।</li>
          </ul>
        </details>
      </div>
    </div>
  );
}
