"use client";

import { useCallback, useEffect, useState } from "react";
import { useErrorText, useI18n } from "@/lib/i18n";
import { errorCode, rpc, supabase } from "@/lib/supabase";
import { businessDay, round2 } from "@/lib/billing";
import { Button, Card, Empty, Field, Input, SectionTitle, Segmented, Spinner, cx } from "@/components/ui";
import { useSnap } from "../hooks";
import { TodayCard } from "./TodayCard";

type Report = {
  from: string; to: string;
  payments_by_method: Partial<Record<"cash" | "instapay" | "vf_cash", number>>;
  debt_collected: number;
  bills: { count: number; items_total: number; room_fees: number; subtotal: number; discounts: number; total: number; pay_later: number };
  by_day: { day: string; total: number; bills: number }[];
  room_usage: { place_id: string; name_ar: string; name_en: string; mode_ar: string; mode_en: string; minutes: number; sessions: number }[];
  room_fees_by_room: { name_ar: string; name_en: string; fee: number; sessions: number }[];
  top_items: { name_ar: string; name_en: string; qty: number; revenue: number }[];
  discounts: { bill_id: string; day: string; amount: number; reason: string; customer: string; phone: string; by: string }[];
  debts: { customer_id: string; name: string; phone: string; outstanding: number; debt_limit: number }[];
  cash_days: { business_day: string; opening_float: number; closing_counted: number | null; expected_cash: number | null }[];
  cash_outs: { day: string; amount: number; reason: string; by: string; at: string }[];
  cancellations: { order_id: string; reason: string; by: string; at: string; amount: number }[];
  voided_items?: { name_ar: string; name_en: string; qty: number; amount: number; reason: string; by: string; at: string }[];
};

type AppError = { id: number; at: string; source: string; message: string; url: string | null };

