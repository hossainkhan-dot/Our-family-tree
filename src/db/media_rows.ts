import type { Sql } from "./sql";
/** ডেটাবেসে যত ছবি/ফাইলের (মোছা-লুকানো সহ) বিবরণ আছে তাদের SHA-256। */
export const allMediaRows = (db: Sql): string[] => {
  try { return db.all<{ sha256: string }>("SELECT DISTINCT sha256 FROM media").map((r) => r.sha256); } catch { return []; }
};
