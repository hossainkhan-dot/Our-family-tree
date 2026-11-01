import initSqlJs from "sql.js";
import wasmUrl from "sql.js/dist/sql-wasm.wasm?url";
import { migrate } from "./migrate";
import type { Sql } from "./sql";

import { FILES, idbGet, idbPut } from "./idb";
const KEY = "main-db";
const loadBytes = () => idbGet<Uint8Array>(FILES, KEY);
const saveBytes = (b: Uint8Array) => idbPut(FILES, KEY, b);

export async function openDb(): Promise<Sql> {
  const SQL = await initSqlJs({ locateFile: () => wasmUrl });
  const bytes = await loadBytes();
  let raw = new SQL.Database(bytes ?? undefined);
  let timer: number | undefined;
  const persist = () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      const out = raw.export();           // export resets pragmas, so turn them back on
      raw.run("PRAGMA foreign_keys = ON");
      void saveBytes(out);
    }, 250);
  };
  const db: Sql = {
    run(sql, params) {
      raw.run(sql, params as never);
      if (!/^\s*(SELECT|PRAGMA|BEGIN|ROLLBACK)/i.test(sql)) persist();
    },
    all<T>(sql: string, params?: unknown[]) {
      const st = raw.prepare(sql);
      try {
        if (params && params.length) st.bind(params as never);
        const out: T[] = [];
        while (st.step()) out.push(st.getAsObject() as T);
        return out;
      } finally { st.free(); }
    },
  };
  const init = () => { raw.run("PRAGMA foreign_keys = ON"); migrate(db); db.run("INSERT OR REPLACE INTO app_context (key, value) VALUES ('actor', 'owner')"); };
  db.reset = () => { raw.close(); raw = new SQL.Database(); init(); };
  init();
  try { await navigator.storage?.persist?.(); } catch { /* optional */ }
  return db;
}