function csvCell(v: unknown) {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** One CSV with a section per table; UTF-8 BOM so Excel shows Arabic correctly. */
function downloadCsv(name: string, sections: { title: string; head: string[]; rows: unknown[][] }[]) {
  const lines: string[] = [];
  for (const s of sections) {
    lines.push(csvCell(s.title));
    lines.push(s.head.map(csvCell).join(","));
    for (const r of s.rows) lines.push(r.map(csvCell).join(","));
    lines.push("");
  }
  const blob = new Blob(["\ufeff" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

const addDays = (d: string, n: number) => {
  const x = new Date(`${d}T12:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};

export function Reports() {
  const { t, money, dur, lang, time } = useI18n();
  const errText = useErrorText();
  const snap = useSnap();
  const today = businessDay(new Date(), snap.settings.day_rollover_hour);
  const [range, setRange] = useState<"today" | "yesterday" | "week" | "month" | "custom">("today");
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [data, setData] = useState<Report | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (f: string, tt: string) => {
    setBusy(true);
    setError(null);
    try {
      setData(await rpc<Report>("owner_report", { p_from: f, p_to: tt }));
    } catch (e) {
      setError(errText(errorCode(e)));
    } finally {
      setBusy(false);
    }
  }, [errText]);

  function pickRange(r: typeof range) {
    setRange(r);
    if (r === "custom") return;
    let f = today, tt = today;
    if (r === "yesterday") f = tt = addDays(today, -1);
    if (r === "week") f = addDays(today, -6);
    if (r === "month") f = `${today.slice(0, 8)}01`;
    setFrom(f);
    setTo(tt);
    void load(f, tt);
  }

  useEffect(() => {
    rpc<Report>("owner_report", { p_from: today, p_to: today }).then(setData).catch((e) => setError(errText(errorCode(e))));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [errors, setErrors] = useState<AppError[] | null>(null);
  useEffect(() => {
    supabase().from("app_errors").select("id, at, source, message, url").order("at", { ascending: false }).limit(30)
      .then(({ data: rows }) => setErrors((rows as AppError[]) ?? []));
  }, []);

  function exportCsv() {
    if (!data) return;
    const nmx = (o: { name_ar: string; name_en: string }) => (lang === "ar" ? o.name_ar : o.name_en);
    downloadCsv(`dot-report-${data.from}_${data.to}.csv`, [
      { title: t("rp.revenue"), head: ["metric", "EGP"], rows: [
        [t("rp.revenue"), data.bills.total], [t("rp.bills"), data.bills.count], [t("rp.items"), data.bills.items_total], [t("rp.roomFees"), data.bills.room_fees],
        [t("rp.discounts"), data.bills.discounts], [t("rp.payLater"), data.bills.pay_later], [t("rp.debtCollected"), data.debt_collected],
        [t("co.cash"), m.cash ?? 0], [t("co.instapay"), m.instapay ?? 0], [t("co.vf_cash"), m.vf_cash ?? 0],
      ] },
      { title: t("rp.byDay"), head: ["day", "bills", "total"], rows: data.by_day.map((d) => [d.day, d.bills, d.total]) },
      { title: t("rp.roomUsage"), head: ["room", "mode", "minutes", "sessions"], rows: data.room_usage.map((r) => [nmx(r), lang === "ar" ? r.mode_ar : r.mode_en, r.minutes, r.sessions]) },
      { title: t("rp.roomFees"), head: ["room", "sessions", "fee"], rows: data.room_fees_by_room.map((r) => [nmx(r), r.sessions, r.fee]) },
      { title: t("rp.topItems"), head: ["item", "qty", "revenue"], rows: data.top_items.map((r) => [nmx(r), r.qty, r.revenue]) },
      { title: t("rp.discounts"), head: ["day", "customer", "phone", "reason", "by", "amount"], rows: data.discounts.map((r) => [r.day, r.customer, r.phone, r.reason, r.by, r.amount]) },
      { title: t("rp.debts"), head: ["name", "phone", "outstanding", "limit"], rows: data.debts.map((r) => [r.name, r.phone, r.outstanding, r.debt_limit]) },
      { title: t("rp.cashDays"), head: ["day", "opening", "expected", "counted"], rows: data.cash_days.map((r) => [r.business_day, r.opening_float, r.expected_cash, r.closing_counted]) },
      { title: t("rp.cashOuts"), head: ["day", "reason", "by", "amount"], rows: data.cash_outs.map((r) => [r.day, r.reason, r.by, r.amount]) },
      { title: t("rp.cancellations"), head: ["at", "reason", "by", "amount"], rows: data.cancellations.map((r) => [r.at, r.reason, r.by, r.amount]) },
      { title: t("rp.voided"), head: ["at", "item", "qty", "reason", "by", "amount"], rows: (data.voided_items ?? []).map((r) => [r.at, nmx(r), r.qty, r.reason, r.by, r.amount]) },
    ]);
  }

  const m = data?.payments_by_method ?? {};
  const collected = round2((m.cash ?? 0) + (m.instapay ?? 0) + (m.vf_cash ?? 0));
  const maxDay = Math.max(1, ...(data?.by_day.map((d) => d.total) ?? [1]));
  const nm = (o: { name_ar: string; name_en: string }) => (lang === "ar" ? o.name_ar : o.name_en);

  return (
    <div className="grid gap-5">
      <TodayCard />
      <SectionTitle>{t("rp.title")}</SectionTitle>
      <div className="flex flex-wrap items-end gap-3">
        <Segmented value={range} onChange={pickRange} options={[
          { value: "today", label: t("rp.today") }, { value: "yesterday", label: t("rp.yesterday") }, { value: "week", label: t("rp.week") }, { value: "month", label: t("rp.month") }, { value: "custom", label: "…" },
        ]} />
        {range === "custom" ? (
          <>
            <Field label={t("rp.from")}><Input id="rp-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="num" dir="ltr" /></Field>
            <Field label={t("rp.to")}><Input id="rp-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} className="num" dir="ltr" /></Field>
            <Button variant="primary" onClick={() => load(from, to)}>{t("rp.load")}</Button>
          </>
        ) : null}
        {busy ? <Spinner /> : null}
        <Button size="sm" className="ms-auto" disabled={!data} onClick={exportCsv}>{t("rp.exportCsv")}</Button>
      </div>
      {error ? <p className="text-busy font-semibold">{error}</p> : null}

      {data ? (
        <>
          <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
            <Kpi label={t("rp.revenue")} value={money(data.bills.total)} sub={`${data.bills.count} ${t("rp.bills")}`} strong />
            <Kpi label={t("rp.collected")} value={money(collected)} sub={`${t("co.cash")} ${money(m.cash ?? 0)}`} />
            <Kpi label={t("rp.roomFees")} value={money(data.bills.room_fees)} />
            <Kpi label={t("rp.items")} value={money(data.bills.items_total)} />
            <Kpi label={t("co.instapay")} value={money(m.instapay ?? 0)} />
            <Kpi label={t("co.vf_cash")} value={money(m.vf_cash ?? 0)} />
            <Kpi label={t("rp.discounts")} value={money(data.bills.discounts)} />
            <Kpi label={t("rp.payLater")} value={money(data.bills.pay_later)} sub={`${t("rp.debtCollected")} ${money(data.debt_collected)}`} />
          </div>

          {data.by_day.length > 1 ? (
            <Card className="p-4 grid gap-2">
              <h3 className="font-semibold">{t("rp.byDay")}</h3>
              <div className="grid gap-1.5">
                {data.by_day.map((d) => (
                  <div key={d.day} className="grid grid-cols-[6rem_1fr_7rem] items-center gap-2 text-sm">
                    <span className="num">{d.day.slice(5)}</span>
                    <span className="h-4 bg-surface-2 rounded-[2px] overflow-hidden"><span className="block h-full bg-strong" style={{ width: `${(d.total / maxDay) * 100}%` }} /></span>
                    <span className="num text-end">{money(d.total)}</span>
                  </div>
                ))}
              </div>
            </Card>
          ) : null}

          <div className="grid gap-5 lg:grid-cols-2 items-start">
            <Table title={t("rp.roomUsage")} empty={!data.room_usage.length} empty_text={t("rp.empty")}>
              {data.room_usage.map((r, i) => <Tr key={i} cells={[nm(r), lang === "ar" ? r.mode_ar : r.mode_en, dur(r.minutes), `${r.sessions} ${t("rp.sessions")}`]} />)}
              {data.room_fees_by_room.map((r, i) => <Tr key={`f${i}`} strong cells={[nm(r), t("rp.roomFees"), "", money(r.fee)]} />)}
            </Table>
            <Table title={t("rp.topItems")} empty={!data.top_items.length} empty_text={t("rp.empty")}>
              {data.top_items.map((r, i) => <Tr key={i} cells={[nm(r), `× ${r.qty}`, money(r.revenue)]} />)}
            </Table>
            <Table title={t("rp.debts")} empty={!data.debts.length} empty_text={t("rp.empty")}>
              {data.debts.map((r) => <Tr key={r.customer_id} cells={[r.name || "—", r.phone, money(r.outstanding), `${t("cu.limit")} ${money(r.debt_limit)}`]} />)}
            </Table>
            <Table title={t("rp.discounts")} empty={!data.discounts.length} empty_text={t("rp.empty")}>
              {data.discounts.map((r) => <Tr key={r.bill_id} cells={[r.day.slice(5), r.customer || r.phone, r.reason, r.by, money(r.amount)]} />)}
            </Table>
            <Table title={t("rp.cashDays")} empty={!data.cash_days.length} empty_text={t("rp.empty")}>
              {data.cash_days.map((r) => {
                const diff = r.closing_counted != null && r.expected_cash != null ? round2(r.closing_counted - r.expected_cash) : null;
                return <Tr key={r.business_day} cells={[r.business_day.slice(5), `${t("d.opening")} ${money(r.opening_float)}`, r.expected_cash != null ? `${t("d.expected")} ${money(r.expected_cash)}` : "—", diff != null ? `${t("d.difference")} ${money(diff)}` : "—"]} tone={diff != null && diff !== 0 ? "busy" : undefined} />;
              })}
            </Table>
            <Table title={t("rp.cashOuts")} empty={!data.cash_outs.length} empty_text={t("rp.empty")}>
              {data.cash_outs.map((r, i) => <Tr key={i} cells={[r.day.slice(5), r.reason, r.by, money(r.amount)]} />)}
            </Table>
            <Table title={t("rp.cancellations")} empty={!data.cancellations.length} empty_text={t("rp.empty")}>
              {data.cancellations.map((r) => <Tr key={r.order_id} cells={[time(r.at), r.reason, r.by, money(r.amount)]} />)}
            </Table>
            <Table title={t("rp.voided")} empty={!(data.voided_items ?? []).length} empty_text={t("rp.empty")}>
              {(data.voided_items ?? []).map((r, i) => <Tr key={i} cells={[time(r.at), `${nm(r)} × ${r.qty}`, r.reason, r.by, money(r.amount)]} />)}
            </Table>
          </div>
        </>
      ) : !busy ? <Empty>{t("rp.empty")}</Empty> : null}

      <Card className="p-4 grid gap-2">
        <h3 className="font-semibold">{t("rp.health")}</h3>
        {errors === null ? <Spinner /> : errors.length === 0 ? (
          <p className="text-sm text-free font-semibold">{t("rp.healthOk")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm"><tbody className="divide-y-2 divide-line">
              {errors.map((e) => <Tr key={e.id} cells={[`${new Date(e.at).toLocaleDateString("en-GB")} ${time(e.at)}`, e.source, e.message]} tone="busy" />)}
            </tbody></table>
          </div>
        )}
        <p className="text-xs text-muted">{t("rp.healthHint")}</p>
      </Card>
    </div>
  );
}

function Kpi({ label, value, sub, strong }: { label: string; value: string; sub?: string; strong?: boolean }) {
  return (
    <Card className={cx("p-3 grid gap-1", strong && "border-strong")}>
      <span className="text-sm text-muted">{label}</span>
      <span className="num text-xl font-bold">{value}</span>
      {sub ? <span className="num text-xs text-muted">{sub}</span> : null}
    </Card>
  );
}

function Table({ title, children, empty, empty_text }: { title: string; children: React.ReactNode; empty: boolean; empty_text: string }) {
  return (
    <Card className="p-4 grid gap-2 min-w-0">
      <h3 className="font-semibold">{title}</h3>
      {empty ? <p className="text-sm text-muted">{empty_text}</p> : <div className="overflow-x-auto"><table className="w-full text-sm"><tbody className="divide-y-2 divide-line">{children}</tbody></table></div>}
    </Card>
  );
}

function Tr({ cells, strong, tone }: { cells: string[]; strong?: boolean; tone?: "busy" }) {
  return (
    <tr className={cx(strong && "font-bold", tone === "busy" && "text-busy")}>
      {cells.map((c, i) => <td key={i} className={cx("py-1.5 pe-3 align-top", i === cells.length - 1 && "text-end num whitespace-nowrap")}>{c}</td>)}
    </tr>
  );
}
