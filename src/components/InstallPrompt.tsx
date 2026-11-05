"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { Button, Sheet } from "./ui";

// Install dot as an app.
// First visit: a full prompt a few seconds in. Second visit onward: a slim banner.
// Nothing shows once installed, when running as the installed app, or while snoozed.
// Android / desktop Chrome & Edge get the browser's own install dialog (beforeinstallprompt);
// iPhone/iPad have no such API, so they get the two Share → "Add to Home Screen" steps.

type BIPEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };

const K = { visits: "dot.visits", counted: "dot.visit.counted", installed: "dot.installed", snooze: "dot.install.snooze" };
const FIRST_DELAY_MS = 4000;
const SNOOZE_PROMPT_MS = 24 * 3600_000; // "Not now" on the first-visit prompt
const SNOOZE_BANNER_MS = 14 * 24 * 3600_000; // × on the banner

const safe = <T,>(f: () => T, fallback: T): T => {
  try {
    return f();
  } catch {
    return fallback;
  }
};

function isStandalone() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    window.matchMedia("(display-mode: window-controls-overlay)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function isIOS() {
  const ua = navigator.userAgent;
  const apple = /iPhone|iPad|iPod/.test(ua) || (ua.includes("Macintosh") && navigator.maxTouchPoints > 1);
  // In-app browsers (Instagram, Facebook, …) have no "Add to Home Screen"; don't promise one.
  return apple && !/FBAN|FBAV|Instagram|Line\/|Snapchat|TikTok/i.test(ua);
}

/** Counts one visit per browser session; returns the visit number. */
function countVisit(): number {
  return safe(() => {
    let n = Number(localStorage.getItem(K.visits)) || 0;
    if (!sessionStorage.getItem(K.counted)) {
      n += 1;
      localStorage.setItem(K.visits, String(n));
      sessionStorage.setItem(K.counted, "1");
    }
    return Math.max(1, n);
  }, 1);
}

export function InstallPrompt() {
  const { t } = useI18n();
  const [deferred, setDeferred] = useState<BIPEvent | null>(null);
  const [mode, setMode] = useState<"none" | "prompt" | "banner">("none");
  const [ios, setIos] = useState(false);
  // The page's own bottom bars (the menu's "Review order", the staff "sign in to sync") come first:
  // the banner steps aside while one is on screen instead of covering it.
  const [bottomBar, setBottomBar] = useState(false);
  useEffect(() => {
    if (mode !== "banner") return;
    const check = () => setBottomBar(!!document.querySelector("[data-bottom-bar]"));
    const mo = new MutationObserver(check);
    mo.observe(document.body, { childList: true, subtree: true });
    const first = setTimeout(check, 0);
    return () => {
      mo.disconnect();
      clearTimeout(first);
    };
  }, [mode]);

  useEffect(() => {
    if (isStandalone() || safe(() => localStorage.getItem(K.installed) === "1", false)) return;
    const visit = countVisit();
    const snoozed = safe(() => Number(localStorage.getItem(K.snooze)) > Date.now(), false);
    const iosDevice = isIOS();
    let bip: BIPEvent | null = null;

    const show = () => {
      if (snoozed) return;
      if (!bip && !iosDevice) return; // this browser can't install (e.g. Firefox desktop)
      setIos(!bip && iosDevice);
      setMode(visit <= 1 ? "prompt" : "banner");
    };
    const onBip = (e: Event) => {
      e.preventDefault(); // keep the browser's mini-infobar away; we ask at the right moment
      bip = e as BIPEvent;
      setDeferred(bip);
      if (visit > 1) show();
    };
    const onInstalled = () => {
      safe(() => localStorage.setItem(K.installed, "1"), undefined);
      setMode("none");
    };
    window.addEventListener("beforeinstallprompt", onBip);
    window.addEventListener("appinstalled", onInstalled);
    // First visit: give the page a moment before asking. Later visits: banner straight away (iOS),
    // or as soon as the browser says it can install (onBip).
    const timer = setTimeout(show, visit <= 1 ? FIRST_DELAY_MS : 800);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("beforeinstallprompt", onBip);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  function snooze(ms: number) {
    safe(() => localStorage.setItem(K.snooze, String(Date.now() + ms)), undefined);
    setMode("none");
  }

  async function install() {
    if (!deferred) return;
    await deferred.prompt();
    const choice = await deferred.userChoice.catch(() => ({ outcome: "dismissed" as const }));
    setDeferred(null);
    if (choice.outcome === "accepted") {
      safe(() => localStorage.setItem(K.installed, "1"), undefined);
      setMode("none");
    } else {
      snooze(mode === "banner" ? SNOOZE_BANNER_MS : SNOOZE_PROMPT_MS);
    }
  }

  if (mode === "none") return null;

  if (mode === "banner") {
    if (bottomBar) return null;
    return (
      <div
        role="region"
        aria-label={t("pwa.title")}
        className="fixed inset-x-0 bottom-0 z-40 flex justify-center px-4 print:hidden"
        style={{ paddingBottom: "max(12px, env(safe-area-inset-bottom, 0px))" }}
      >
        <div className="w-full max-w-lg flex items-center gap-3 rounded-[6px] border-2 border-strong bg-surface shadow-lg ps-3 pe-2 py-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icons/icon-192.png" alt="" width={36} height={36} className="size-9 rounded-[8px] shrink-0" />
          <div className="grid min-w-0 flex-1">
            <span className="font-bold text-sm">{t("pwa.bannerTitle")}</span>
            <span className="text-xs text-muted truncate">{ios ? t("pwa.iosShort") : t("pwa.bannerBody")}</span>
          </div>
          {!ios ? <Button size="sm" variant="accent" onClick={install}>{t("pwa.install")}</Button> : null}
          <button type="button" onClick={() => snooze(SNOOZE_BANNER_MS)} aria-label={t("common.close")} className="size-9 grid place-items-center rounded-full text-muted hover:text-ink shrink-0">
            <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" aria-hidden><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>
      </div>
    );
  }

  return (
    <Sheet
      open
      onClose={() => snooze(SNOOZE_PROMPT_MS)}
      title={t("pwa.title")}
      footer={
        <>
          <Button variant="ghost" onClick={() => snooze(SNOOZE_PROMPT_MS)}>{t("pwa.later")}</Button>
          {!ios ? <Button variant="accent" size="lg" onClick={install}>{t("pwa.install")}</Button> : <Button variant="accent" size="lg" onClick={() => snooze(SNOOZE_BANNER_MS)}>{t("pwa.gotIt")}</Button>}
        </>
      }
    >
      <div className="flex items-center gap-4">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/icons/icon-192.png" alt="" width={64} height={64} className="size-16 rounded-[14px] shadow" />
        <p className="text-sm leading-relaxed">{t("pwa.lead")}</p>
      </div>
      <ul className="grid gap-2 text-sm">
        {(["pwa.why1", "pwa.why2", "pwa.why3"] as const).map((k) => (
          <li key={k} className="flex gap-2"><span aria-hidden className="text-accent font-bold">●</span>{t(k)}</li>
        ))}
      </ul>
      {ios ? (
        <ol className="grid gap-2 text-sm border-2 border-line rounded-[6px] p-3">
          <li className="flex items-center gap-2">
            <span className="num font-bold">1</span>
            {t("pwa.ios1")}
            <svg viewBox="0 0 24 24" className="size-5 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M12 3v12M8 7l4-4 4 4M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7" /></svg>
          </li>
          <li className="flex items-center gap-2"><span className="num font-bold">2</span>{t("pwa.ios2")}</li>
        </ol>
      ) : null}
    </Sheet>
  );
}
