import type { Data, P, Edge } from "./relations";

// Labelled "নমুনা" in the UI. Only for previewing the design before real data entry exists (step 5).
const p = (id: string, name: string, sex: P["sex"], birthYear: number, deathYear: number | null = null): P =>
  ({ id, name, short: name.split(" ")[0], sex, birthYear, deathYear, living: deathYear === null });
const e = (parent: string, child: string, role: Edge["role"]): Edge => ({ parent, child, kind: "biological", role });

export const SAMPLE_EGO = "me";
export const SAMPLE: Data = {
  people: [
    p("me", "রাফি হোসেন", "male", 1995), p("wife", "সুমি আক্তার", "female", 1997),
    p("son", "অর্ণব", "male", 2020), p("dau", "আরিয়া", "female", 2023),
    p("sis", "শিউলি", "female", 1999),
    p("dad", "করিম উদ্দিন", "male", 1965), p("mom", "রহিমা বেগম", "female", 1970),
    p("pgf", "আব্দুল জব্বার", "male", 1938, 2009), p("pgm", "ফাতেমা খাতুন", "female", 1942, 2015),
    p("mgf", "নূর মোহাম্মদ", "male", 1940, 2001), p("mgm", "সালমা বেগম", "female", 1946),
    p("pggf", "রহিম উদ্দিন", "male", 1880, 1945),
    p("uncle", "কামাল উদ্দিন", "male", 1962), p("auntw", "রুবিনা", "female", 1968), p("cous", "তানভীর", "male", 1990),
    p("fufu", "জরিনা", "female", 1968), p("mama", "জামাল", "male", 1972), p("khala", "নাজমা", "female", 1975),
    p("khcous", "মিম", "female", 2000),
  ],
  edges: [
    e("dad", "me", "father"), e("mom", "me", "mother"), e("dad", "sis", "father"), e("mom", "sis", "mother"),
    e("me", "son", "father"), e("wife", "son", "mother"), e("me", "dau", "father"), e("wife", "dau", "mother"),
    e("pgf", "dad", "father"), e("pgm", "dad", "mother"), e("mgf", "mom", "father"), e("mgm", "mom", "mother"),
    e("pggf", "pgf", "father"),
    e("pgf", "uncle", "father"), e("pgm", "uncle", "mother"), e("pgf", "fufu", "father"), e("pgm", "fufu", "mother"),
    e("uncle", "cous", "father"), e("auntw", "cous", "mother"),
    e("mgf", "mama", "father"), e("mgm", "mama", "mother"), e("mgf", "khala", "father"), e("mgm", "khala", "mother"),
    e("khala", "khcous", "mother"),
  ],
  unions: [
    { a: "me", b: "wife" }, { a: "dad", b: "mom" }, { a: "pgf", b: "pgm" }, { a: "mgf", b: "mgm" },
    { a: "uncle", b: "auntw" },
  ],
};
