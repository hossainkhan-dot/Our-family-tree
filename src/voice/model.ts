/** গেমিং ভয়েস প্যাকের তথ্য-কাঠামো। এখানে শুধু খাঁটি লজিক (UI/ফোন-নির্ভর কিছু নেই), তাই টেস্টযোগ্য।
 *  অডিও ফাইল ফোনের অ্যাপ-স্টোরেজে থাকে; এই কাঠামো শুধু ফাইলের নাম মনে রাখে। */

export const INITIAL_SLOTS = 12;          // নতুন প্যাকে শুরুতে এতগুলো ভয়েস-বাটন; এরপর যত খুশি বাড়ানো যাবে
export const NAME_MAX = 40;

export interface Clip { file: string; name: string; ms: number; bytes: number }
export interface Command { id: string; label: string; clip: Clip | null }
export interface Pack { id: string; name: string; commands: Command[] }
export interface Settings {
  holdMs: number;        // ভাসমান বাটন চেপে ধরে সরাতে কত মিলিসেকেন্ড লাগবে (১০০০–৩০০০)
  size: number;          // বাটনের মাপ dp (৪০–৭২)
  opacity: number;       // বাটনের স্বচ্ছতা (০.৪–১)
  volume: number;        // ক্লিপের ভলিউম (০–১); ফোনের সিস্টেম-ভলিউম বদলায় না
  interrupt: boolean;    // নতুন ক্লিপ বাজলে আগেরটি থামবে
  speaker: boolean;      // ফোনের স্পিকারেই বাজবে (ইয়ারফোন থাকলেও), যাতে গেমের মাইক ধরতে পারে
  outsideClose: boolean; // গেমের অন্য জায়গায় ছুঁলে প্যানেল বন্ধ হবে
  autoClose: boolean;    // ক্লিপ বাজানোর পর প্যানেল নিজে বন্ধ হবে
}
export interface VoiceState { version: 1; packs: Pack[]; settings: Settings }

export const DEFAULT_SETTINGS: Settings = { holdMs: 2000, size: 52, opacity: 0.9, volume: 1, interrupt: true, speaker: true, outsideClose: true, autoClose: false };

