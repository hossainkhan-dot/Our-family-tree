import { useEffect, useMemo, useRef, useState } from "react";
import { App as CapApp } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import { runTopBack } from "./core/back";
import Funnel from "./components/Funnel";
import TreeScreen from "./components/TreeView";
import People, { type PeopleView } from "./components/People";
import Backup from "./components/Backup";
import Manage from "./components/Manage";
import { useDb } from "./db/DbContext";
import { ancestorCount, buildGraph, generationLevels, oldestAncestor } from "./core/relations";
import "./app.css";

type Tab = "home" | "tree" | "people" | "backup" | "more";

const toBn = (n: number | string) => String(n).replace(/\d/g, (d) => "০১২৩৪৫৬৭৮৯"[Number(d)]);

const ICONS: Record<Tab, string> = {
  home: "M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z",
  tree: "M12 3v6m0 0c0 3-6 3-6 7m6-7c0 3 6 3 6 7M6 16v3m12-3v3",
  people: "M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm7 1a2.5 2.5 0 1 0 0-5M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6m1-5.5c2.7 0 5 2 5 5.5",
  backup: "M12 4v10m0 0l-4-4m4 4l4-4M5 19h14",
  more: "M5 6h14M5 12h14M5 18h9",
};
const TABS: { id: Tab; label: string }[] = [
  { id: "home", label: "হোম" },
  { id: "tree", label: "বংশবৃক্ষ" },
  { id: "people", label: "সদস্য" },
  { id: "backup", label: "ব্যাকআপ" },
  { id: "more", label: "আরও" },
];

const STEPS: [boolean, string][] = [
  [true, "ভিত্তি ও GitHub বিল্ড"], [true, "ডিজাইন সিস্টেম"], [true, "ডেটাবেস স্কিমা"],
  [true, "সম্পর্কের লজিক"], [true, "প্রোফাইল ও ফর্ম"], [true, "ট্রি ভিউ"],
  [false, "লগইন (Google), Role ও অনুমোদন — Role/অনুমোদন/History তৈরি, Google লগইন বাকি"], [true, "ব্যাকআপ ও GEDCOM"],
  [false, "মিডিয়া, টাইমলাইন, ম্যাপ, সার্চ"], [false, "Legacy Transfer, Time Capsule, AI"],
];

function Home({ onAdd, onBackup }: { onAdd: () => void; onBackup: () => void }) {
  const { data, ego, lastExport } = useDb();
  const stale = data.people.length > 0 && (!lastExport || Date.now() - Date.parse(lastExport) > 7 * 864e5);
  const g = useMemo(() => buildGraph(data), [data]);
  const [sample, setSample] = useState(false);
  const me = ego ?? data.people[0]?.id ?? null;
  const real = useMemo(() => {
    if (!me) return null;
    const lv = generationLevels(g, me, 5);
    let depth = 0;
    lv.forEach((row, k) => { if (row.some(Boolean)) depth = k; });
    const old = oldestAncestor(g, me);
    const year = old ? g.byId.get(old.id)?.birthYear : null;
    return { levels: lv.slice(0, Math.min(5, depth + 1) + 1), count: ancestorCount(g, me), year };
  }, [g, me]);

  const showReal = !sample && real;
  return (
    <section className="home">
      {stale && <button className="warn" onClick={onBackup}>⚠ {lastExport ? "৭ দিনের বেশি ব্যাকআপ নেওয়া হয়নি" : "এখনো কোনো ফাইল-ব্যাকআপ নেওয়া হয়নি"}। ফোন হারালে তথ্য যাবে, এখনই ব্যাকআপ নিন →</button>}
      <header className="hero-top">
        <p className="hero-label">{sample ? "১৮৭৬ সাল · নমুনা" : showReal ? (real.year ? `${toBn(real.year)} সাল থেকে` : "আপনার বংশধারা") : "আপনার বংশধারা"}</p>
        <p className="hero-num">{sample ? toBn(32) : toBn(showReal ? real.count : 0)}</p>
        <p className="hero-sub">জন পূর্বপুরুষ</p>
      </header>
      {showReal
        ? <Funnel key={`r${real.levels.length}-${real.count}`} gen={real.levels.length - 1} levels={real.levels} />
        : <Funnel key={sample ? "sample" : "empty"} gen={sample ? 5 : 1} unknown={!sample} />}
      <footer className="hero-foot">
        <p>
          {sample ? "এটি শুধু ডিজাইনের নমুনা, আসল তথ্য নয়।"
            : showReal ? `রেকর্ডে মোট ${toBn(data.people.length)} জন সদস্য। বাবা-মা, দাদা-দাদি যোগ করলে রেখা বাড়বে।`
            : "এখনো কোনো সদস্য যোগ হয়নি।"}
        </p>
        <div className="row center">
          {sample ? <button className="btn btn-primary" onClick={() => setSample(false)}>ফিরে যান</button>
            : <button className="btn btn-primary" onClick={onAdd}>{showReal ? "সদস্য যোগ করুন" : "প্রথম সদস্য যোগ করুন"}</button>}
          {!showReal && !sample && <button className="btn" onClick={() => setSample(true)}>নমুনা দেখুন</button>}
        </div>
      </footer>
    </section>
  );
}

