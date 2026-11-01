import initSqlJs from "sql.js";
import wasmUrl from "sql.js/dist/sql-wasm.wasm?url";
import { migrate } from "./migrate";
import type { Sql } from "./sql";

// The whole database file lives in the phone's IndexedDB. JSON/GEDCOM export (step 8) will add a second copy.
const IDB_NAME = "family-legacy-archive", STORE = "files", KEY = "main-db";

function idb(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(IDB_NAME, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function loadBytes(): Promise<Uint8Array | null> {
  const d = await idb();
  return new Promise((res, rej) => {
    const q = d.transaction(STORE).objectStore(STORE).get(KEY);
    q.onsuccess = () => res((q.result as Uint8Array | undefined) ?? null);
    q.onerror = () => rej(q.error);
  });
}
async function saveBytes(bytes: Uint8Array): Promise<void> {
  const d = await idb();
  return new Promise((res, rej) => {
    const t = d.transaction(STORE, "readwrite");
    t.objectStore(STORE).put(bytes, KEY);
    t.oncomplete = () => res();
    t.onerror = () => rej(t.error);
  });
}

export async function openDb(): Promise<Sql> {
  const SQL = await initSqlJs({ locateFile: () => wasmUrl });
  const bytes = await loadBytes();
  const raw = new SQL.Database(bytes ?? undefined);
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
  migrate(db);
  db.run("INSERT OR REPLACE INTO app_context (key, value) VALUES ('actor', 'owner')");
  try { await navigator.storage?.persist?.(); } catch { /* optional */ }
  return db;
}
