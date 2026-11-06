"use client";

import { useEffect, useMemo, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { Button, cx } from "@/components/ui";
import { activeSessionAt, openCalls, placeById } from "./derive";
import { audioReady, beep } from "./alarm";
import { dispatch } from "./store";
import { useNow, useSnap } from "./hooks";

type AlertItem = {
  key: string;
  tone: "busy" | "warn";
  text: string;
  urgent: boolean;
  actions: { label: string; onClick: () => void; variant?: "primary" | "accent" | "outline" }[];
};

const ACK_KEY = "dot.acks";
const readAcks = (): string[] => {
  try {
    return JSON.parse(localStorage.getItem(ACK_KEY) || "[]");
  } catch {
    return [];
  }
};

export function useAlerts(goto: (tab: string, focus?: string) => void) {
  const snap = useSnap();
  const now = useNow(5000);
  const { t, n, time } = useI18n();
  const [acks, setAcks] = useState<string[]>(readAcks);
  const [muted, setMuted] = useState(false);
  const ack = (key: string) => {
    const next = [...acks.filter((k) => k !== key), key].slice(-200);
    setAcks(next);
    try {
      localStorage.setItem(ACK_KEY, JSON.stringify(next));
    } catch {}
  };

  const alerts = useMemo<AlertItem[]>(() => {
    const out: AlertItem[] = [];
    // A guest pressed "Call staff" on their table's menu. After 15 minutes unanswered it counts as missed
    // (the owner sees it in Reports) and leaves the counter's screen.
    for (const c of openCalls(snap)) {
      if (now.getTime() - Date.parse(c.created_at) > 15 * 60_000) continue;
      const place = placeById(snap, c.place_id);
      out.push({
        key: `call:${c.id}`,
        tone: "busy",
        urgent: true,
        text: t(c.reason === "water" ? "call.aWater" : c.reason === "bill" ? "call.aBill" : "call.aHelp", { place: n(place), time: time(c.created_at) }),
        actions: [
          { label: t("a.open"), onClick: () => goto("board", c.place_id) },
          { label: t("call.done"), onClick: () => dispatch("handle_call", { call_id: c.id }), variant: "primary" },
        ],
      });
    }
    const newOrders = snap.orders.filter((o) => o.status === "new");
    if (newOrders.length) {
      const first = newOrders[0];
      const place = placeById(snap, first.place_id);
      out.push({
        key: "orders",
        tone: "busy",
        urgent: true,
        text: newOrders.length === 1 ? t("a.newOrder", { place: place ? n(place) : t("common.counter") }) : t("a.newOrders", { n: newOrders.length }),
        actions: [{ label: t("a.open"), onClick: () => goto("orders"), variant: "primary" }],
      });
    }
    for (const s of snap.sessions) {
      if (s.status !== "active" || s.kind !== "fixed" || !s.planned_end) continue;
      if (Date.parse(s.planned_end) > now.getTime() || s.alert_ack_for === s.planned_end) continue;
      const place = placeById(snap, s.place_id);
      const extend = (min: number) => dispatch("update_session", { session_id: s.id, kind: "fixed", planned_end: new Date(Date.parse(s.planned_end!) + min * 60000).toISOString() });
      out.push({
        key: `timeup:${s.id}:${s.planned_end}`,
        tone: "busy",
        urgent: true,
        text: t("a.timeUp", { place: n(place) }),
        actions: [
          { label: t("a.extend30"), onClick: () => extend(30) },
          { label: t("a.extend60"), onClick: () => extend(60) },
          { label: t("a.open"), onClick: () => goto("board", s.place_id) },
          { label: t("a.ack"), onClick: () => dispatch("ack_session_alert", { session_id: s.id, planned_end: s.planned_end }), variant: "primary" },
        ],
      });
    }
    const warnMs = snap.settings.booking_warning_minutes * 60000;
    for (const b of snap.bookings) {
      const place = placeById(snap, b.place_id);
      if (b.status === "pending") {
        const key = `req:${b.id}`;
        if (acks.includes(key)) continue;
        out.push({
          key, tone: "warn", urgent: false,
          text: t("a.bookingRequest", { place: n(place), time: time(b.starts_at) }),
          actions: [
            { label: t("a.open"), onClick: () => { ack(key); goto("bookings"); } },
            { label: t("a.ack"), onClick: () => ack(key), variant: "primary" },
          ],
        });
      } else if (b.status === "confirmed") {
        const start = Date.parse(b.starts_at);
        const key = `soon:${b.id}`;
        if (acks.includes(key) || start - now.getTime() > warnMs || start + 30 * 60000 < now.getTime()) continue;
        const busy = !!activeSessionAt(snap, b.place_id) && activeSessionAt(snap, b.place_id)?.booking_id !== b.id;
        out.push({
          key, tone: busy ? "busy" : "warn", urgent: busy,
          text: t(busy ? "a.bookingSoonBusy" : "a.bookingSoon", { place: n(place), time: time(b.starts_at) }),
          actions: [
            { label: t("a.open"), onClick: () => goto("board", b.place_id) },
            { label: t("a.ack"), onClick: () => ack(key), variant: "primary" },
          ],
        });
      }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snap, now, acks, t, n, time]);

  // Repeating alarm until handled.
  useEffect(() => {
    if (!alerts.length) return;
    const play = () => {
      if (muted || !audioReady()) return;
      beep(alerts.some((a) => a.urgent) ? "urgent" : "soft");
    };
    play();
    const id = setInterval(play, 3500);
    return () => clearInterval(id);
  }, [alerts, muted]);

  useEffect(() => {
    if (!muted) return;
    const id = setTimeout(() => setMuted(false), 60_000);
    return () => clearTimeout(id);
  }, [muted]);

  useEffect(() => {
    const base = "dot · Staff";
    document.title = alerts.length ? `(${alerts.length}) ${base}` : base;
  }, [alerts.length]);

  return { alerts, muted, mute: () => setMuted(true), unmute: () => setMuted(false) };
}

export function AlertBar({ alerts, muted, onMute, onUnmute }: { alerts: AlertItem[]; muted: boolean; onMute: () => void; onUnmute: () => void }) {
  const { t } = useI18n();
  if (!alerts.length) return null;
  return (
    <div className="grid gap-2" role="alert" aria-live="assertive">
      {alerts.map((a, i) => (
        <div key={a.key} className={cx("flex flex-wrap items-center gap-2 justify-between border-2 rounded-[2px] px-3 py-2", a.tone === "busy" ? "bg-busy text-white border-busy alarm" : "bg-warn-bg text-ink border-warn")}>
          <span className="font-bold text-[15px]">{a.text}</span>
          <div className="flex flex-wrap gap-1.5">
            {a.actions.map((x) => (
              <Button key={x.label} size="sm" variant={x.variant ?? "outline"} onClick={x.onClick}>
                {x.label}
              </Button>
            ))}
            {i === 0 ? (
              <Button size="sm" variant="ghost" className={a.tone === "busy" ? "text-white" : ""} onClick={muted ? onUnmute : onMute}>
                {muted ? t("a.unmute") : t("a.mute")}
              </Button>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
}
