"use client";

import { useState } from "react";
import { useI18n } from "@/lib/i18n";
import { rpc } from "@/lib/supabase";
import { getPushSubscription, pushSupport } from "@/lib/push";
import { Button } from "./ui";

const KEY = "dot.events.notify";
const read = () => {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
};

/** "Tell me about new events": a phone notification when the owner announces one. */
export function EventsNotify({ className }: { className?: string }) {
  const { t, lang } = useI18n();
  const [on, setOn] = useState(read);
  const [state, setState] = useState<"idle" | "busy" | "ios" | "blocked" | "unsupported">("idle");

  async function toggle(next: boolean) {
    const support = pushSupport();
    if (next && support === "ios-needs-install") return setState("ios");
    if (next && support === "denied") return setState("blocked");
    if (support === "unsupported") return setState("unsupported");
    setState("busy");
    try {
      const sub = await getPushSubscription();
      if (!sub) return setState(Notification.permission === "denied" ? "blocked" : "idle");
      await rpc("customer_events_watch", { p_sub: sub, p_lang: lang, p_on: next });
      try {
        localStorage.setItem(KEY, next ? "1" : "0");
      } catch {}
      setOn(next);
      setState("idle");
    } catch {
      setState("idle");
    }
  }

  const note = state === "ios" ? t("n.ios") : state === "blocked" ? t("n.blocked") : state === "unsupported" ? t("n.unsupported") : null;
  return (
    <div className={`flex flex-wrap items-center gap-3 ${className ?? ""}`}>
      {on ? (
        <>
          <span className="text-sm font-semibold text-free">{t("ev.notifyOn")}</span>
          <Button size="sm" variant="ghost" busy={state === "busy"} onClick={() => toggle(false)}>{t("ev.notifyOff")}</Button>
        </>
      ) : (
        <Button size="sm" variant="accent" busy={state === "busy"} onClick={() => toggle(true)}>
          <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0" /></svg>
          {t("ev.notify")}
        </Button>
      )}
      {note ? <span className="text-sm text-muted">{note}</span> : null}
    </div>
  );
}
