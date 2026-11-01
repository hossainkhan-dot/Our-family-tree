import { buildGraph, type ParentKind, type Sex } from "../core/relations";
import { addSource, explainError, getProfile, linkParent, linkSpouse, loadData, savePerson, type DateIn, type PersonIn, type Qualifier, type Status } from "./repo";
import type { Sql } from "./sql";

const MON = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const BN = /[\u0980-\u09FF]/;

// ---------------- export (GEDCOM 5.5.1, UTF-8) ----------------
function fmtDate(d: DateIn | undefined): string {
  if (!d || d.q === "unknown" || !d.y) return "";
  const core = [d.d ?? "", d.m ? MON[d.m - 1] : "", d.y].filter((x) => x !== "").join(" ");
  return d.q === "about" || d.q === "between" ? `ABT ${core}` : d.q === "before" ? `BEF ${core}` : d.q === "after" ? `AFT ${core}` : core;
}

export function exportGedcom(db: Sql): string {
  const data = loadData(db), g = buildGraph(data);
  const out: string[] = [];
  const emit = (lvl: number, tag: string, val = "") => {
    const lines = val.split(/\r?\n/);
    lines.forEach((ln, i) => {
      let rest = ln, first = true;
      do {
        const chunk = rest.slice(0, 200); rest = rest.slice(200);
        if (i === 0 && first) out.push(`${lvl} ${tag}${chunk ? " " + chunk : ""}`);
        else out.push(`${lvl + 1} ${first ? "CONT" : "CONC"}${chunk ? " " + chunk : ""}`);
        first = false;
      } while (rest.length);
    });
  };
  out.push("0 HEAD", "1 SOUR FamilyLegacyArchive", "1 GEDC", "2 VERS 5.5.1", "2 FORM LINEAGE-LINKED", "1 CHAR UTF-8");
  const ix = new Map(data.people.map((p, i) => [p.id, `@I${i + 1}@`]));

  // families: one per distinct (father, mother) pair, plus recorded unions
  interface Fam { h?: string; w?: string; kids: { id: string; kind: ParentKind }[] }
  const fams = new Map<string, Fam>();
  const fam = (h?: string, w?: string) => { const k = `${h ?? ""}|${w ?? ""}`; if (!fams.has(k)) fams.set(k, { h, w, kids: [] }); return fams.get(k)!; };
  for (const u of data.unions) {
    const a = g.byId.get(u.a)!, b = g.byId.get(u.b)!;
    if (a.sex === "female" && b.sex !== "female") fam(u.b, u.a); else fam(u.a, u.b);
  }
  for (const p of data.people) {
    const es = data.edges.filter((e) => e.child === p.id);
    if (!es.length) continue;
    let h: string | undefined, w: string | undefined;
    for (const e of es) {
      const sex = g.byId.get(e.parent)?.sex;
      if (e.role === "father" || (e.role === "parent" && sex === "male" && !h)) h = h ?? e.parent;
      else if (e.role === "mother" || (e.role === "parent" && !w)) w = w ?? e.parent;
      else h = h ?? e.parent;
    }
    fam(h, w).kids.push({ id: p.id, kind: es[0].kind });
  }
  const famIds = new Map([...fams.keys()].map((k, i) => [k, `@F${i + 1}@`]));
  const famsOf = new Map<string, string[]>(), famcOf = new Map<string, { f: string; kind: ParentKind }[]>();
  for (const [k, f] of fams) {
    const id = famIds.get(k)!;
    for (const x of [f.h, f.w]) if (x) famsOf.set(x, [...(famsOf.get(x) ?? []), id]);
    for (const c of f.kids) famcOf.set(c.id, [...(famcOf.get(c.id) ?? []), { f: id, kind: c.kind }]);
  }

  const srcIds = new Map<string, string>();
  const sourceOf = (title: string, informant: string | null) => { const k = `${title}|${informant ?? ""}`; if (!srcIds.has(k)) srcIds.set(k, `@S${srcIds.size + 1}@`); return srcIds.get(k)!; };

  for (const p of data.people) {
    const pr = getProfile(db, p.id);
    if (!pr) continue;
    out.push(`0 ${ix.get(p.id)} INDI`);
    const names = [pr.nameBn, pr.nameEn].filter((x): x is string => !!x);
    names.forEach((n, i) => { emit(1, "NAME", n); if (i > 0) emit(2, "TYPE", "aka"); if (i === 0 && pr.nickname) emit(2, "NICK", pr.nickname); });
    emit(1, "SEX", pr.sex === "male" ? "M" : pr.sex === "female" ? "F" : "U");
    const bd = fmtDate(pr.birth);
    if (bd || pr.birthPlace) { emit(1, "BIRT"); if (bd) emit(2, "DATE", bd); if (pr.birthPlace) emit(2, "PLAC", pr.birthPlace); }
    if (pr.living === "deceased" || fmtDate(pr.death) || pr.deathPlace) {
      const dd = fmtDate(pr.death);
      emit(1, "DEAT", dd || pr.deathPlace ? "" : "Y"); if (dd) emit(2, "DATE", dd); if (pr.deathPlace) emit(2, "PLAC", pr.deathPlace);
    }
    if (pr.occupation) emit(1, "OCCU", pr.occupation);
    if (pr.education) emit(1, "EDUC", pr.education);
    const notes = [pr.biography, pr.personality && `স্বভাব: ${pr.personality}`, pr.memories && `স্মৃতি: ${pr.memories}`,
      pr.workplace && `কর্মস্থল: ${pr.workplace}`, pr.institution && `প্রতিষ্ঠান: ${pr.institution}`, pr.achievements && `অর্জন: ${pr.achievements}`].filter(Boolean).join("\n");
    if (notes) emit(1, "NOTE", notes);
    for (const f of famcOf.get(p.id) ?? []) {
      emit(1, "FAMC", f.f);
      const pedi = f.kind === "adoptive" ? "adopted" : f.kind === "foster" ? "foster" : f.kind === "biological" ? "birth" : "";
      if (pedi) emit(2, "PEDI", pedi);
    }
    for (const f of famsOf.get(p.id) ?? []) emit(1, "FAMS", f);
    emit(1, "_STATUS", pr.status);
    for (const s of pr.sources) emit(1, "SOUR", sourceOf(s.title, s.informant));
  }
  for (const [k, f] of fams) {
    out.push(`0 ${famIds.get(k)} FAM`);
    if (f.h) emit(1, "HUSB", ix.get(f.h)!);
    if (f.w) emit(1, "WIFE", ix.get(f.w)!);
    for (const c of f.kids) emit(1, "CHIL", ix.get(c.id)!);
  }
  for (const [k, id] of srcIds) { const [t, inf] = k.split("|"); out.push(`0 ${id} SOUR`); emit(1, "TITL", t); if (inf) emit(1, "AUTH", inf); }
  out.push("0 TRLR");
  return out.join("\n") + "\n";
}

