"use client";

import { useMemo, useState } from "react";
import { useErrorText, useI18n } from "@/lib/i18n";
import { errorCode, rpc, supabase } from "@/lib/supabase";
import { downloadCsv, intlPhone } from "@/lib/csv";
import { round2 } from "@/lib/billing";
import type { Customer, PayMethod } from "@/lib/types";
import { Button, Card, Empty, Field, Input, Pill, SectionTitle, Segmented, Sheet, Toggle, useToast } from "@/components/ui";
import { activeBundlesOf, fmtHours, openBillOfCustomer, placeById, searchCustomers } from "../derive";
import { openWhatsApp, waNumber } from "@/lib/phone";
import { fmtDay } from "../receipts";
import { dispatch, refresh, uuid } from "../store";
import { useIsOwner, useOnline, useSnap } from "../hooks";

export function CustomersView() {
  const { t } = useI18n();
  const snap = useSnap();
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<string | null>(null);
  const results = useMemo(() => (q.trim() ? searchCustomers(snap, q, 50) : []), [snap, q]);
  const debtors = snap.customers.filter((c) => c.outstanding > 0).sort((a, b) => b.outstanding - a.outstanding);
  const list = q.trim() ? results : debtors;
  const selected = sel ? snap.customers.find((c) => c.id === sel) : undefined;

  return (
    <div className="grid gap-4">
      <OffersExport />
      <Field label={t("cu.search")}>
        <Input id="cust-q" value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" />
      </Field>
      <SectionTitle>{q.trim() ? t("cu.all") : t("cu.debtors")} <span className="num">({list.length})</span></SectionTitle>
      {list.length ? (
        <Card className="divide-y-2 divide-line">
          {list.map((c) => <CustomerLine key={c.id} c={c} onOpen={() => setSel(c.id)} />)}
        </Card>
      ) : (
        <Empty>{t("common.none")}</Empty>
      )}
      {selected ? <CustomerSheet c={selected} onClose={() => setSel(null)} /> : null}
    </div>
  );
}

