import { exportBackup, restoreInto, type Backup } from "./backup";
import { getMeta, setMeta } from "./repo";
import type { Sql } from "./sql";

/** রিসেটে এই ফোনের নিজস্ব সেটিং হারালে চলবে না। */
const KEEP = ["backup_log", "last_export", "current_member"];

/** পুরো ডেটাবেস অন্য ব্যাকআপ দিয়ে বদলায়। ব্যর্থ হলে আগের তথ্য হুবহু ফেরত আসে (রোলব্যাক)। */
export function replaceWith(db: Sql, b: Backup): void {
  if (!db.reset) throw new Error("এই পরিবেশে ফিরিয়ে আনা সম্ভব নয়।");
  const before = exportBackup(db);
  const keep = KEEP.map((k) => [k, getMeta(db, k)] as const);
  const put = () => { for (const [k, v] of keep) if (v !== null) setMeta(db, k, v); };
  try { db.reset(); restoreInto(db, b); }
  catch (e) { db.reset(); restoreInto(db, before); put(); throw new Error(`ফিরিয়ে আনা যায়নি, আগের তথ্য যেমন ছিল তেমনই আছে। (${e instanceof Error ? e.message : e})`); }
  put();
}
