// Pure relationship engine: no database, no UI. Works on plain arrays so it can be tested anywhere.
export type Sex = "male" | "female" | "other" | "unknown";
export type ParentKind = "biological" | "adoptive" | "step" | "foster" | "guardian" | "unknown";

export interface P {
  id: string; sex: Sex; name: string; short?: string;
  birthYear?: number | null; deathYear?: number | null; living?: boolean | null; photo?: string | null;
}
export interface Edge { parent: string; child: string; kind: ParentKind; role: "father" | "mother" | "parent" }
export interface Union { a: string; b: string }
export interface Data { people: P[]; edges: Edge[]; unions: Union[] }

export interface Graph {
  byId: Map<string, P>;
  parents: Map<string, Edge[]>;
  children: Map<string, Edge[]>;
  spouses: Map<string, string[]>;
}

const BLOOD: ParentKind[] = ["biological", "adoptive", "unknown"];
const push = <T,>(m: Map<string, T[]>, k: string, v: T) => { const a = m.get(k); if (a) a.push(v); else m.set(k, [v]); };

export function buildGraph(d: Data): Graph {
  const g: Graph = { byId: new Map(), parents: new Map(), children: new Map(), spouses: new Map() };
  for (const p of d.people) g.byId.set(p.id, p);
  for (const e of d.edges) { push(g.parents, e.child, e); push(g.children, e.parent, e); }
  for (const u of d.unions) { push(g.spouses, u.a, u.b); push(g.spouses, u.b, u.a); }
  return g;
}

export const toBn = (n: number | string) => String(n).replace(/\d/g, (x) => "০১২৩৪৫৬৭৮৯"[Number(x)]);

const bloodParents = (g: Graph, id: string) => (g.parents.get(id) ?? []).filter((e) => BLOOD.includes(e.kind));
const sexOf = (g: Graph, id: string): Sex => g.byId.get(id)?.sex ?? "unknown";

export function fatherOf(g: Graph, id: string): string | null {
  const e = bloodParents(g, id).find((x) => x.role === "father" || (x.role === "parent" && sexOf(g, x.parent) === "male"));
  return e ? e.parent : null;
}
export function motherOf(g: Graph, id: string): string | null {
  const e = bloodParents(g, id).find((x) => x.role === "mother" || (x.role === "parent" && sexOf(g, x.parent) === "female"));
  return e ? e.parent : null;
}

interface Anc { dist: number; prev: string | null; first: string | null }
/** Every blood ancestor (and the person itself at distance 0) with its shortest distance. */
export function ancestorMap(g: Graph, id: string): Map<string, Anc> {
  const m = new Map<string, Anc>([[id, { dist: 0, prev: null, first: null }]]);
  let frontier = [id];
  while (frontier.length) {
    const next: string[] = [];
    for (const cur of frontier) {
      const c = m.get(cur)!;
      for (const e of bloodParents(g, cur)) {
        if (!m.has(e.parent)) {
          m.set(e.parent, { dist: c.dist + 1, prev: cur, first: c.dist === 0 ? e.parent : c.first });
          next.push(e.parent);
        }
      }
    }
    frontier = next;
  }
  return m;
}

export interface BloodPath { u: number; d: number; lca: string; firstE: string | null; prevT: string | null; half: boolean }
export function bloodPath(g: Graph, a: string, b: string): BloodPath | null {
  const A = ancestorMap(g, a), B = ancestorMap(g, b);
  let best: BloodPath | null = null;
  for (const [id, x] of A) {
    const y = B.get(id);
    if (!y) continue;
    if (!best || x.dist + y.dist < best.u + best.d) {
      best = { u: x.dist, d: y.dist, lca: id, firstE: x.first, prevT: y.prev, half: false };
    }
  }
  if (best && best.u === 1 && best.d === 1) {
    const pa = new Set(bloodParents(g, a).map((e) => e.parent));
    const shared = bloodParents(g, b).filter((e) => pa.has(e.parent)).length;
    best.half = shared < 2 && pa.size >= 1;
  }
  return best;
}

const pick = (sex: Sex, m: string, f: string, both: string) => (sex === "male" ? m : sex === "female" ? f : both);

