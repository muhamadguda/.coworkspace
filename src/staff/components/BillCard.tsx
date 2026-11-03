"use client";

import { useState } from "react";
import { useI18n } from "@/lib/i18n";
import type { Bill } from "@/lib/types";
import { Button, Card, Field, Input, Pill, Sheet, cx } from "@/components/ui";
import { billItemsTotal, billRoomAmount, customerById, itemsOf, ordersOfBill, placeById } from "../derive";
import { dispatch } from "../store";
import { useNow, useSnap } from "../hooks";
import { printBill } from "../receipts";
import { OrderPad } from "./OrderPad";
import { CheckoutSheet } from "./CheckoutSheet";

export function BillCard({ bill, compact }: { bill: Bill; compact?: boolean }) {
  const { t, n, money, time, lang } = useI18n();
  const snap = useSnap();
  const now = useNow(15000);
  const [pad, setPad] = useState(false);
  const [moving, setMoving] = useState(false);
  const [checkout, setCheckout] = useState(false);
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [editQty, setEditQty] = useState("1");
  const [handover, setHandover] = useState(false);
  const cust = customerById(snap, bill.customer_id);
  const place = placeById(snap, bill.place_id);
  const orders = ordersOfBill(snap, bill.id).filter((o) => o.status !== "rejected");
  const items = billItemsTotal(snap, bill.id);
  const room = billRoomAmount(snap, bill, now);
  const sess = bill.session_id ? snap.sessions.find((s) => s.id === bill.session_id) : undefined;
  const isBooker = sess?.booker_customer_id === bill.customer_id;
  const title = cust?.name || cust?.phone || "—";

  return (
    <Card className="p-3 grid gap-3">
      <div className="flex items-start justify-between gap-2">
        <div className="grid min-w-0">
          <span className="font-semibold truncate">
            {title} {isBooker ? <Pill tone="accent">{t("ss.booker")}</Pill> : null}
          </span>
          <span className="num text-xs text-muted">{cust?.phone}{cust?.code ? ` · ${cust.code}` : ""}</span>
        </div>
        <div className="text-end">
          <div className="num font-bold text-lg">{money(items + room.amount)}</div>
          {!compact ? <div className="text-xs text-muted">{place ? n(place) : t("common.counter")}</div> : null}
        </div>
      </div>

      {orders.length ? (
        <ul className="grid gap-1.5">
          {orders.map((o) => (
            <li key={o.id} className={cx("grid gap-0.5 border-s-4 ps-2", o.status === "cancelled" ? "border-line opacity-50 line-through" : o.status === "new" ? "border-warn" : o.status === "served" ? "border-free" : "border-accent")}>
              {itemsOf(snap, o.id).map((i) => (
                <div key={i.id} className={cx("flex justify-between gap-2 text-sm", i.voided_at && "line-through opacity-50")}>
                  <span className="min-w-0">
                    <span className="num">{i.qty}×</span> {lang === "ar" ? i.name_ar : i.name_en}
                    {i.options.length ? <span className="text-muted"> · {i.options.map((x) => (lang === "ar" ? x.choice_ar : x.choice_en)).join(" · ")}</span> : null}
                    {i.note ? <span className="text-muted"> · {i.note}</span> : null}
                    {i.voided_at && i.void_reason ? <span className="text-muted no-underline"> · {i.void_reason}</span> : null}
                  </span>
                  <span className="flex items-center gap-2 shrink-0">
                    <span className="num">{money(i.qty * i.unit_price)}</span>
                    {!i.voided_at && (o.status === "accepted" || o.status === "served") ? (
                      <button type="button" className="text-xs font-semibold underline text-muted" onClick={() => { setEditing(i.id); setEditQty(String(i.qty)); setReason(""); }}>
                        {t("common.edit")}
                      </button>
                    ) : null}
                  </span>
                </div>
              ))}
              {o.status !== "cancelled" ? (
                <div className="flex items-center gap-2 text-xs text-muted">
                  <span>{time(o.created_at)}</span>
                  {o.status === "accepted" ? (
                    <button type="button" className="font-semibold text-free underline" onClick={() => dispatch("serve_order", { order_id: o.id })}>{t("o.serve")}</button>
                  ) : null}
                  {o.status === "accepted" || o.status === "served" ? (
                    <button type="button" className="font-semibold text-busy underline" onClick={() => { setReason(""); setCancelling(o.id); }}>{t("o.cancel")}</button>
                  ) : null}
                  {o.status === "new" ? <Pill tone="warn">{t("o.new")}</Pill> : null}
                </div>
              ) : (
                <span className="text-xs">{o.cancel_reason}</span>
              )}
            </li>
          ))}
        </ul>
      ) : null}

      {bill.session_id ? (
        <div className="flex justify-between text-sm">
          <span>{room.live ? (isBooker ? `${t("ss.roomFee")} (${t("b.estimate")})` : t("c.roomOnBooker")) : t("bl.roomShare")}</span>
          <span className="num">{money(room.amount)}</span>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-1.5">
        <Button size="sm" variant="accent" onClick={() => setPad(true)}>{t("o.addItems")}</Button>
        <Button size="sm" onClick={() => setMoving(true)}>{t("bl.move")}</Button>
        <Button size="sm" onClick={() => printBill(snap, bill, lang, t, { preBill: true })}>{t("r.preBill")}</Button>
        <Button size="sm" variant="primary" disabled={sess?.status === "active" && isBooker} title={sess?.status === "active" && isBooker ? t("bl.roomRunning") : undefined} onClick={() => setCheckout(true)}>
          {t("bl.checkout")}
        </Button>
      </div>
      {sess?.status === "active" && !isBooker ? (
        <Button
          size="sm"
          className="justify-self-start"
          onClick={() => setCheckout(true)}
        >
          {t("bl.leavesNow")}
        </Button>
      ) : null}
      {sess?.status === "active" && isBooker ? (
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-xs text-muted">{t("bl.roomRunning")}</p>
          {snap.bills.some((b) => b.session_id === sess.id && b.status === "open" && b.id !== bill.id) ? (
            <Button size="sm" variant="ghost" onClick={() => setHandover(true)}>{t("bl.handover")}</Button>
          ) : null}
        </div>
      ) : null}

      {pad ? <OrderPad billId={bill.id} title={title} open={pad} onClose={() => setPad(false)} /> : null}
      {checkout ? <CheckoutSheet bill={bill} onClose={() => setCheckout(false)} /> : null}
      {editing ? (
        <Sheet
          open
          onClose={() => setEditing(null)}
          title={t("bl.editItem")}
          footer={
            <>
              <Button variant="danger" disabled={!reason.trim()} onClick={() => { dispatch("edit_item", { item_id: editing, qty: 0, reason: reason.trim() }); setEditing(null); }}>
                {t("bl.removeItem")}
              </Button>
              <Button
                variant="primary"
                disabled={!reason.trim() || !(Number(editQty) >= 1 && Number(editQty) <= 50)}
                onClick={() => { dispatch("edit_item", { item_id: editing, qty: Number(editQty), reason: reason.trim() }); setEditing(null); }}
              >
                {t("common.save")}
              </Button>
            </>
          }
        >
          <p className="font-semibold">{(() => { const it = snap.order_items.find((x) => x.id === editing); return it ? (lang === "ar" ? it.name_ar : it.name_en) : ""; })()}</p>
          <Field label={t("common.qty")}>
            <Input id="edit-qty" numeric inputMode="numeric" value={editQty} onChange={(e) => setEditQty(e.target.value.replace(/\D/g, "").slice(0, 2))} />
          </Field>
          <Field label={t("d.reason")}>
            <Input id="edit-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} />
          </Field>
        </Sheet>
      ) : null}
      {handover && sess ? (
        <Sheet open onClose={() => setHandover(false)} title={t("bl.handover")}>
          <p className="text-sm text-muted">{t("bl.handoverHint")}</p>
          <div className="grid gap-2">
            {snap.bills.filter((b) => b.session_id === sess.id && b.status === "open" && b.id !== bill.id).map((b) => {
              const c = customerById(snap, b.customer_id);
              return (
                <Button key={b.id} onClick={() => { dispatch("transfer_booker", { session_id: sess.id, customer_id: b.customer_id }); setHandover(false); }}>
                  {c?.name || c?.phone}
                </Button>
              );
            })}
          </div>
        </Sheet>
      ) : null}
      <MoveSheet open={moving} onClose={() => setMoving(false)} billId={bill.id} currentPlace={bill.place_id} />

      <Sheet
        open={!!cancelling}
        onClose={() => setCancelling(null)}
        title={t("o.cancel")}
        footer={
          <Button variant="danger" disabled={!reason.trim()} onClick={() => { dispatch("cancel_order", { order_id: cancelling, reason: reason.trim() }); setCancelling(null); }}>
            {t("o.cancel")}
          </Button>
        }
      >
        <Field label={t("o.cancelReason")}>
          <Input id="cancel-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} />
        </Field>
      </Sheet>
    </Card>
  );
}

function MoveSheet({ open, onClose, billId, currentPlace }: { open: boolean; onClose: () => void; billId: string; currentPlace: string | null }) {
  const { t, n } = useI18n();
  const snap = useSnap();
  const places = snap.places.filter((p) => p.active && p.id !== currentPlace);
  const bill = snap.bills.find((b) => b.id === billId);
  function move(placeId: string | null) {
    const target = placeId ? snap.places.find((p) => p.id === placeId) : null;
    const activeSess = target?.kind === "room" ? snap.sessions.find((s) => s.place_id === target.id && s.status === "active") : undefined;
    if (target?.kind === "room" && !activeSess && bill) {
      // Free room: this customer becomes the booker of a new session there.
      onClose();
      window.dispatchEvent(new CustomEvent("dot:start-session", { detail: { placeId: target.id, customerId: bill.customer_id } }));
      return;
    }
    dispatch("move_bill", { bill_id: billId, place_id: placeId });
    onClose();
  }
  return (
    <Sheet open={open} onClose={onClose} title={t("bl.moveTo")}>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {places.map((p) => {
          const busy = p.kind === "room" ? snap.sessions.some((s) => s.place_id === p.id && s.status === "active") : snap.bills.some((b) => b.place_id === p.id && b.status === "open");
          return (
            <Button key={p.id} variant={busy ? "outline" : "free"} onClick={() => move(p.id)} className="h-14">
              {n(p)}
            </Button>
          );
        })}
        {currentPlace ? <Button className="h-14" onClick={() => move(null)}>{t("common.counter")}</Button> : null}
      </div>
    </Sheet>
  );
}