/** Owner: the WhatsApp offers list, only customers who said yes. */
function OffersExport() {
  const { t } = useI18n();
  const isOwner = useIsOwner();
  const online = useOnline();
  const toast = useToast();
  const errText = useErrorText();
  const [busy, setBusy] = useState(false);
  if (!isOwner) return null;
  async function run() {
    setBusy(true);
    try {
      const { data, error } = await supabase().from("customers").select("name, phone, offers_opt_in_at, created_at").eq("offers_opt_in", true).order("offers_opt_in_at", { ascending: false }).limit(10000);
      if (error) throw error;
      const rows = (data ?? []).map((c) => [c.name, intlPhone(waNumber(c.phone)), c.phone, (c.offers_opt_in_at ?? "").slice(0, 10), (c.created_at ?? "").slice(0, 10)]);
      if (!rows.length) {
        toast(t("of.none"));
        return;
      }
      downloadCsv(`dot-offers-${new Date().toISOString().slice(0, 10)}.csv`, ["name", "phone", "phone_local", "opted_in", "customer_since"], rows);
      toast(t("of.exported", { n: rows.length }));
    } catch (e) {
      toast(errText(errorCode(e)), "error");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card className="p-3 flex flex-wrap items-center justify-between gap-2">
      <span className="grid">
        <span className="font-semibold">{t("of.listTitle")}</span>
        <span className="text-xs text-muted">{t("of.listHint")}</span>
      </span>
      <Button size="sm" busy={busy} disabled={!online} onClick={run}>{t("of.export")}</Button>
    </Card>
  );
}

function CustomerLine({ c, onOpen }: { c: Customer; onOpen: () => void }) {
  const { t, money } = useI18n();
  return (
    <button type="button" onClick={onOpen} className="w-full text-start flex items-center justify-between gap-2 px-3 py-2 hover:bg-surface-2">
      <span className="grid min-w-0">
        <span className="font-semibold truncate">{c.name || "—"}</span>
        <span className="num text-sm text-muted">{c.phone}{c.code ? ` · ${c.code}` : ""}</span>
      </span>
      {c.outstanding > 0 ? <Pill tone="busy">{t("cu.owes", { amount: money(c.outstanding) })}</Pill> : null}
    </button>
  );
}

function CustomerSheet({ c, onClose }: { c: Customer; onClose: () => void }) {
  const { t, n, money, lang } = useI18n();
  const errText = useErrorText();
  const toast = useToast();
  const snap = useSnap();
  const isOwner = useIsOwner();
  const online = useOnline();
  const [name, setName] = useState(c.name);
  const [limit, setLimit] = useState(String(c.debt_limit));
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<PayMethod>("cash");
  const openBill = openBillOfCustomer(snap, c.id);
  const bundles = activeBundlesOf(snap, c.id);
  const visits = snap.visits?.[c.id] ?? 0;
  const loyaltyEvery = snap.settings.loyalty_every ?? 0;
  const plans = (snap.bundle_plans ?? []).filter((x) => x.active !== false);

  async function saveLimit() {
    try {
      await rpc("owner_set_debt_limit", { p_customer: c.id, p_limit: round2(Number(limit) || 0) });
      await refresh();
      toast(t("common.saved"));
    } catch (e) {
      toast(errText(errorCode(e)), "error");
    }
  }

  return (
    <Sheet open onClose={onClose} title={c.name || c.phone}>
      <div className="flex flex-wrap gap-2 text-sm">
        <Pill className="num">{c.phone}</Pill>
        {c.code ? <Pill className="num">{t("common.code")}: {c.code}</Pill> : <Pill tone="warn">{t("cu.codePending")}</Pill>}
        {openBill ? <Pill tone="warn">{n(placeById(snap, openBill.place_id)) || t("common.counter")}</Pill> : null}
      </div>
      <div className="grid gap-2 sm:grid-cols-[1fr_auto] items-end">
        <Field label={t("common.name")}>
          <Input id="cu-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
        </Field>
        <Button disabled={name.trim() === c.name} onClick={() => { dispatch("rename_customer", { customer_id: c.id, name: name.trim() }); toast(t("common.saved")); }}>{t("common.save")}</Button>
      </div>

      <Toggle checked={!!c.offers_opt_in} onChange={(v) => { dispatch("set_offers", { customer_id: c.id, on: v }); toast(t("common.saved")); }} label={t("of.staffLabel")} />

      <Card className="p-3 grid gap-3">
        <div className="flex justify-between gap-2 font-semibold">
          <span>{t("c.outstanding")}</span>
          <span className="num">{money(c.outstanding)}</span>
        </div>
        <div className="text-sm text-muted">{t("cu.limit")}: <span className="num">{money(c.debt_limit)}</span></div>
        {c.outstanding > 0 ? (
          <div className="grid gap-2">
            <Segmented value={method} onChange={setMethod} options={[{ value: "cash", label: t("co.cash") }, { value: "instapay", label: t("co.instapay") }, { value: "vf_cash", label: t("co.vf_cash") }]} />
            <div className="grid gap-2 grid-cols-[1fr_auto]">
              <Input id="cu-pay" numeric value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={String(c.outstanding)} />
              <Button
                variant="free"
                disabled={!(Number(amount) > 0) || Number(amount) > c.outstanding + 0.001}
                onClick={() => { dispatch("pay_debt", { customer_id: c.id, method, amount: round2(Number(amount)) }); setAmount(""); toast(t("common.saved")); }}
              >
                {t("cu.payDebt")}
              </Button>
            </div>
            <Button size="sm" className="justify-self-start" onClick={() => openWhatsApp(c.phone, t("wa.msgDebt", { name: c.name ? ` ${c.name}` : "", amount: money(c.outstanding) }))}>{t("wa.reminder")}</Button>
          </div>
        ) : null}
      </Card>

      {loyaltyEvery > 0 ? (
        <Card className="p-3 grid gap-2">
          <div className="flex justify-between gap-2 font-semibold">
            <span>{t("ly.visits")}</span>
            <span className="num">{visits}</span>
          </div>
          <div className="flex gap-1" aria-hidden>
            {Array.from({ length: loyaltyEvery }).map((_, i) => (
              <span key={i} className={`h-2.5 flex-1 rounded-full ${i < visits % loyaltyEvery ? "bg-accent" : "bg-line"}`} />
            ))}
          </div>
          <span className="text-sm text-muted">{t("ly.nextIn", { n: loyaltyEvery - (visits % loyaltyEvery), m: snap.settings.loyalty_reward_minutes ?? 60 })}</span>
        </Card>
      ) : null}

      <Card className="p-3 grid gap-2">
        <span className="font-semibold">{t("bu.title")}</span>
        {bundles.map((b) => (
          <div key={b.id} className="flex flex-wrap justify-between gap-2 text-sm">
            <span>{n(b)} · <span className="text-muted">{t("bu.expires", { d: fmtDay(b.expires_at, lang) })}</span></span>
            <span className="num font-bold">{t("bu.left", { h: fmtHours(b.minutes_total - b.minutes_used) })}</span>
          </div>
        ))}
        {plans.length ? (
          <div className="flex flex-wrap gap-1.5">
            {plans.map((pl) => (
              <Button key={pl.id} size="sm" variant="accent" onClick={() => {
                dispatch("sell_bundle", { id: uuid(), plan_id: pl.id, customer_id: c.id, bill_id: openBill?.id ?? uuid(), order_id: uuid(), item_id: uuid() });
                toast(t("bu.sold"));
              }}>
                {t("bu.sell")}: {n(pl)} · <span className="num">{money(pl.price)}</span>
              </Button>
            ))}
          </div>
        ) : <span className="text-sm text-muted">{t("bu.none")}</span>}
      </Card>

      {isOwner ? (
        <div className="grid gap-2 sm:grid-cols-[1fr_auto] items-end">
          <Field label={t("cu.limit")} hint={!online ? t("m.onlineOnly") : undefined}>
            <Input id="cu-limit" numeric value={limit} onChange={(e) => setLimit(e.target.value)} />
          </Field>
          <Button variant="primary" disabled={!online || Number(limit) === c.debt_limit} onClick={saveLimit}>{t("common.save")}</Button>
        </div>
      ) : null}
    </Sheet>
  );
}
