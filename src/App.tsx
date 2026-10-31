import { useState } from "react";
import Funnel from "./components/Funnel";
import "./app.css";

type Tab = "home" | "tree" | "people" | "progress";

const toBn = (n: number | string) => String(n).replace(/\d/g, (d) => "০১২৩৪৫৬৭৮৯"[Number(d)]);

const ICONS: Record<Tab, string> = {
  home: "M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z",
  tree: "M12 3v6m0 0c0 3-6 3-6 7m6-7c0 3 6 3 6 7M6 16v3m12-3v3",
  people: "M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm7 1a2.5 2.5 0 1 0 0-5M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6m1-5.5c2.7 0 5 2 5 5.5",
  progress: "M5 6h14M5 12h14M5 18h9",
};
const TABS: { id: Tab; label: string }[] = [
  { id: "home", label: "হোম" },
  { id: "tree", label: "বংশবৃক্ষ" },
  { id: "people", label: "সদস্য" },
  { id: "progress", label: "অগ্রগতি" },
];

const STEPS: [boolean, string][] = [
  [true, "ভিত্তি ও GitHub বিল্ড"], [true, "ডিজাইন সিস্টেম"], [true, "ডেটাবেস স্কিমা"],
  [false, "সম্পর্কের লজিক"], [false, "প্রোফাইল ও ফর্ম"], [false, "ট্রি ভিউ"],
  [false, "লগইন, Role ও অনুমোদন"], [false, "ব্যাকআপ ও GEDCOM"],
  [false, "মিডিয়া, টাইমলাইন, ম্যাপ, সার্চ"], [false, "Legacy Transfer, Time Capsule, AI"],
];

function Home() {
  const [sample, setSample] = useState(false);
  return (
    <section className="home">
      <header className="hero-top">
        <p className="hero-label">{sample ? "১৮৭৬ সাল · নমুনা" : "আপনার বংশধারা"}</p>
        <p className="hero-num">{sample ? toBn(32) : toBn(0)}</p>
        <p className="hero-sub">জন পূর্বপুরুষ</p>
      </header>
      <Funnel key={sample ? "sample" : "empty"} gen={sample ? 5 : 1} unknown={!sample} />
      <footer className="hero-foot">
        <p>
          {sample
            ? "এটি শুধু ডিজাইনের নমুনা, আসল তথ্য নয়।"
            : "এখনো কোনো সদস্য যোগ হয়নি। সদস্য যোগের ফর্ম ধাপ ৫-এ আসছে।"}
        </p>
        <button className="btn btn-primary" onClick={() => setSample(!sample)}>
          {sample ? "ফিরে যান" : "নমুনা দেখুন"}
        </button>
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

export default function App() {
  const [tab, setTab] = useState<Tab>("home");
  return (
    <div className="app">
      <main>
        {tab === "home" && <Home />}
        {tab === "tree" && <Soon title="বংশবৃক্ষ" step={6} text="ওপর থেকে নিচে নেমে আসা সোনালি আলোর রেখায় পুরো বংশ দেখা যাবে। জুম, টেনে সরানো, শাখা খোলা-বন্ধ থাকবে।" />}
        {tab === "people" && <Soon title="সদস্য" step={5} text="প্রতিটি সদস্যের পূর্ণ প্রোফাইল, ছবি, দলিল ও উৎসসহ তথ্য এখানে যোগ ও দেখা যাবে।" />}
        {tab === "progress" && <Progress />}
      </main>
      <nav className="tabbar" aria-label="প্রধান মেনু">
        {TABS.map((t) => (
          <button key={t.id} className={tab === t.id ? "active" : ""} onClick={() => setTab(t.id)}>
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d={ICONS[t.id]} /></svg>
            <span>{t.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