// ---------------- import ----------------
interface Node { level: number; xref?: string; tag: string; value: string; kids: Node[] }

export function parseGedcom(text: string): Node[] {
  const roots: Node[] = [], stack: Node[] = [];
  for (const raw of text.replace(/^\uFEFF/, "").split(/\r\n|\r|\n/)) {
    const m = raw.match(/^\s*(\d+)\s+(?:(@[^@]+@)\s+)?(\S+)(?:\s(.*))?$/);
    if (!m) continue;
    const level = Number(m[1]), tag = m[3].toUpperCase(), value = m[4] ?? "";
    if (tag === "CONC" || tag === "CONT") {
      const parent = stack[level - 1];
      if (parent) parent.value += (tag === "CONT" ? "\n" : "") + value;
      continue;
    }
    const n: Node = { level, xref: m[2], tag, value, kids: [] };
    stack.length = level; stack[level] = n;
    if (level === 0) roots.push(n); else stack[level - 1]?.kids.push(n);
  }
  return roots;
}

export function parseGedDate(s: string): { d: DateIn; lossy: boolean } | null {
  let t = s.trim().toUpperCase().replace(/\./g, "");
  let q: Qualifier = "exact", lossy = false;
  const w = t.match(/^(ABT|ABOUT|CAL|EST|BEF|BEFORE|AFT|AFTER|BET|BETWEEN|FROM)\s+(.*)$/);
  if (w) {
    t = w[2];
    q = /^(BEF|BEFORE)$/.test(w[1]) ? "before" : /^(AFT|AFTER)$/.test(w[1]) ? "after" : "about";
    if (/^(BET|BETWEEN|FROM)$/.test(w[1])) lossy = true;
  }
  const m = t.match(/^(?:(\d{1,2})\s+)?(?:(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\s+)?(\d{3,4})/);
  if (!m) return null;
  return { d: { q, y: Number(m[3]), m: m[2] ? MON.indexOf(m[2]) + 1 : null, d: m[1] && m[2] ? Number(m[1]) : null }, lossy };
}

export interface ImportResult { people: number; families: number; warnings: string[] }

export function importGedcom(db: Sql, text: string, filename = "GEDCOM"): ImportResult {
  const roots = parseGedcom(text);
  const warnings: string[] = [];
  const kid = (n: Node, tag: string) => n.kids.find((k) => k.tag === tag);
  const kidsOf = (n: Node, tag: string) => n.kids.filter((k) => k.tag === tag);
  const charset = roots.find((r) => r.tag === "HEAD")?.kids.find((k) => k.tag === "CHAR")?.value.toUpperCase();
  if (charset && !/UTF-?8|UNICODE/.test(charset)) warnings.push(`ফাইলের এনকোডিং ${charset}, বাংলা অক্ষর ঠিকমতো না-ও আসতে পারে।`);

  const idOf = new Map<string, string>(), pedi = new Map<string, ParentKind>();
  let people = 0;
  for (const n of roots.filter((r) => r.tag === "INDI" && r.xref)) {
    const names = kidsOf(n, "NAME").map((x) => x.value.replace(/\//g, " ").replace(/\s+/g, " ").trim()).filter(Boolean);
    const nick = kid(kidsOf(n, "NAME")[0] ?? n, "NICK")?.value;
    const nameBn = names.find((x) => BN.test(x)), nameEn = names.find((x) => !BN.test(x));
    const sexV = kid(n, "SEX")?.value.trim().toUpperCase();
    const sex: Sex = sexV === "M" ? "male" : sexV === "F" ? "female" : "unknown";
    const ev = (tag: string) => {
      const e = kid(n, tag); if (!e) return null;
      const dv = kid(e, "DATE")?.value ?? "", pd = dv ? parseGedDate(dv) : null;
      if (dv && !pd) warnings.push(`${nameBn ?? nameEn ?? n.xref}: তারিখ "${dv}" পড়া যায়নি, ফাঁকা রাখা হয়েছে।`);
      return { d: pd?.d ?? ({ q: "unknown" } as DateIn), lossy: !!pd?.lossy, place: kid(e, "PLAC")?.value ?? "", y: e.value.trim().toUpperCase() === "Y" };
    };
    const b = ev("BIRT"), d = ev("DEAT");
    const stat = kid(n, "_STATUS")?.value as Status | undefined;
    const status: Status = stat && ["verified", "unverified", "estimated", "unknown"].includes(stat) ? stat : b?.lossy || d?.lossy ? "estimated" : "unverified";
    const notes = kidsOf(n, "NOTE").map((x) => x.value).filter((x) => x && !x.startsWith("@")).join("\n\n");
    const inp: PersonIn = {
      nameBn, nameEn: nameEn ?? (nameBn ? undefined : "নামহীন"), nickname: nick, sex, status,
      living: d ? "deceased" : "unknown",
      birth: b?.d, birthPlace: b?.place, death: d?.d, deathPlace: d?.place,
      occupation: kid(n, "OCCU")?.value, education: kid(n, "EDUC")?.value, biography: notes,
    };
    let id: string;
    try { id = savePerson(db, inp); }
    catch (e) {
      warnings.push(`${nameBn ?? nameEn ?? n.xref}: ${explainError(e)} তারিখ বাদ দিয়ে যোগ করা হয়েছে।`);
      try { id = savePerson(db, { ...inp, birth: undefined, death: undefined }); } catch (e2) { warnings.push(`${nameBn ?? nameEn ?? n.xref} যোগ করা যায়নি: ${explainError(e2)}`); continue; }
    }
    idOf.set(n.xref!, id); people++;
    for (const sr of kidsOf(n, "SOUR")) {
      const rec = roots.find((r) => r.tag === "SOUR" && r.xref === sr.value);
      const title = rec ? kid(rec, "TITL")?.value : sr.value && !sr.value.startsWith("@") ? sr.value : undefined;
      if (title) addSource(db, id, "other", title, rec ? kid(rec, "AUTH")?.value : null);
    }
    addSource(db, id, "other", `GEDCOM ইমপোর্ট: ${filename}`);
    for (const f of kidsOf(n, "FAMC")) {
      const p = kid(f, "PEDI")?.value.toLowerCase();
      pedi.set(`${n.xref}|${f.value}`, p === "adopted" ? "adoptive" : p === "foster" ? "foster" : "biological");
    }
  }
  let families = 0;
  for (const f of roots.filter((r) => r.tag === "FAM" && r.xref)) {
    const h = idOf.get(kid(f, "HUSB")?.value ?? ""), w = idOf.get(kid(f, "WIFE")?.value ?? "");
    if (h && w) { linkSpouse(db, h, w); }
    for (const c of kidsOf(f, "CHIL")) {
      const cid = idOf.get(c.value); if (!cid) continue;
      const kind = pedi.get(`${c.value}|${f.xref}`) ?? "biological";
      for (const [pid, role] of [[h, "father"], [w, "mother"]] as const) {
        if (!pid) continue;
        try { linkParent(db, cid, pid, role, kind); }
        catch (e) { warnings.push(`সম্পর্ক যোগ করা যায়নি (${explainError(e)})`); }
      }
    }
    families++;
  }
  return { people, families, warnings };
}
