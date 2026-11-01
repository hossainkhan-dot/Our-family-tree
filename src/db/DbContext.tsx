import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import type { Data } from "../core/relations";
import { openDb } from "./open";
import { getEgo, loadData } from "./repo";
import type { Sql } from "./sql";

interface DbState { db: Sql; data: Data; ego: string | null; reload: () => void }
const Ctx = createContext<DbState | null>(null);

export function useDb(): DbState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useDb outside provider");
  return v;
}

export function DbProvider({ children }: { children: ReactNode }) {
  const [db, setDb] = useState<Sql | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [data, setData] = useState<Data>({ people: [], edges: [], unions: [] });
  const [ego, setEgo] = useState<string | null>(null);

  const refresh = useCallback((d: Sql) => { setData(loadData(d)); setEgo(getEgo(d)); }, []);
  useEffect(() => {
    openDb().then((d) => { setDb(d); refresh(d); }).catch((e) => setErr(e instanceof Error ? e.message : String(e)));
  }, [refresh]);

  if (err) return <main className="panel"><h1>ডেটাবেস খোলা যায়নি</h1><p className="muted">{err}</p><p className="muted">এই লেখার স্ক্রিনশট পাঠালে ঠিক করা যাবে।</p></main>;
  if (!db) return <main className="panel"><p className="muted">প্রস্তুত হচ্ছে…</p></main>;
  return <Ctx.Provider value={{ db, data, ego, reload: () => refresh(db) }}>{children}</Ctx.Provider>;
}
