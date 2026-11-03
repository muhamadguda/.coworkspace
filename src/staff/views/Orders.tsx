"use client";

import { useState } from "react";
import { useI18n } from "@/lib/i18n";
import type { Order } from "@/lib/types";
import { Button, Card, Empty, Field, Input, Pill, SectionTitle, Sheet, cx } from "@/components/ui";
import { customerById, itemsOf, openBillOfCustomer, orderTotal, placeById } from "../derive";
import { dispatch, uuid } from "../store";
import { useNow, useSnap } from "../hooks";

export function OrdersView() {
  const { t } = useI18n();
  const snap = useSnap();
  const fresh = snap.orders.filter((o) => o.status === "new").sort((a, b) => a.created_at.localeCompare(b.created_at));
  const toServe = snap.orders.filter((o) => o.status === "accepted").sort((a, b) => (a.accepted_at ?? "").localeCompare(b.accepted_at ?? ""));
  return (
    <div className="grid gap-6 lg:grid-cols-2 items-start">
      <section className="grid gap-3">
        <SectionTitle>{t("o.new")} <span className="num">({fresh.length})</span></SectionTitle>
        {fresh.length ? fresh.map((o) => <OrderCard key={o.id} order={o} />) : <Empty>{t("o.noNew")}</Empty>}
      </section>
      <section className="grid gap-3">
        <SectionTitle>{t("o.preparing")} <span className="num">({toServe.length})</span></SectionTitle>
        {toServe.length ? toServe.map((o) => <OrderCard key={o.id} order={o} />) : <Empty>{t("o.noPreparing")}</Empty>}
      </section>
    </div>
  );
}

function ago(fromIso: string, now: Date) {
  const m = Math.max(0, Math.floor((now.getTime() - Date.parse(fromIso)) / 60000));
  return m < 60 ? `${m}′` : `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}′` : ""}`;
}

function OrderCard({ order }: { order: Order }) {
  const { t, n, money, lang } = useI18n();
  const snap = useSnap();
  const now = useNow(15000);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const cust = customerById(snap, order.customer_id);
  const place = placeById(snap, order.place_id);
  const openBill = openBillOfCustomer(snap, order.customer_id);
  const billPlace = openBill ? placeById(snap, openBill.place_id) : undefined;
  const elsewhere = openBill && openBill.place_id !== order.place_id;
  const isNew = order.status === "new";
  const isNewCustomer = cust?.created_at && Date.parse(cust.created_at) > Date.parse(order.created_at) - 120_000;

  return (
    <Card className={cx("p-3 grid gap-2", isNew && "border-busy")}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="grid">
          <span className="font-display text-xl font-bold">{place ? n(place) : t("common.counter")}</span>
          <span className="text-sm">
            {cust?.name || "—"} <span className="num text-muted">{cust?.phone}{cust?.code ? ` · ${cust.code}` : ""}</span>
          </span>
        </div>
        <div className="flex flex-col items-end gap-1">
          <Pill tone={isNew ? "busy" : "accent"}>{t("o.ago", { t: ago(order.created_at, now) })}</Pill>
          {isNewCustomer ? <Pill tone="warn">{t("o.newCustomer")}</Pill> : null}
          {elsewhere ? <Pill tone="warn">{t("o.hasOpenBillElsewhere", { place: billPlace ? n(billPlace) : t("common.counter") })}</Pill> : null}
        </div>
      </div>
      <ul className="grid gap-1 text-[15px]">
        {itemsOf(snap, order.id).map((i) => (
          <li key={i.id} className="flex justify-between gap-2">
            <span className="min-w-0">
              <span className="num font-bold">{i.qty}×</span> {lang === "ar" ? i.name_ar : i.name_en}
              {i.options.length ? <span className="text-muted"> · {i.options.map((x) => (lang === "ar" ? x.choice_ar : x.choice_en)).join(" · ")}</span> : null}
              {i.note ? <span className="text-warn font-semibold"> · {i.note}</span> : null}
            </span>
            <span className="num text-sm">{money(i.qty * i.unit_price)}</span>
          </li>
        ))}
      </ul>
      {order.note ? <p className="text-sm font-semibold text-warn border-s-4 border-warn ps-2">{order.note}</p> : null}
      <div className="flex items-center justify-between gap-2 border-t-2 border-line pt-2">
        <span className="num font-bold">{money(orderTotal(snap, order.id))}</span>
        <div className="flex gap-1.5">
          {isNew ? (
            <>
              <Button size="sm" onClick={() => setRejecting(true)}>{t("o.reject")}</Button>
              <Button size="md" variant="free" onClick={() => dispatch("accept_order", { order_id: order.id, bill_id: uuid() })}>{t("o.accept")}</Button>
            </>
          ) : (
            <Button size="md" variant="free" onClick={() => dispatch("serve_order", { order_id: order.id })}>{t("o.serve")}</Button>
          )}
        </div>
      </div>
      <Sheet open={rejecting} onClose={() => setRejecting(false)} title={t("o.reject")} footer={<Button variant="danger" onClick={() => { dispatch("reject_order", { order_id: order.id, reason: reason.trim() }); setRejecting(false); }}>{t("o.reject")}</Button>}>
        <Field label={t("o.rejectReason")}>
          <Input id="reject-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} />
        </Field>
      </Sheet>
    </Card>
  );
}
