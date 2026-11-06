"use client";

import { useState } from "react";
import { useI18n } from "@/lib/i18n";
import { rpc } from "@/lib/supabase";
import { getPushSubscription, pushSupport } from "@/lib/push";
import { Button } from "./ui";

/** "Notify me" for a customer: an order, a booking, or a room becoming free. */
export function NotifyButton({ kind, refId, label, className }: { kind: "order" | "booking" | "room"; refId: string; label: string; className?: string }) {
  const { t, lang } = useI18n();
  const [state, setState] = useState<"idle" | "busy" | "on" | "ios" | "blocked" | "unsupported">("idle");

  async function enable() {
    const support = pushSupport();
    if (support === "ios-needs-install") return setState("ios");
    if (support === "denied") return setState("blocked");
    if (support === "unsupported") return setState("unsupported");
    setState("busy");
    try {
      const sub = await getPushSubscription();
      if (!sub) return setState(Notification.permission === "denied" ? "blocked" : "idle");
      await rpc("customer_push_watch", { p_sub: sub, p_kind: kind, p_ref: refId, p_lang: lang });
      // Notifications allowed: new-event announcements come along, unless they stopped them on /events.
      try {
        if (localStorage.getItem("dot.events.notify") !== "0") {
          await rpc("customer_events_watch", { p_sub: sub, p_lang: lang, p_on: true });
          localStorage.setItem("dot.events.notify", "1");
        }
      } catch {}
      setState("on");
    } catch {
      setState("idle");
    }
  }

  if (state === "on") return <p className={`text-sm font-semibold text-free ${className ?? ""}`}>{t("n.on")}</p>;
  if (state === "ios") return <p className={`text-sm text-muted ${className ?? ""}`}>{t("n.ios")}</p>;
  if (state === "blocked") return <p className={`text-sm text-muted ${className ?? ""}`}>{t("n.blocked")}</p>;
  if (state === "unsupported") return <p className={`text-sm text-muted ${className ?? ""}`}>{t("n.unsupported")}</p>;
  return (
    <Button size="sm" variant="outline" className={className} busy={state === "busy"} onClick={enable}>
      {label}
    </Button>
  );
}
