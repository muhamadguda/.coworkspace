"use client";

import { formatClock, formatMoney } from "@/lib/i18n";
import { printHtml, receiptHtml, type ReceiptData, type ReceiptLine } from "@/lib/print";
import { openWhatsApp } from "@/lib/phone";
import type { DictKey } from "@/lib/dict";
import type { Bill, Lang, Snapshot } from "@/lib/types";
import { activeBundlesOf, billRoomAmount, billItemsTotal, bundleUseOfSession, customerById, dayStats, fmtHours, itemsOf, liveRoomFee, ordersOfBill, placeById } from "./derive";
import { billTotals } from "@/lib/billing";

type T = (k: DictKey, v?: Record<string, string | number>) => string;

const fmtDate = (iso: string, lang: Lang) =>
  new Intl.DateTimeFormat(lang === "ar" ? "ar-EG-u-nu-latn" : "en-GB", { timeZone: "Africa/Cairo", dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));

type BillOpts = { preBill?: boolean; discount?: { kind: "amount" | "percent" | null; value: number } };

export function printBill(snap: Snapshot, bill: Bill, lang: Lang, t: T, opts: BillOpts = {}) {
  printHtml(receiptHtml(buildBillReceipt(snap, bill, lang, t, opts)));
}

/** Plain-text receipt in WhatsApp, ready to send to the customer's number. */
export function whatsappBill(snap: Snapshot, bill: Bill, lang: Lang, t: T) {
  const cust = customerById(snap, bill.customer_id);
  if (!cust) return;
  const d = buildBillReceipt(snap, bill, lang, t, {});
  const out: string[] = [`*${d.venue.name} · ${d.title}*`];
  for (const m of d.meta) if (m.value) out.push(m.label ? `${m.label}: ${m.value}` : m.value);
  out.push("");
  for (const l of d.lines) out.push(`${l.qty && l.qty > 1 ? `${l.qty}× ` : ""}${l.label}: ${formatMoney(l.amount)}${l.sub ? `\n  ${l.sub}` : ""}`);
  out.push("");
  for (const x of d.totals) out.push(x.strong ? `*${x.label}: ${formatMoney(x.value)}*` : `${x.label}: ${formatMoney(x.value)}`);
  for (const x of d.payments ?? []) out.push(`${x.label}: ${formatMoney(x.value)}`);
  const b = activeBundlesOf(snap, bill.customer_id)[0];
  if (b) out.push("", t("wa.msgBundle", { h: fmtHours(b.minutes_total - b.minutes_used), d: fmtDay(b.expires_at, lang) }));
  out.push("", t("wa.thanks"));
  if (d.venue.footer) out.push(d.venue.footer);
  openWhatsApp(cust.phone, out.join("\n"));
}

export const fmtDay = (iso: string, lang: Lang) =>
  new Intl.DateTimeFormat(lang === "ar" ? "ar-EG-u-nu-latn" : "en-GB", { timeZone: "Africa/Cairo", day: "numeric", month: "short" }).format(new Date(iso));

function buildBillReceipt(snap: Snapshot, bill: Bill, lang: Lang, t: T, opts: BillOpts): ReceiptData {
  const nm = (o: { name_ar: string; name_en: string } | undefined | null) => (o ? (lang === "ar" ? o.name_ar : o.name_en) : "");
  const cust = customerById(snap, bill.customer_id);
  const place = placeById(snap, bill.place_id);
  const lines: ReceiptLine[] = [];
  for (const o of ordersOfBill(snap, bill.id)) {
    if (o.status !== "accepted" && o.status !== "served") continue;
    for (const i of itemsOf(snap, o.id).filter((x) => !x.voided_at)) {
      lines.push({ label: nm(i), qty: i.qty, amount: i.qty * i.unit_price, sub: i.options.map((x) => (lang === "ar" ? x.choice_ar : x.choice_en)).join(" · ") || undefined });
    }
  }
  const now = new Date();
  const room = billRoomAmount(snap, bill, now);
  if (bill.session_id && (room.amount > 0 || bundleUseOfSession(snap, bill.session_id).length)) {
    const sess = snap.sessions.find((s) => s.id === bill.session_id);
    let sub: string | undefined;
    if (sess) {
      const fee = liveRoomFee(snap, sess, sess.ended_at ? new Date(sess.ended_at) : now, sess.overstay_charged ?? true);
      sub = fee.lines.map((l) => `${nm(snap.modes.find((m) => m.id === l.mode_id))} ${formatClock(l.minutes)} × ${formatMoney(l.rate)}`).join(" · ");
      const used = bundleUseOfSession(snap, sess.id);
      const gross = fee.fee;
      if (used.length) sub = `${sub} · ${t("bu.used")}: ${used.map((u) => `${formatClock(u.minutes)} −${formatMoney(u.amount)}`).join(", ")}`;
      else if (room.amount !== gross) sub = `${sub} (${formatMoney(gross)})`;
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
  const pays = closed ? snap.payments.filter((p) => p.bill_id === bill.id && p.kind === "bill" && !p.voided_at) : [];
  const payments = pays.map((p) => ({ label: t(`co.${p.method}` as DictKey), value: p.amount }));
  if (closed && bill.pay_later > 0) payments.push({ label: t("r.payLater"), value: bill.pay_later });

  return {
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
  };
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
