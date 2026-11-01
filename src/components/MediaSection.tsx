import { useCallback, useEffect, useState } from "react";
import { toBn } from "../core/relations";
import { can, currentMember } from "../db/access";
import { useDb } from "../db/DbContext";
import { addMedia, mediaFor, readMedia, removeMediaFromPerson, type MediaRow } from "../db/media";
import { idbMediaStore } from "../db/mediaStore";
import { explainError } from "../db/repo";

function Thumb({ m, onOpen }: { m: MediaRow; onOpen: () => void }) {
  const [url, setUrl] = useState<string | null>(null), [state, setState] = useState<"load" | "missing" | "bad" | "ok">("load");
  useEffect(() => {
    let dead = false, u: string | null = null;
    readMedia(idbMediaStore, m.sha256).then((b) => {
      if (dead) return;
      if (!b) { setState("missing"); return; }
      if (m.kind === "photo") { u = URL.createObjectURL(new Blob([b as BlobPart], { type: m.mime_type ?? "image/jpeg" })); setUrl(u); }
      setState("ok");
    }).catch(() => { if (!dead) setState("bad"); });
    return () => { dead = true; if (u) URL.revokeObjectURL(u); };
  }, [m.sha256, m.kind, m.mime_type]);
  return (
    <button className="snap" style={{ flexDirection: "column", alignItems: "stretch", padding: 6 }} onClick={onOpen} disabled={state !== "ok"}>
      {url ? <img src={url} alt={m.title ?? m.file_name} loading="lazy" style={{ width: "100%", aspectRatio: "1", objectFit: "cover", borderRadius: 6 }} />
        : <div className="muted small" style={{ aspectRatio: "1", display: "grid", placeItems: "center", textAlign: "center" }}>{state === "missing" ? "এই ফোনে ফাইল নেই (সিঙ্ক বা ব্যাকআপ থেকে আনুন)" : state === "bad" ? "ফাইল নষ্ট" : m.file_name}</div>}
      <span className="small">{m.title ?? m.file_name}</span>
    </button>
  );
}

/** সদস্যের ছবি/ডকুমেন্ট। ফাইল ডেটাবেসের বাইরে নিরাপদে থাকে, SHA-256 দিয়ে যাচাই হয়; ব্যাকআপ ZIP ও Drive সিঙ্কে যায়। */
export default function MediaSection({ personId }: { personId: string }) {
  const { db, reload, data } = useDb();
  const [rows, setRows] = useState<MediaRow[]>([]), [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null), [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<MediaRow | null>(null), [openUrl, setOpenUrl] = useState<string | null>(null);
  const [title, setTitle] = useState(""), [year, setYear] = useState("");
  const me = currentMember(db), canAdd = can(me, "edit_direct");
  const refresh = useCallback(() => setRows(mediaFor(db, personId)), [db, personId]);
  useEffect(refresh, [refresh, data]);
  useEffect(() => {
    let u: string | null = null, dead = false;
    setOpenUrl(null);
    if (open) void readMedia(idbMediaStore, open.sha256).then((b) => { if (b && !dead) { u = URL.createObjectURL(new Blob([b as BlobPart], { type: open.mime_type ?? "application/octet-stream" })); setOpenUrl(u); } });
    return () => { dead = true; if (u) URL.revokeObjectURL(u); };
  }, [open]);

  const pick = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true); setMsg(null);
    try {
      let n = 0, dup = 0;
      for (const f of Array.from(files)) {
        const r = await addMedia(db, idbMediaStore, { name: f.name, mime: f.type, bytes: new Uint8Array(await f.arrayBuffer()), title, year: year ? Number(year) : null, personIds: [personId] }, me?.id ?? "owner");
        if (r.duplicate) dup++; else n++;
      }
      setTitle(""); setYear(""); reload(); refresh();
      setMsg({ ok: true, text: `${toBn(n)}টি যোগ হয়েছে${dup ? `, ${toBn(dup)}টি আগে থেকেই ছিল (এই সদস্যের সঙ্গে যুক্ত করা হয়েছে)` : ""}।` });
    } catch (e) { setMsg({ ok: false, text: explainError(e) }); }
    finally { setBusy(false); }
  };
  return (
    <>
      <h2>ছবি ও ডকুমেন্ট</h2>
      {msg && <p className={msg.ok ? "notice" : "error"} role="status">{msg.text}</p>}
      {rows.length === 0 ? <p className="muted">কোনো ছবি বা ডকুমেন্ট যোগ করা হয়নি।</p> : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>{rows.map((m) => <Thumb key={m.id} m={m} onOpen={() => setOpen(m)} />)}</div>
      )}
      {canAdd && (
        <div className="card">
          <div className="row"><input placeholder="শিরোনাম (ঐচ্ছিক)" value={title} onChange={(e) => setTitle(e.target.value)} /><input inputMode="numeric" placeholder="সাল" value={year} onChange={(e) => setYear(e.target.value.replace(/\D/g, ""))} style={{ width: 90 }} /></div>
          <label className="btn filebtn" style={{ marginTop: 8 }}>{busy ? "যোগ হচ্ছে…" : "ছবি/ডকুমেন্ট যোগ করুন"}
            <input type="file" multiple hidden accept="image/*,application/pdf,.doc,.docx,.txt" disabled={busy} onChange={(e) => { void pick(e.target.files); e.target.value = ""; }} />
          </label>
          <p className="muted small">সর্বোচ্চ ২৫ MB প্রতিটি। একই ফাইল দুবার জমা হয় না।</p>
        </div>
      )}
      {open && (
        <div className="card" role="dialog" aria-label="ফাইল">
          <p><b>{open.title ?? open.file_name}</b>{open.year ? ` · ${toBn(open.year)}` : ""}<br /><span className="muted small">{open.file_name} · SHA-256: {open.sha256.slice(0, 12)}…</span></p>
          {openUrl && open.kind === "photo" && <img src={openUrl} alt={open.title ?? open.file_name} style={{ width: "100%", borderRadius: 8 }} />}
          {openUrl && open.kind !== "photo" && <a className="btn" href={openUrl} download={open.file_name}>নামান / খুলুন</a>}
          <div className="row">
            <button className="btn" onClick={() => setOpen(null)}>বন্ধ</button>
            {canAdd && <button className="btn danger" onClick={() => { removeMediaFromPerson(db, open.id, personId); setOpen(null); reload(); refresh(); }}>এই সদস্য থেকে সরান</button>}
          </div>
        </div>
      )}
    </>
  );
}
