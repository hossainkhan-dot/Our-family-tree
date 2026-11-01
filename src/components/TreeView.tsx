import { useMemo, useRef, useState, type PointerEvent as PE, type WheelEvent as WE } from "react";
import { buildGraph, focusSet, relation, toBn, type Data, type P } from "../core/relations";
import { useDb } from "../db/DbContext";
import { SAMPLE, SAMPLE_EGO } from "../core/sample";
import { useBack } from "../core/back";

const VBW = 360, VBH = 500, CX = 180, SP = 78;
const ROW = { gp: 70, par: 190, me: 310, kid: 430 };
type Slot = "gp" | "par" | "me" | "kid";
interface N { id: string | null; x: number; y: number; slot: Slot; child?: string }

function Silhouette({ sex, elder, child }: { sex: P["sex"]; elder: boolean; child: boolean }) {
  const s = child ? 0.78 : 1, dy = child ? 4 : 0;
  const hair = elder ? "#e9e2cf" : "#6b5518";
  return (
    <g transform={`translate(0 ${dy}) scale(${s})`} fill="#8a6d1f">
      {sex === "female" && <path d="M-11 -6C-11 -22 11 -22 11 -6L13 8C8 3 -8 3 -13 8Z" fill={hair} />}
      <path d="M-17 24C-17 9 -8 5 0 5C8 5 17 9 17 24Z" />
      <circle cx="0" cy="-6" r="8.5" fill="#a58526" />
      {sex !== "female" && <path d="M-8.5 -8C-8 -17 8 -17 8.5 -8C4 -12 -4 -12 -8.5 -8Z" fill={hair} />}
    </g>
  );
}

const years = (p: P) =>
  p.birthYear == null && p.deathYear == null ? "সাল অজানা"
  : `${p.birthYear != null ? toBn(p.birthYear) : "?"} – ${p.deathYear != null ? toBn(p.deathYear) : p.living ? "বর্তমান" : "?"}`;

export default function TreeScreen({ onAdd, onOpenProfile }: { onAdd: () => void; onOpenProfile: (id: string) => void }) {
  const { data, ego } = useDb();
  const [sample, setSample] = useState(false);
  useBack(sample, () => setSample(false));
  if (sample) return <Canvas data={SAMPLE} startEgo={SAMPLE_EGO} meId={SAMPLE_EGO} badge="নমুনা পরিবার" onBack={() => setSample(false)} />;
  if (data.people.length === 0) {
    return (
      <section className="panel">
        <h1>বংশবৃক্ষ</h1>
        <p className="muted">এখনো কোনো সদস্য যোগ হয়নি। প্রথম সদস্য যোগ করলেই এখানে বংশবৃক্ষ আঁকা শুরু হবে।</p>
        <div className="row">
          <button className="btn btn-primary" onClick={onAdd}>প্রথম সদস্য যোগ করুন</button>
          <button className="btn" onClick={() => setSample(true)}>নমুনা দেখুন</button>
        </div>
      </section>
    );
  }
  const start = ego ?? data.people[0].id;
  return <Canvas key={start} data={data} startEgo={start} meId={ego ?? ""} onOpenProfile={onOpenProfile} />;
}