function Soon({ title, step, text }: { title: string; step: number; text: string }) {
  return (
    <section className="panel">
      <h1>{title}</h1>
      <p className="muted">{text}</p>
      <p><span className="status pending">ধাপ {toBn(step)}-এ আসছে</span></p>
    </section>
  );
}

function Progress() {
  const done = STEPS.filter(([d]) => d).length;
  return (
    <section className="panel">
      <h1>অগ্রগতি</h1>
      <p className="muted">{toBn(done)}/{toBn(STEPS.length)} ধাপ সম্পন্ন</p>
      <ol className="steps">
        {STEPS.map(([d, name], i) => (
          <li key={name} className={d ? "done" : ""}>
            <span className="mark">{d ? "✓" : toBn(i + 1)}</span>{name}
          </li>
        ))}
      </ol>
    </section>
  );
}

interface Nav { tab: Tab; pv: PeopleView }
const same = (a: Nav, b: Nav) => a.tab === b.tab && JSON.stringify(a.pv) === JSON.stringify(b.pv);
const isForm = (n: Nav) => n.tab === "people" && n.pv.mode === "form";

export default function App() {
  const [nav, setNav] = useState<Nav>({ tab: "home", pv: { mode: "list" } });
  const cur = useRef(nav), stack = useRef<Nav[]>([]), warn = useRef({ form: 0, exit: 0 });
  const [toast, setToast] = useState<string | null>(null);
  const timer = useRef<number>();
  const say = (t: string) => { setToast(t); window.clearTimeout(timer.current); timer.current = window.setTimeout(() => setToast(null), 2200); };
  const show = (n: Nav) => { cur.current = n; setNav(n); window.scrollTo(0, 0); };
  const navTo = (n: Nav) => {
    if (same(cur.current, n)) return;
    stack.current.push(cur.current);
    if (stack.current.length > 40) stack.current.shift();
    show(n);
  };
  const go = (v: PeopleView) => navTo({ tab: "people", pv: v });

  /** Phone back button: close popup > previous screen > home > "press again to exit". */
  const back = () => {
    if (runTopBack()) return;
    const now = Date.now(), c = cur.current;
    if (isForm(c) && now - warn.current.form > 2500) { warn.current.form = now; say("সংরক্ষণ না করে ফিরলে লেখা হারাবে। আবার ব্যাক চাপলে ফিরবে।"); return; }
    let prev = stack.current.pop();
    while (prev && isForm(prev)) prev = stack.current.pop();
    if (prev) { show(prev); return; }
    if (c.tab !== "home") { show({ tab: "home", pv: { mode: "list" } }); return; }
    if (now - warn.current.exit < 2000) { void CapApp.exitApp(); return; }
    warn.current.exit = now;
    say("আবার ব্যাক চাপলে অ্যাপ বন্ধ হবে");
  };
  const backRef = useRef(back); backRef.current = back;
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    let dead = false, handle: { remove: () => Promise<void> } | undefined;
    void CapApp.addListener("backButton", () => backRef.current()).then((h) => { if (dead) void h.remove(); else handle = h; });
    return () => { dead = true; void handle?.remove(); };
  }, []);

  const { tab, pv } = nav;
  return (
    <div className="app">
      <main>
        {tab === "home" && <Home onAdd={() => go({ mode: "form" })} onBackup={() => navTo({ tab: "backup", pv })} />}
        {tab === "tree" && <TreeScreen onAdd={() => go({ mode: "form" })} onOpenProfile={(id) => go({ mode: "profile", id })} />}
        {tab === "people" && <People view={pv} setView={go} />}
        {tab === "backup" && <Backup />}
        {tab === "more" && <Manage progress={<Progress />} />}
      </main>
      {toast && <div className="toast" role="status">{toast}</div>}
      <nav className="tabbar" aria-label="প্রধান মেনু">
        {TABS.map((t) => (
          <button key={t.id} className={tab === t.id ? "active" : ""} onClick={() => navTo({ tab: t.id, pv: t.id === "people" ? { mode: "list" } : pv })}>
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d={ICONS[t.id]} /></svg>
            <span>{t.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
