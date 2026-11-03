"use client";

import { useMemo, useState } from "react";
import { useErrorText, useI18n } from "@/lib/i18n";
import { billTotals, discountWithinCap, round2 } from "@/lib/billing";
import { errorCode, isNetworkError } from "@/lib/supabase";
import { normalizePhone } from "@/lib/phone";
import type { Bill, PayMethod } from "@/lib/types";
import { Button, Field, Input, Segmented, Sheet, Toggle, cx, useToast } from "@/components/ui";
import { billItemsTotal, customerById, itemsOf, ordersOfBill } from "../derive";
import { dispatch, dispatchOnline, getState, uuid } from "../store";
import { useIsOwner, useOnline, useSnap } from "../hooks";
import { printBill } from "../receipts";

const METHODS: PayMethod[] = ["cash", "instapay", "vf_cash"];

export function CheckoutSheet({ bill, onClose }: { bill: Bill; onClose: () => void }) {
  const { t, money, lang } = useI18n();
  const errText = useErrorText();
  const toast = useToast();
  const snap = useSnap();
  const isOwner = useIsOwner();
  const online = useOnline();
  const cust = customerById(snap, bill.customer_id);
  const items = billItemsTotal(snap, bill.id);
  const pendingNew = ordersOfBill(snap, bill.id).some((o) => o.status === "new");

  const [discKind, setDiscKind] = useState<"none" | "amount" | "percent">("none");
  const [discValue, setDiscValue] = useState("");
  const [discReason, setDiscReason] = useState("");
  const [amounts, setAmounts] = useState<Record<PayMethod, string>>({ cash: "", instapay: "", vf_cash: "" });
  const [payLater, setPayLater] = useState(false);
  const [cashGiven, setCashGiven] = useState("");
  const [ownerPhone, setOwnerPhone] = useState("");
  const [ownerPw, setOwnerPw] = useState("");
  const [print, setPrint] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tot = billTotals(items, bill.room_fee_share, { kind: discKind === "none" ? null : discKind, value: Number(discValue) || 0 });
  const paid = round2(METHODS.reduce((a, m) => a + (Number(amounts[m]) || 0), 0));
  const remaining = round2(tot.total - paid);
  const laterAmount = payLater && remaining > 0 ? remaining : 0;
  const overpaid = remaining < -0.001;
  const outstanding = cust?.outstanding ?? 0;
  const limit = cust?.debt_limit ?? 0;
  const overLimit = laterAmount > 0 && outstanding + laterAmount > limit + 0.009;
  const overCap = tot.discountAmount > 0 && !discountWithinCap(tot, snap.settings);
  const needsOwner = !isOwner && (overLimit || overCap);
  const cashChange = cashGiven ? round2((Number(cashGiven) || 0) - (Number(amounts.cash) || 0)) : 0;
  const balanced = Math.abs(paid + laterAmount - tot.total) < 0.005;
  const canSubmit = balanced && !overpaid && !pendingNew && (tot.discountAmount === 0 || discReason.trim()) && (!needsOwner || (ownerPhone && ownerPw && online));

  const lines = useMemo(
    () => ordersOfBill(snap, bill.id).filter((o) => o.status === "accepted" || o.status === "served").flatMap((o) => itemsOf(snap, o.id).filter((i) => !i.voided_at)),
    [snap, bill.id],
  );

  function fillRest(m: PayMethod) {
    const others = round2(METHODS.filter((x) => x !== m).reduce((a, x) => a + (Number(amounts[x]) || 0), 0));
    setAmounts((a) => ({ ...a, [m]: String(Math.max(0, round2(tot.total - others))) }));
  }

  async function submit() {
    setBusy(true);
    setError(null);
    const payload = {
      bill_id: bill.id,
      discount_kind: tot.discountAmount > 0 ? discKind : null,
      discount_value: tot.discountAmount > 0 ? Number(discValue) : null,
      discount_reason: tot.discountAmount > 0 ? discReason.trim() : null,
      payments: METHODS.filter((m) => (Number(amounts[m]) || 0) > 0).map((m) => ({ id: uuid(), method: m, amount: round2(Number(amounts[m])) })),
      pay_later: laterAmount,
    };
    try {
      if (needsOwner) await dispatchOnline("checkout", payload, { phone: normalizePhone(ownerPhone), password: ownerPw });
      else dispatch("checkout", payload);
      toast(t("co.done"));
      if (print) {
        const closed = getState().view?.bills.find((b) => b.id === bill.id);
        if (closed && getState().view) printBill(getState().view!, closed, lang, t);
      }
      onClose();
    } catch (e) {
      setError(errText(isNetworkError(e) ? "offline_owner" : errorCode(e)));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      open
      onClose={onClose}
      wide
      title={t("co.title", { name: cust?.name || cust?.phone || "" })}
      footer={
        <>
          <Toggle checked={print} onChange={setPrint} label={t("co.autoPrint")} />
          <Button variant="accent" size="lg" busy={busy} disabled={!canSubmit} onClick={submit}>
            {t("co.confirm")} · <span className="num">{money(tot.total)}</span>
          </Button>
        </>
      }
    >
      {pendingNew ? <p className="text-busy font-semibold">{t("err.pending_orders")}</p> : null}
      <div className="grid gap-1 text-sm">
        {lines.map((i) => (
          <div key={i.id} className="flex justify-between gap-2">
            <span><span className="num">{i.qty}×</span> {lang === "ar" ? i.name_ar : i.name_en}</span>
            <span className="num">{money(i.qty * i.unit_price)}</span>
          </div>
        ))}
        {bill.room_fee_share > 0 ? (
          <div className="flex justify-between gap-2">
            <span>{t("ss.roomFee")}</span>
            <span className="num">{money(bill.room_fee_share)}</span>
          </div>
        ) : null}
        <div className="flex justify-between gap-2 font-semibold border-t-2 border-line pt-1 mt-1">
          <span>{t("common.subtotal")}</span>
          <span className="num">{money(tot.subtotal)}</span>
        </div>
      </div>

      <fieldset className="grid gap-2">
        <legend className="font-semibold mb-1">{t("co.discount")}</legend>
        <Segmented value={discKind} onChange={setDiscKind} options={[{ value: "none", label: t("common.none") }, { value: "amount", label: t("co.discountAmount") }, { value: "percent", label: t("co.discountPercent") }]} />
        {discKind !== "none" ? (
          <div className="grid gap-2 sm:grid-cols-2">
            <Input id="disc-value" numeric value={discValue} onChange={(e) => setDiscValue(e.target.value)} placeholder="0" />
            <Input id="disc-reason" value={discReason} onChange={(e) => setDiscReason(e.target.value)} placeholder={t("co.discountReason")} maxLength={200} />
            {tot.discountAmount > 0 ? <span className="text-sm text-muted num">− {money(tot.discountAmount)}</span> : null}
          </div>
        ) : null}
      </fieldset>

      <div className="flex justify-between items-baseline gap-2 border-y-2 border-strong py-2">
        <span className="font-display text-xl font-bold">{t("common.total")}</span>
        <span className="num text-2xl font-bold">{money(tot.total)}</span>
      </div>

      <fieldset className="grid gap-2">
        <legend className="font-semibold mb-1">{t("co.payments")}</legend>
        {METHODS.map((m) => (
          <div key={m} className="grid grid-cols-[7.5rem_1fr_auto] gap-2 items-center">
            <label htmlFor={`pay-${m}`} className="font-semibold">{t(`co.${m}` as const)}</label>
            <Input id={`pay-${m}`} numeric value={amounts[m]} onChange={(e) => setAmounts((a) => ({ ...a, [m]: e.target.value }))} placeholder="0" />
            <Button size="sm" onClick={() => fillRest(m)}>{t("co.fillRest")}</Button>
          </div>
        ))}
        {Number(amounts.cash) > 0 ? (
          <div className="grid grid-cols-[7.5rem_1fr_auto] gap-2 items-center">
            <label htmlFor="cash-given" className="text-sm text-muted">{t("co.cashGiven")}</label>
            <Input id="cash-given" numeric value={cashGiven} onChange={(e) => setCashGiven(e.target.value)} placeholder="0" />
            <span className={cx("num text-sm font-semibold", cashChange < 0 ? "text-busy" : "")}>{cashGiven ? `${t("co.change")}: ${money(cashChange)}` : ""}</span>
          </div>
        ) : null}
        <div className={cx("flex justify-between gap-2 font-semibold", overpaid ? "text-busy" : remaining > 0 ? "text-warn" : "text-free")}>
          <span>{t("co.remaining")}</span>
          <span className="num">{money(remaining)}</span>
        </div>
        {remaining > 0 ? (
          <div className="grid gap-1">
            <Toggle checked={payLater} onChange={setPayLater} label={`${t("co.payLater")} · ${money(remaining)}`} />
            <span className="text-xs text-muted">{t("co.limitInfo", { owed: money(outstanding), limit: money(limit) })}</span>
          </div>
        ) : null}
      </fieldset>

      {needsOwner ? (
        <fieldset className="grid gap-2 border-2 border-warn rounded-[2px] p-3">
          <legend className="font-semibold px-1">{t("co.ownerApproval")}</legend>
          <p className="text-sm">{overCap ? t("err.discount_over_cap") : t("err.debt_limit")}</p>
          {!online ? <p className="text-sm text-busy font-semibold">{t("err.offline_owner")}</p> : null}
          <div className="grid gap-2 sm:grid-cols-2">
            <Field label={t("co.ownerPhone")}>
              <Input id="owner-phone" type="tel" value={ownerPhone} onChange={(e) => setOwnerPhone(e.target.value)} autoComplete="off" />
            </Field>
            <Field label={t("co.ownerPassword")}>
              <Input id="owner-pw" type="password" value={ownerPw} onChange={(e) => setOwnerPw(e.target.value)} autoComplete="off" />
            </Field>
          </div>
        </fieldset>
      ) : null}
      {error ? <p className="text-busy font-semibold">{error}</p> : null}
    </Sheet>
  );
}
