"use client";

import { useI18n } from "@/lib/i18n";
import { businessDay, round2 } from "@/lib/billing";
import { Card, Pill, SectionTitle } from "@/components/ui";
import { useNow, useSnap } from "../hooks";
import { billRunningTotal, currentBusinessDay, dayStats, isLowStock, openBills } from "../derive";

/** Live summary of the business day for the owner, from the counter's own data (works offline). */
export function TodayCard() {
  const { t, n, money, dur } = useI18n();
  const snap = useSnap();
  const now = useNow(30_000);
  const day = currentBusinessDay(snap, now);
  const roll = snap.settings.day_rollover_hour;
  const st = dayStats(snap, day);

  const open = openBills(snap);
  const openTotal = round2(open.reduce((a, b) => a + billRunningTotal(snap, b, now), 0));
  const closedToday = snap.bills.filter((b) => b.status === "closed" && b.business_day === day);
  const discounts = round2(closedToday.reduce((a, b) => a + (b.discount_amount || 0), 0));

  const sessionsToday = snap.sessions.filter((s) => businessDay(s.started_at, roll) === day);
  const minutesByPlace = new Map<string, number>();
  for (const s of sessionsToday) {
    const end = s.ended_at ? Date.parse(s.ended_at) : now.getTime();
    minutesByPlace.set(s.place_id, (minutesByPlace.get(s.place_id) ?? 0) + Math.max(0, (end - Date.parse(s.started_at)) / 60000));
  }
  const busiest = [...minutesByPlace.entries()].sort((a, b) => b[1] - a[1])[0];
  const busyNow = snap.sessions.filter((s) => s.status === "active").length;
  const rooms = snap.places.filter((p) => p.kind === "room" && p.active).length;

  const countedOrders = new Set(snap.orders.filter((o) => (o.status === "accepted" || o.status === "served") && businessDay(o.created_at, roll) === day).map((o) => o.id));
  const qty = new Map<string, { name: { name_ar: string; name_en: string }; q: number }>();
  for (const i of snap.order_items) {
    if (!countedOrders.has(i.order_id) || i.voided_at || !i.menu_item_id) continue;
    const cur = qty.get(i.menu_item_id) ?? { name: i, q: 0 };
    cur.q += i.qty;
    qty.set(i.menu_item_id, cur);
  }
  const top = [...qty.values()].sort((a, b) => b.q - a.q)[0];

  const bundlesToday = (snap.customer_bundles ?? []).filter((b) => businessDay(b.created_at, roll) === day);
  const sold = bundlesToday.filter((b) => b.source !== "loyalty");
  const rewards = bundlesToday.filter((b) => b.source === "loyalty").length;
  const pending = snap.orders.filter((o) => o.status === "new").length + snap.bookings.filter((b) => b.status === "pending").length;
  const low = snap.items.filter((i) => i.active && isLowStock(i));

  return (
    <Card className="p-4 grid gap-4 border-strong">
      <SectionTitle>{t("td.title")} <span className="num text-sm font-normal text-muted">{day}</span></SectionTitle>
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <Stat label={t("td.collected")} value={money(st.total)} sub={`${t("co.cash")} ${money(st.byMethod.cash)} · ${t("co.instapay")} ${money(st.byMethod.instapay)} · ${t("co.vf_cash")} ${money(st.byMethod.vf_cash)}`} strong />
        <Stat label={t("td.open")} value={money(openTotal)} sub={`${open.length}`} />
        <Stat label={t("td.roomsBusy")} value={`${busyNow} / ${rooms}`} sub={`${t("td.sessions")}: ${sessionsToday.length}`} />
        <Stat label={t("td.discounts")} value={money(discounts)} />
        <Stat label={t("td.busiest")} value={busiest ? n(snap.places.find((p) => p.id === busiest[0])) : t("td.nothing")} sub={busiest ? dur(Math.round(busiest[1])) : undefined} />
        <Stat label={t("td.topItem")} value={top ? n(top.name) : t("td.nothing")} sub={top ? `×${top.q}` : undefined} />
        <Stat label={t("td.bundlesSold")} value={String(sold.length)} sub={sold.length ? money(sold.reduce((a, b) => a + b.price, 0)) : undefined} />
        <Stat label={t("td.rewards")} value={String(rewards)} sub={pending ? `${t("td.pending")}: ${pending}` : undefined} />
      </div>
      <div className="grid gap-2">
        <span className="font-semibold">{t("td.lowStock")}</span>
        {low.length ? (
          <div className="flex flex-wrap gap-1.5">
            {low.map((i) => <Pill key={i.id} tone={(i.stock_qty ?? 0) <= 0 ? "busy" : "warn"}>{n(i)} · <span className="num">{i.stock_qty ?? 0}</span></Pill>)}
          </div>
        ) : <span className="text-sm text-muted">{t("td.noneLow")}</span>}
      </div>
    </Card>
  );
}

function Stat({ label, value, sub, strong }: { label: string; value: string; sub?: string; strong?: boolean }) {
  return (
    <div className={`grid gap-0.5 rounded-[2px] border-2 p-3 min-w-0 ${strong ? "border-strong" : "border-line"}`}>
      <span className="text-xs text-muted">{label}</span>
      <span className="num text-lg font-bold truncate">{value}</span>
      {sub ? <span className="num text-xs text-muted truncate">{sub}</span> : null}
    </div>
  );
}
