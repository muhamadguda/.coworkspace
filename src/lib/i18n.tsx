"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useSyncExternalStore, type ReactNode } from "react";
import { dict, type DictKey } from "./dict";
import type { Lang } from "./types";

const TZ = "Africa/Cairo";
const LANG_KEY = "dot.lang";

// Language lives in localStorage; the prerendered HTML is Arabic and switches after hydration.
let currentLang: Lang | null = null;
const langListeners = new Set<() => void>();
function readLang(): Lang {
  if (currentLang) return currentLang;
  try {
    currentLang = localStorage.getItem(LANG_KEY) === "en" ? "en" : "ar";
  } catch {
    currentLang = "ar";
  }
  return currentLang;
}
function writeLang(l: Lang) {
  currentLang = l;
  try {
    localStorage.setItem(LANG_KEY, l);
  } catch {}
  langListeners.forEach((f) => f());
}
const subscribeLang = (f: () => void) => {
  langListeners.add(f);
  return () => langListeners.delete(f);
};

export function formatMoney(n: number | null | undefined): string {
  const v = Math.round((n ?? 0) * 100) / 100;
  const s = Number.isInteger(v) ? v.toLocaleString("en-US") : v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${s} EGP`;
}

/** h:mm (e.g. 1:05) from minutes. */
export function formatClock(minutes: number): string {
  const m = Math.max(0, Math.floor(minutes));
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;
}

type Ctx = {
  lang: Lang;
  dir: "rtl" | "ltr";
  setLang: (l: Lang) => void;
  toggleLang: () => void;
  t: (key: DictKey, vars?: Record<string, string | number>) => string;
  n: (obj: { name_ar: string; name_en: string } | null | undefined) => string;
  money: (n: number | null | undefined) => string;
  time: (iso: string | Date) => string;
  date: (iso: string | Date) => string;
  dateTime: (iso: string | Date) => string;
  dur: (minutes: number) => string;
};

const I18nCtx = createContext<Ctx | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const lang = useSyncExternalStore(subscribeLang, readLang, () => "ar" as Lang);

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
  }, [lang]);

  const setLang = useCallback((l: Lang) => writeLang(l), []);

  const value = useMemo<Ctx>(() => {
    const idx = lang === "ar" ? 0 : 1;
    const locale = lang === "ar" ? "ar-EG-u-nu-latn" : "en-GB";
    const timeFmt = new Intl.DateTimeFormat(locale, { timeZone: TZ, hour: "numeric", minute: "2-digit", hour12: true });
    const dateFmt = new Intl.DateTimeFormat(locale, { timeZone: TZ, weekday: "short", day: "numeric", month: "short" });
    const toDate = (v: string | Date) => (typeof v === "string" ? new Date(v) : v);
    return {
      lang,
      dir: lang === "ar" ? "rtl" : "ltr",
      setLang,
      toggleLang: () => setLang(lang === "ar" ? "en" : "ar"),
      t: (key, vars) => {
        const entry = dict[key] as readonly [string, string] | undefined;
        let s: string = entry ? entry[idx] : key;
        if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
        return s;
      },
      n: (obj) => (obj ? (lang === "ar" ? obj.name_ar || obj.name_en : obj.name_en || obj.name_ar) : ""),
      money: formatMoney,
      time: (v) => timeFmt.format(toDate(v)),
      date: (v) => dateFmt.format(toDate(v)),
      dateTime: (v) => `${dateFmt.format(toDate(v))} · ${timeFmt.format(toDate(v))}`,
      dur: (minutes) => {
        const m = Math.max(0, Math.round(minutes));
        const h = Math.floor(m / 60);
        const r = m % 60;
        if (lang === "ar") return h ? (r ? `${h} س ${r} د` : `${h} ساعة`) : `${r} دقيقة`;
        return h ? (r ? `${h}h ${r}m` : `${h}h`) : `${r} min`;
      },
    };
  }, [lang, setLang]);

  return <I18nCtx.Provider value={value}>{children}</I18nCtx.Provider>;
}

export function useI18n(): Ctx {
  const c = useContext(I18nCtx);
  if (!c) throw new Error("useI18n outside provider");
  return c;
}

/** Maps a server/network error to a translated message. */
export function useErrorText() {
  const { t } = useI18n();
  return (code: string) => {
    const key = `err.${code}` as DictKey;
    return key in dict ? t(key) : t("err.unknown");
  };
}