const bn = (n: number) => String(n).replace(/\d/g, (d) => "০১২৩৪৫৬৭৮৯"[Number(d)]);
export const defaultLabel = (i: number) => `ভয়েস ${bn(i)}`;
const isDefaultLabel = (s: string) => !s.trim() || /^ভয়েস [০-৯]+$/.test(s.trim());
export const uid = (p: string) => `${p}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
const SAFE_FILE = /^[A-Za-z0-9._-]{1,120}$/;
const stripExt = (n: string) => n.replace(/\.[A-Za-z0-9]{1,5}$/, "");

const num = (v: unknown, lo: number, hi: number, d: number) => Math.min(hi, Math.max(lo, typeof v === "number" && Number.isFinite(v) ? v : d));
const bool = (v: unknown, d: boolean) => (typeof v === "boolean" ? v : d);
export function cleanSettings(raw: unknown): Settings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>, d = DEFAULT_SETTINGS;
  return {
    holdMs: Math.round(num(r.holdMs, 1000, 3000, d.holdMs)), size: Math.round(num(r.size, 40, 72, d.size)),
    opacity: Math.round(num(r.opacity, 0.4, 1, d.opacity) * 100) / 100, volume: Math.round(num(r.volume, 0, 1, d.volume) * 100) / 100,
    interrupt: bool(r.interrupt, d.interrupt), speaker: bool(r.speaker, d.speaker), outsideClose: bool(r.outsideClose, d.outsideClose), autoClose: bool(r.autoClose, d.autoClose),
  };
}

export const emptyState = (): VoiceState => ({ version: 1, packs: [], settings: { ...DEFAULT_SETTINGS } });

/** ফোন থেকে আসা লেখা/অবজেক্ট যাচাই করে নিরাপদ কাঠামো বানায়; নষ্ট বা অচেনা অংশ বাদ যায়, ক্র্যাশ করে না। */
export function sanitize(raw: unknown): VoiceState {
  let r: unknown = raw;
  if (typeof raw === "string") { try { r = JSON.parse(raw); } catch { return emptyState(); } }
  if (!r || typeof r !== "object") return emptyState();
  const o = r as Record<string, unknown>, seenPack = new Set<string>(), packs: Pack[] = [];
  for (const p of Array.isArray(o.packs) ? o.packs : []) {
    if (!p || typeof p !== "object") continue;
    const pr = p as Record<string, unknown>;
    if (typeof pr.id !== "string" || !pr.id || seenPack.has(pr.id)) continue;
    seenPack.add(pr.id);
    const seenCmd = new Set<string>(), commands: Command[] = [];
    for (const c of Array.isArray(pr.commands) ? pr.commands : []) {
      if (!c || typeof c !== "object") continue;
      const cr = c as Record<string, unknown>;
      if (typeof cr.id !== "string" || !cr.id || seenCmd.has(cr.id)) continue;
      seenCmd.add(cr.id);
      let clip: Clip | null = null;
      const k = cr.clip as Record<string, unknown> | null | undefined;
      if (k && typeof k === "object" && typeof k.file === "string" && SAFE_FILE.test(k.file) && !k.file.includes(".."))
        clip = { file: k.file, name: typeof k.name === "string" ? k.name.slice(0, 120) : k.file, ms: Math.max(0, Math.round(Number(k.ms) || 0)), bytes: Math.max(0, Math.round(Number(k.bytes) || 0)) };
      commands.push({ id: cr.id, label: typeof cr.label === "string" ? cr.label.slice(0, NAME_MAX) : "", clip });
    }
    packs.push({ id: pr.id, name: (typeof pr.name === "string" ? pr.name : "").slice(0, NAME_MAX) || "প্যাক", commands });
  }
  return { version: 1, packs, settings: cleanSettings(o.settings) };
}
export const serialize = (s: VoiceState): string => JSON.stringify({ version: 1, packs: s.packs, settings: s.settings });

export function cleanName(name: string): string {
  const n = name.replace(/\s+/g, " ").trim().slice(0, NAME_MAX);
  if (!n) throw new Error("নাম লিখুন।");
  return n;
}
function uniqueName(s: VoiceState, name: string, exceptId?: string): string {
  const n = cleanName(name);
  if (s.packs.some((p) => p.id !== exceptId && p.name.toLowerCase() === n.toLowerCase())) throw new Error("এই নামে আরেকটি প্যাক আছে। অন্য নাম দিন।");
  return n;
}
const mapPack = (s: VoiceState, id: string, fn: (p: Pack) => Pack): VoiceState => {
  if (!s.packs.some((p) => p.id === id)) throw new Error("প্যাকটি পাওয়া যায়নি।");
  return { ...s, packs: s.packs.map((p) => (p.id === id ? fn(p) : p)) };
};
const slots = (from: number, n: number): Command[] => Array.from({ length: n }, (_, i) => ({ id: uid("c"), label: defaultLabel(from + i + 1), clip: null }));

export function addPack(s: VoiceState, name: string, slotCount = INITIAL_SLOTS): { state: VoiceState; id: string } {
  const n = uniqueName(s, name), id = uid("p");
  return { state: { ...s, packs: [...s.packs, { id, name: n, commands: slots(0, Math.max(0, slotCount)) }] }, id };
}
export const renamePack = (s: VoiceState, id: string, name: string) => { const n = uniqueName(s, name, id); return mapPack(s, id, (p) => ({ ...p, name: n })); };
export function deletePack(s: VoiceState, id: string): VoiceState {
  if (!s.packs.some((p) => p.id === id)) throw new Error("প্যাকটি পাওয়া যায়নি।");
  return { ...s, packs: s.packs.filter((p) => p.id !== id) };
}
/** "Add Voice": কোনো সীমা নেই। */
export const addSlots = (s: VoiceState, packId: string, n = 1) => mapPack(s, packId, (p) => ({ ...p, commands: [...p.commands, ...slots(p.commands.length, Math.max(0, n))] }));
const mapCmd = (s: VoiceState, packId: string, cmdId: string, fn: (c: Command) => Command) => mapPack(s, packId, (p) => {
  if (!p.commands.some((c) => c.id === cmdId)) throw new Error("ভয়েস-বাটনটি পাওয়া যায়নি।");
  return { ...p, commands: p.commands.map((c) => (c.id === cmdId ? fn(c) : c)) };
});
const autoLabel = (c: Command, clip: Clip) => (isDefaultLabel(c.label) ? stripExt(clip.name).slice(0, NAME_MAX) || c.label : c.label);
export const setClip = (s: VoiceState, packId: string, cmdId: string, clip: Clip) => mapCmd(s, packId, cmdId, (c) => ({ ...c, clip, label: autoLabel(c, clip) }));
export const clearClip = (s: VoiceState, packId: string, cmdId: string) => mapCmd(s, packId, cmdId, (c) => ({ ...c, clip: null }));
export const renameCommand = (s: VoiceState, packId: string, cmdId: string, label: string) => mapCmd(s, packId, cmdId, (c) => ({ ...c, label: label.replace(/\s+/g, " ").trim().slice(0, NAME_MAX) }));
export const removeCommand = (s: VoiceState, packId: string, cmdId: string) => mapPack(s, packId, (p) => ({ ...p, commands: p.commands.filter((c) => c.id !== cmdId) }));
export const moveCommand = (s: VoiceState, packId: string, cmdId: string, dir: -1 | 1) => mapPack(s, packId, (p) => {
  const i = p.commands.findIndex((c) => c.id === cmdId), j = i + dir;
  if (i < 0 || j < 0 || j >= p.commands.length) return p;
  const cs = [...p.commands]; [cs[i], cs[j]] = [cs[j], cs[i]];
  return { ...p, commands: cs };
});
/** একসঙ্গে অনেকগুলো অডিও: আগে খালি বাটনগুলো ভরে, কম পড়লে নতুন বাটন যোগ হয়। */
export const fillClips = (s: VoiceState, packId: string, clips: Clip[]) => mapPack(s, packId, (p) => {
  const cs = [...p.commands];
  for (const clip of clips) {
    const i = cs.findIndex((c) => !c.clip);
    if (i >= 0) cs[i] = { ...cs[i], clip, label: autoLabel(cs[i], clip) };
    else cs.push({ id: uid("c"), label: stripExt(clip.name).slice(0, NAME_MAX) || defaultLabel(cs.length + 1), clip });
  }
  return { ...p, commands: cs };
});
export const setSettings = (s: VoiceState, patch: Partial<Settings>): VoiceState => ({ ...s, settings: cleanSettings({ ...s.settings, ...patch }) });

/** এখনো কোনো বাটনে ব্যবহৃত সব অডিও-ফাইলের নাম। বাকি ফাইল ফোন থেকে মুছে ফেলা যায়। */
export const usedFiles = (s: VoiceState): string[] => [...new Set(s.packs.flatMap((p) => p.commands.flatMap((c) => (c.clip ? [c.clip.file] : []))))];
export const clipCount = (p: Pack) => p.commands.filter((c) => c.clip).length;
/** সক্রিয় প্যাক: সংরক্ষিত আইডি মিললে সেটি, নইলে প্রথম প্যাক, প্যাক না থাকলে null (ফোনের ওভারলের নিয়মও একই)। */
export const effectiveActive = (s: VoiceState, id: string | null): string | null => (id && s.packs.some((p) => p.id === id) ? id : s.packs[0]?.id ?? null);
