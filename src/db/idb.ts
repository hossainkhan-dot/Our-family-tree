export const IDB_NAME = "family-legacy-archive";
export const FILES = "files", SNAPS = "snapshots", MEDIA = "media";

export function idb(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(IDB_NAME, 3);
    r.onupgradeneeded = () => {
      for (const s of [FILES, SNAPS, MEDIA]) if (!r.result.objectStoreNames.contains(s)) r.result.createObjectStore(s);
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
export async function idbGet<T>(store: string, key: string): Promise<T | null> {
  const d = await idb();
  return new Promise((res, rej) => { const q = d.transaction(store).objectStore(store).get(key); q.onsuccess = () => res((q.result as T | undefined) ?? null); q.onerror = () => rej(q.error); });
}
export async function idbPut(store: string, key: string, value: unknown): Promise<void> {
  const d = await idb();
  return new Promise((res, rej) => { const t = d.transaction(store, "readwrite"); t.objectStore(store).put(value, key); t.oncomplete = () => res(); t.onerror = () => rej(t.error); });
}
export async function idbDelete(store: string, key: string): Promise<void> {
  const d = await idb();
  return new Promise((res, rej) => { const t = d.transaction(store, "readwrite"); t.objectStore(store).delete(key); t.oncomplete = () => res(); t.onerror = () => rej(t.error); });
}
export async function idbKeys(store: string): Promise<string[]> {
  const d = await idb();
  return new Promise((res, rej) => { const q = d.transaction(store).objectStore(store).getAllKeys(); q.onsuccess = () => res((q.result as string[]).map(String)); q.onerror = () => rej(q.error); });
}