function bloodTerm(g: Graph, t: string, bp: BloodPath): string {
  const { u, d } = bp;
  const ts = sexOf(g, t);
  const side = bp.firstE ? sexOf(g, bp.firstE) : "unknown"; // sex of ego's parent on the path
  const mid = bp.prevT ? sexOf(g, bp.prevT) : "unknown";    // target's ancestor just below the common ancestor
  if (u === 0 && d === 0) return "আপনি";
  if (u === 0) {
    if (d === 1) return pick(ts, "ছেলে", "মেয়ে", "সন্তান");
    if (d === 2) return pick(ts, "নাতি", "নাতনি", "নাতি/নাতনি");
    if (d === 3) return pick(ts, "প্রপৌত্র", "প্রপৌত্রী", "প্রপৌত্র/প্রপৌত্রী");
    return `${toBn(d)} প্রজন্ম নিচের বংশধর`;
  }
  if (d === 0) {
    if (u === 1) return pick(ts, "বাবা", "মা", "বাবা/মা");
    if (u === 2) return side === "female" ? pick(ts, "নানা", "নানি", "নানা/নানি") : side === "male" ? pick(ts, "দাদা", "দাদি", "দাদা/দাদি") : "দাদা-দাদি/নানা-নানি";
    if (u === 3) return side === "female" ? pick(ts, "পরনানা", "পরনানি", "পরনানা/পরনানি") : side === "male" ? pick(ts, "পরদাদা", "পরদাদি", "পরদাদা/পরদাদি") : "পরদাদা/পরনানা";
    return `${toBn(u)} প্রজন্ম ঊর্ধ্বের ${pick(ts, "পূর্বপুরুষ", "পূর্বনারী", "পূর্বপুরুষ")}`;
  }
  if (u === 1 && d === 1) return (bp.half ? "সৎ " : "") + pick(ts, "ভাই", "বোন", "ভাই/বোন");
  if (u === 1 && d === 2) { // sibling's child
    if (mid === "male") return pick(ts, "ভাতিজা", "ভাতিজি", "ভাতিজা/ভাতিজি");
    if (mid === "female") return pick(ts, "ভাগ্নে", "ভাগ্নি", "ভাগ্নে/ভাগ্নি");
  }
  if (u === 2 && d === 1) { // parent's sibling
    if (side === "male") return pick(ts, "চাচা", "ফুফু", "চাচা/ফুফু");
    if (side === "female") return pick(ts, "মামা", "খালা", "মামা/খালা");
  }
  if (u === 2 && d === 2) { // cousins
    const kind = side === "male" ? (mid === "male" ? "চাচাতো" : mid === "female" ? "ফুফাতো" : "") :
      side === "female" ? (mid === "male" ? "মামাতো" : mid === "female" ? "খালাতো" : "") : "";
    return (kind ? kind + " " : "কাজিন ") + pick(ts, "ভাই", "বোন", "ভাই/বোন");
  }
  return "দূর সম্পর্কের আত্মীয়";
}

const SPOUSE_OF: Record<string, string> = {
  "চাচা": "চাচি", "ফুফু": "ফুফা", "মামা": "মামি", "খালা": "খালু", "ভাই": "ভাবি", "বোন": "দুলাভাই",
  "ছেলে": "পুত্রবধূ", "মেয়ে": "জামাতা", "বাবা": "সৎ মা", "মা": "সৎ বাবা",
};

