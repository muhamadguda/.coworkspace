"use client";

import { formatClock, formatMoney } from "@/lib/i18n";
import { printHtml, receiptHtml, type ReceiptLine } from "@/lib/print";
import type { DictKey } from "@/lib/dict";
import type { Bill, Lang, Snapshot } from "@/lib/types";
import { billRoomAmount, billItemsTotal, customerById, dayStats, itemsOf, liveRoomFee, ordersOfBill, placeById } from "./derive";
import { billTotals } from "@/lib/billing";

type T = (k: DictKey, v?: Record<string, string | number>) => string;

const fmtDate = (iso: string, lang: Lang) =>
  new Intl.DateTimeFormat(lang === "ar" ? "ar-EG-u-nu-latn" : "en-GB", { timeZone: "Africa/Cairo", dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));

export function printBill(snap: Snapshot, bill: Bill, lang: Lang, t: T, opts: { preBill?: boolean; discount?: { kind: "amount" | "percent" | null; value: number } } = {}) {
  const nm = (o: { name_ar: string; name_en: string } | undefined | null) => (o ? (lang === "ar" ? o.name_ar : o.name_en) : "");
  const cust = customerById(snap, bill.customer_id);
  const place = placeById(snap, bill.place_id);
  const lines: ReceiptLine[] = [];
  for (const o of ordersOfBill(snap, bill.id)) {
    if (o.status !== "accepted" && o.status !== "served") continue;
    for (const i of itemsOf(snap, o.id)) {
      lines.push({ label: nm(i), qty: i.qty, amount: i.qty * i.unit_price, sub: i.options.map((x) => (lang === "ar" ? x.choice_ar : x.choice_en)).join(" · ") || undefined });
    }
  }
  const now = new Date();
  const room = billRoomAmount(snap, bill, now);
  if (bill.session_id && room.amount > 0) {
    const sess = snap.sessions.find((s) => s.id === bill.session_id);
    let sub: string | undefined;
    if (sess) {
      const fee = liveRoomFee(snap, sess, sess.ended_at ? new Date(sess.ended_at) : now, sess.overstay_charged ?? true);
      sub = fee.lines.map((l) => `${nm(snap.modes.find((m) => m.id === l.mode_id))} ${formatClock(l.minutes)} × ${formatMoney(l.rate)}`).join(" · ");
      if (room.amount !== fee.fee) sub = `${sub} (${formatMoney(fee.fee)})`;
    }
    lines.push({ label: t("ss.roomFee"), amount: room.amount, sub });
  }
  const closed = bill.status === "closed";
  const items = billItemsTotal(snap, bill.id);
  const tot = closed
    ? { subtotal: bill.subtotal ?? 0, discountAmount: bill.discount_amount, total: bill.total ?? 0 }
    : billTotals(items, room.amount, opts.discount ?? { kind: null, value: 0 });
  const totals = [{ label: t("common.subtotal"), value: tot.subtotal }];
  if (tot.discountAmount > 0) totals.push({ label: `${t("co.discount")}${bill.discount_reason ? ` (${bill.discount_reason})` : ""}`, value: -tot.discountAmount });
  totals.push({ label: t("common.total"), value: tot.total, strong: true } as { label: string; value: number; strong?: boolean });
  const pays = closed ? snap.payments.filter((p) => p.bill_id === bill.id && p.kind === "bill") : [];
  const payments = pays.map((p) => ({ label: t(`co.${p.method}` as DictKey), value: p.amount }));
  if (closed && bill.pay_later > 0) payments.push({ label: t("r.payLater"), value: bill.pay_later });

  printHtml(
    receiptHtml({
      lang,
      title: opts.preBill || !closed ? t("r.preBill") : t("r.receipt"),
      venue: { name: snap.settings.venue_name, address: snap.settings.venue_address, whatsapp: snap.settings.venue_whatsapp, footer: lang === "ar" ? snap.settings.receipt_footer_ar : snap.settings.receipt_footer_en },
      meta: [
        { label: t("r.no"), value: bill.id.slice(0, 8).toUpperCase() },
        { label: t("r.customer"), value: [cust?.name, cust?.phone].filter(Boolean).join(" · ") },
        ...(cust?.code ? [{ label: t("common.code"), value: cust.code }] : []),
        { label: t("r.place"), value: place ? nm(place) : t("common.counter") },
        { label: "", value: fmtDate(bill.closed_at ?? now.toISOString(), lang) },
      ],
      lines,
      totals,
      payments,
    }),
  );
}

export function printDayReport(snap: Snapshot, day: string, lang: Lang, t: T, counted?: number) {
  const st = dayStats(snap, day);
  printHtml(
    receiptHtml({
      lang,
      title: `${t("d.title")} · ${day}`,
      venue: { name: snap.settings.venue_name, address: snap.settings.venue_address, whatsapp: "", footer: snap.me.name },
      meta: [{ label: "", value: fmtDate(new Date().toISOString(), lang) }],
      lines: [
        { label: t("co.cash"), amount: st.byMethod.cash },
        { label: t("co.instapay"), amount: st.byMethod.instapay },
        { label: t("co.vf_cash"), amount: st.byMethod.vf_cash },
        ...st.outs.map((o) => ({ label: `${t("d.cashOut")}: ${o.reason}`, amount: -o.amount })),
      ],
      totals: [
        { label: t("d.opening"), value: st.opening },
        { label: t("d.expected"), value: st.expected, strong: true },
        ...(counted != null ? [{ label: t("d.counted"), value: counted }, { label: t("d.difference"), value: Math.round((counted - st.expected) * 100) / 100 }] : []),
      ],
    }),
  );
}