function Canvas({ data, startEgo, meId, badge, onBack, onOpenProfile }:
  { data: Data; startEgo: string; meId: string; badge?: string; onBack?: () => void; onOpenProfile?: (id: string) => void }) {
  const g = useMemo(() => buildGraph(data), [data]);
  const [egoState, setEgo] = useState(startEgo);
  const ego = g.byId.has(egoState) ? egoState : startEgo;
  const [sel, setSel] = useState<string | null>(null);
  useBack(!!sel, () => setSel(null));
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const svgRef = useRef<SVGSVGElement>(null);
  const ptrs = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef(0);
  const moved = useRef(0);

  const f = useMemo(() => focusSet(g, ego), [g, ego]);
  const { nodes, pos } = useMemo(() => {
    const nodes: N[] = [], pos = new Map<string, { x: number; y: number }>();
    const add = (id: string | null, x: number, y: number, slot: Slot, child?: string) => {
      if (id && pos.has(id)) return;   // a person is drawn once, however many ways they are related
      nodes.push({ id, x, y, slot, child });
      if (id) pos.set(id, { x, y });
    };
    const [fa, mo] = f.parents;
    add(ego, CX, ROW.me, "me");
    f.siblings.forEach((s, i) => add(s, CX - SP * (i + 1), ROW.me, "me"));
    f.spouses.forEach((s, i) => add(s, CX + SP * (i + 1), ROW.me, "me"));
    f.children.forEach((c, i) => add(c, CX + (i - (f.children.length - 1) / 2) * SP, ROW.kid, "kid"));
    add(fa, CX - 80, ROW.par, "par", ego);
    add(mo, CX + 80, ROW.par, "par", ego);
    const gx = [CX - 125, CX - 35, CX + 35, CX + 125];
    f.grandparents.forEach((gp, i) => {
      const parent = i < 2 ? fa : mo;
      if (parent) add(gp, gx[i], ROW.gp, "gp", parent);
    });
    return { nodes, pos };
  }, [f, ego]);

  const scale = () => VBW / svgRef.current!.getBoundingClientRect().width;
  const zoomAt = (px: number, py: number, fac: number) =>
    setView((v) => {
      const k = Math.min(3, Math.max(0.4, v.k * fac)), r = k / v.k;
      return { k, x: px - (px - v.x) * r, y: py - (py - v.y) * r };
    });
  const center = (cx: number, cy: number) => {
    const r = svgRef.current!.getBoundingClientRect(), s = VBW / r.width;
    return { x: (cx - r.left) * s, y: (cy - r.top) * s };
  };

  const down = (e: PE) => {
    ptrs.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    moved.current = 0;
    if (ptrs.current.size === 2) {
      const [a, b] = [...ptrs.current.values()];
      pinch.current = Math.hypot(a.x - b.x, a.y - b.y);
    }
  };
  const move = (e: PE) => {
    const prev = ptrs.current.get(e.pointerId);
    if (!prev) return;
    const cur = { x: e.clientX, y: e.clientY };
    ptrs.current.set(e.pointerId, cur);
    if (ptrs.current.size === 1) {
      const s = scale();
      moved.current += Math.abs(cur.x - prev.x) + Math.abs(cur.y - prev.y);
      setView((v) => ({ ...v, x: v.x + (cur.x - prev.x) * s, y: v.y + (cur.y - prev.y) * s }));
    } else if (ptrs.current.size === 2) {
      const [a, b] = [...ptrs.current.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch.current > 0) { const m = center((a.x + b.x) / 2, (a.y + b.y) / 2); zoomAt(m.x, m.y, d / pinch.current); }
      pinch.current = d;
      moved.current += 10;
    }
  };
  const up = (e: PE) => { ptrs.current.delete(e.pointerId); pinch.current = 0; };
  const wheel = (e: WE) => { const m = center(e.clientX, e.clientY); zoomAt(m.x, m.y, e.deltaY < 0 ? 1.12 : 0.89); };
  const pick = (id: string) => { if (moved.current <= 6) setSel(id); };

  const person = (id: string) => g.byId.get(id)!;
  if (sel && !g.byId.has(sel)) setSel(null);
  const label = (id: string) => (id === ego ? (ego === meId ? "আপনি" : "কেন্দ্র") : relation(g, ego, id) ?? "সম্পর্ক অজানা");
  const selP = sel ? person(sel) : null;
  const drawn = new Set<string>();
  const once = (k: string) => (drawn.has(k) ? false : (drawn.add(k), true));

  return (
    <section className="treebox-wrap">
      <div className="tree-head">
        {onBack ? <button className="btn" onClick={onBack}>ফিরে যান</button> : <h1 className="tree-title">বংশবৃক্ষ</h1>}
        {badge && <span className="status pending">{badge}</span>}
      </div>
      <div className="treebox">
        <svg ref={svgRef} className="tree-svg" viewBox={`0 0 ${VBW} ${VBH}`}
          onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onPointerLeave={up} onWheel={wheel}>
          <defs><clipPath id="av"><circle r="25" /></clipPath></defs>
          <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
            {nodes.map((n) => {
              if (!n.id) {
                const c = n.child ? pos.get(n.child) : undefined;
                return c ? <path key={`ph${n.x}-${n.y}`} className="tree-line placeholder" d={`M${n.x} ${n.y + 26}C${n.x} ${(n.y + c.y) / 2},${c.x} ${(n.y + c.y) / 2},${c.x} ${c.y - 26}`} /> : null;
              }
              return (g.parents.get(n.id) ?? []).map((e) => {
                const p = pos.get(e.parent);
                if (!p || !once(`${e.parent}>${n.id}`)) return null;
                const m = (p.y + n.y) / 2;
                return <path key={`${e.parent}-${n.id}`} className="tree-line" d={`M${p.x} ${p.y + 26}C${p.x} ${m},${n.x} ${m},${n.x} ${n.y - 26}`} />;
              });
            })}
            {data.unions.map((u) => {
              const a = pos.get(u.a), b = pos.get(u.b);
              return a && b && a.y === b.y && once([u.a, u.b].sort().join("+")) ? <path key={u.a + u.b} className="tree-line" d={`M${a.x + 26} ${a.y}L${b.x - 26} ${b.y}`} /> : null;
            })}
            {nodes.map((n, i) => {
              if (!n.id) {
                return (
                  <g key={`u${i}`} transform={`translate(${n.x} ${n.y})`}>
                    <circle r="25" className="node-unknown" />
                    <text y="4" textAnchor="middle" className="node-q">?</text>
                    <text y="44" textAnchor="middle" className="node-sub">অজানা</text>
                  </g>
                );
              }
              const p = person(n.id);
              const elder = n.slot === "gp" || (n.slot === "par");
              return (
                <g key={n.id} transform={`translate(${n.x} ${n.y})`} className={`node${n.id === ego ? " ego" : ""}${n.id === sel ? " sel" : ""}`}
                  role="button" tabIndex={0} aria-label={p.name} onClick={() => pick(n.id!)}
                  onKeyDown={(e) => { if (e.key === "Enter") setSel(n.id); }}>
                  <circle r="26" className="node-ring" />
                  <g clipPath="url(#av)">
                    <rect x="-26" y="-26" width="52" height="52" fill="#171510" />
                    {p.photo ? <image href={p.photo} x="-26" y="-26" width="52" height="52" preserveAspectRatio="xMidYMid slice" />
                      : <Silhouette sex={p.sex} elder={elder} child={n.slot === "kid"} />}
                  </g>
                  <text y="44" textAnchor="middle" className="node-name">{(p.short ?? p.name).slice(0, 9)}</text>
                  <text y="58" textAnchor="middle" className="node-sub">{label(n.id)}</text>
                </g>
              );
            })}
          </g>
        </svg>
        <div className="tools">
          <button aria-label="বড় করুন" onClick={() => zoomAt(VBW / 2, VBH / 2, 1.3)}>＋</button>
          <button aria-label="ছোট করুন" onClick={() => zoomAt(VBW / 2, VBH / 2, 0.77)}>－</button>
          <button aria-label="আগের অবস্থা" onClick={() => setView({ x: 0, y: 0, k: 1 })}>⌖</button>
        </div>
        {selP && (
          <div className="sheet" role="dialog" aria-label={selP.name}>
            <h2>{selP.name}</h2>
            <p className="muted">{label(selP.id)} · {years(selP)}</p>
            
            <div className="row">
              {onOpenProfile && <button className="btn" onClick={() => onOpenProfile(selP.id)}>প্রোফাইল দেখুন</button>}
              {selP.id !== ego && <button className="btn btn-primary" onClick={() => { setEgo(selP.id); setSel(null); setView({ x: 0, y: 0, k: 1 }); }}>এঁকে কেন্দ্র করুন</button>}
              <button className="btn" onClick={() => setSel(null)}>বন্ধ করুন</button>
            </div>
          </div>
        )}
      </div>
      <p className="muted hint">দুই আঙুলে জুম, এক আঙুলে টেনে সরান। কারও ওপর চাপলে বিস্তারিত দেখাবে।</p>
    </section>
  );
}