/** Bangla relationship name of `target` as seen from `ego`, or null when no relationship is recorded. */
export function relation(g: Graph, ego: string, target: string): string | null {
  if (ego === target) return "আপনি";
  const ts = sexOf(g, target);
  // direct step/adoptive/foster links
  const up = (g.parents.get(ego) ?? []).find((e) => e.parent === target && !BLOOD.includes(e.kind));
  if (up) return up.kind === "step" ? pick(ts, "সৎ বাবা", "সৎ মা", "সৎ অভিভাবক") : up.kind === "foster" ? pick(ts, "পালক বাবা", "পালক মা", "পালক অভিভাবক") : "অভিভাবক";
  const down = (g.children.get(ego) ?? []).find((e) => e.child === target && !BLOOD.includes(e.kind));
  if (down) return (down.kind === "step" ? "সৎ " : down.kind === "foster" ? "পালক " : "") + pick(ts, "ছেলে", "মেয়ে", "সন্তান");
  const adopt = (g.parents.get(ego) ?? []).find((e) => e.parent === target && e.kind === "adoptive");
  if (adopt) return "দত্তক " + pick(ts, "বাবা", "মা", "অভিভাবক");
  if ((g.spouses.get(ego) ?? []).includes(target)) return pick(ts, "স্বামী", "স্ত্রী", "জীবনসঙ্গী");
  const bp = bloodPath(g, ego, target);
  if (bp) return bloodTerm(g, target, bp);
  // spouse of a blood relative (চাচি, মামি, ভাবি ...)
  for (const s of g.spouses.get(target) ?? []) {
    const sp = bloodPath(g, ego, s);
    if (sp) { const base = bloodTerm(g, s, sp); if (SPOUSE_OF[base]) return SPOUSE_OF[base]; }
  }
  // in-laws through own spouse
  for (const s of g.spouses.get(ego) ?? []) {
    const sp = bloodPath(g, s, target);
    if (!sp) continue;
    if (sp.u === 1 && sp.d === 0) return pick(ts, "শ্বশুর", "শাশুড়ি", "শ্বশুর/শাশুড়ি");
    if (sp.u === 1 && sp.d === 1) {
      return sexOf(g, s) === "female" ? pick(ts, "শ্যালক", "শ্যালিকা", "শ্যালক/শ্যালিকা") : pick(ts, "দেবর/ভাশুর", "ননদ", "দেবর/ননদ");
    }
  }
  return null;
}

// ---- structure helpers used by the tree and dashboard ----
export function generationLevels(g: Graph, ego: string, gens: number): (string | null)[][] {
  const levels: (string | null)[][] = [[ego]];
  for (let k = 0; k < gens; k++) {
    const next: (string | null)[] = [];
    for (const id of levels[k]) { next.push(id ? fatherOf(g, id) : null, id ? motherOf(g, id) : null); }
    levels.push(next);
  }
  return levels;
}

export function oldestAncestor(g: Graph, ego: string): { id: string; generations: number } | null {
  let best: { id: string; generations: number; year: number } | null = null;
  for (const [id, a] of ancestorMap(g, ego)) {
    if (id === ego) continue;
    const year = g.byId.get(id)?.birthYear ?? 99999;
    if (!best || a.dist > best.generations || (a.dist === best.generations && year < best.year)) best = { id, generations: a.dist, year };
  }
  return best ? { id: best.id, generations: best.generations } : null;
}

export function ancestorCount(g: Graph, ego: string): number { return ancestorMap(g, ego).size - 1; }

export interface Focus {
  parents: [string | null, string | null];
  grandparents: [string | null, string | null, string | null, string | null];
  siblings: string[]; spouses: string[]; children: string[];
}
export function focusSet(g: Graph, ego: string): Focus {
  const f = fatherOf(g, ego), m = motherOf(g, ego);
  const myParents = new Set(bloodParents(g, ego).map((e) => e.parent));
  const sibs = new Set<string>();
  for (const p of myParents) for (const e of g.children.get(p) ?? []) if (e.child !== ego && BLOOD.includes(e.kind)) sibs.add(e.child);
  const kids = new Set<string>();
  for (const e of g.children.get(ego) ?? []) kids.add(e.child);
  return {
    parents: [f, m],
    grandparents: [f ? fatherOf(g, f) : null, f ? motherOf(g, f) : null, m ? fatherOf(g, m) : null, m ? motherOf(g, m) : null],
    siblings: [...sibs], spouses: [...(g.spouses.get(ego) ?? [])], children: [...kids],
  };
}

/** True if making `parent` a parent of `child` would create a loop (someone becoming their own ancestor). */
export function wouldCreateCycle(g: Graph, parent: string, child: string): boolean {
  return parent === child || ancestorMap(g, parent).has(child);
}

/** Same name (ignoring case/spaces) and same or unknown birth year. */
export function findDuplicates(people: P[]): [string, string][] {
  const out: [string, string][] = [];
  const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();
  for (let i = 0; i < people.length; i++) for (let j = i + 1; j < people.length; j++) {
    const a = people[i], b = people[j];
    if (norm(a.name) !== norm(b.name)) continue;
    if (a.birthYear == null || b.birthYear == null || a.birthYear === b.birthYear) out.push([a.id, b.id]);
  }
  return out;
}
