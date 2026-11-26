"use client";

import { useEffect, useState } from "react";
import { useErrorText, useI18n } from "@/lib/i18n";
import type { DictKey } from "@/lib/dict";
import { errorCode, supabase } from "@/lib/supabase";
import { businessDay, round2 } from "@/lib/billing";
import type { Expense, ExpenseCategory } from "@/lib/types";
import { Button, Card, Empty, Field, Input, SectionTitle, Select, Spinner, useToast } from "@/components/ui";
import { useOnline, useSnap } from "../hooks";

export const EXPENSE_CATEGORIES: ExpenseCategory[] = ["rent", "salaries", "utilities", "internet", "supplies", "maintenance", "marketing", "other"];
const METHODS: Expense["method"][] = ["cash", "instapay", "vodafone", "bank", "other"];
export const catKey = (c: ExpenseCategory) => `ex.cat.${c}` as DictKey;
const methodKey = (m: Expense["method"]) => `ex.m.${m}` as DictKey;

const monthEnd = (m: string) => {
  const d = new Date(`${m}-01T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + 1, 0);
  return d.toISOString().slice(0, 10);
};

/** Owner: what the place spends (rent, salaries, bills, supplies…). Reports take it off revenue for profit. */
export function ExpensesAdmin() {
  const { t, money } = useI18n();
  const errText = useErrorText();
  const toast = useToast();
  const snap = useSnap();
  const online = useOnline();
  const today = businessDay(new Date(), snap.settings.day_rollover_hour);
  const [month, setMonth] = useState(today.slice(0, 7));
  const [rows, setRows] = useState<Expense[] | null>(null);
  const [day, setDay] = useState(today);
  const [category, setCategory] = useState<ExpenseCategory>("supplies");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<Expense["method"]>("cash");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const [tick, setTick] = useState(0);
  const reload = () => setTick((x) => x + 1);

  useEffect(() => {
    let off = false;
    supabase().from("expenses").select("*").gte("business_day", `${month}-01`).lte("business_day", monthEnd(month))
      .order("business_day", { ascending: false }).order("created_at", { ascending: false })
      .then(({ data, error }) => {
        if (off) return;
        if (error) toast(errText(errorCode(error)), "error");
        setRows(((data as Expense[]) ?? []).map((r) => ({ ...r, amount: Number(r.amount) })));
      });
    return () => { off = true; };
  }, [month, tick, errText, toast]);

  async function add() {
    setBusy(true);
    const { error } = await supabase().from("expenses").insert({ business_day: day, category, amount: round2(Number(amount)), method, note: note.trim().slice(0, 200) });
    setBusy(false);
    if (error) return toast(errText(errorCode(error)), "error");
    toast(t("common.saved"));
    setAmount("");
    setNote("");
    if (day.slice(0, 7) !== month) setMonth(day.slice(0, 7));
    else reload();
  }

  async function remove(r: Expense) {
    if (!confirm(t("ex.confirmDelete", { amount: money(r.amount) }))) return;
    const { error } = await supabase().from("expenses").delete().eq("id", r.id);
    if (error) return toast(errText(errorCode(error)), "error");
    reload();
  }

  const total = round2((rows ?? []).reduce((a, r) => a + r.amount, 0));
  const byCat = EXPENSE_CATEGORIES.map((c) => ({ c, sum: round2((rows ?? []).filter((r) => r.category === c).reduce((a, r) => a + r.amount, 0)) })).filter((x) => x.sum > 0);

  return (
    <div className="grid gap-5">
      <Card className="p-4 grid gap-3">
        <SectionTitle>{t("ex.add")}</SectionTitle>
        <p className="text-sm text-muted">{t("ex.hint")}</p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5 items-end">
          <Field label={t("ex.day")}><Input id="ex-day" type="date" value={day} max={today} onChange={(e) => setDay(e.target.value)} className="num" dir="ltr" /></Field>
          <Field label={t("ex.category")}>
            <Select id="ex-cat" value={category} onChange={(e) => setCategory(e.target.value as ExpenseCategory)}>
              {EXPENSE_CATEGORIES.map((c) => <option key={c} value={c}>{t(catKey(c))}</option>)}
            </Select>
          </Field>
          <Field label={t("ex.amount")}><Input id="ex-amount" numeric value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" /></Field>
          <Field label={t("ex.method")}>
            <Select id="ex-method" value={method} onChange={(e) => setMethod(e.target.value as Expense["method"])}>
              {METHODS.map((m) => <option key={m} value={m}>{t(methodKey(m))}</option>)}
            </Select>
          </Field>
          <Field label={t("ex.note")}><Input id="ex-note" value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} /></Field>
        </div>
        <Button variant="primary" className="justify-self-start" busy={busy} disabled={!online || !(Number(amount) > 0) || !day} onClick={add}>{t("ex.save")}</Button>
        {!online ? <p className="text-sm text-warn font-semibold">{t("ex.online")}</p> : null}
      </Card>

      <Card className="p-4 grid gap-3">
        <SectionTitle action={<Input id="ex-month" type="month" value={month} max={today.slice(0, 7)} onChange={(e) => e.target.value && setMonth(e.target.value)} className="num w-40" dir="ltr" />}>
          {t("ex.title")} · <span className="num">{money(total)}</span>
        </SectionTitle>
        {byCat.length ? (
          <div className="flex flex-wrap gap-2 text-sm">
            {byCat.map((x) => <span key={x.c} className="px-2 py-1 border-2 border-line rounded-[2px]">{t(catKey(x.c))} · <span className="num font-semibold">{money(x.sum)}</span></span>)}
          </div>
        ) : null}
        {rows === null ? <Spinner /> : !rows.length ? <Empty>{t("ex.empty")}</Empty> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm"><tbody className="divide-y-2 divide-line">
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="py-1.5 pe-3 num whitespace-nowrap">{r.business_day.slice(5)}</td>
                  <td className="py-1.5 pe-3">{t(catKey(r.category))}</td>
                  <td className="py-1.5 pe-3 text-muted">{t(methodKey(r.method))}</td>
                  <td className="py-1.5 pe-3">{r.note}</td>
                  <td className="py-1.5 pe-3 num font-semibold text-end whitespace-nowrap">{money(r.amount)}</td>
                  <td className="py-1.5 text-end"><Button size="sm" variant="outline" disabled={!online} onClick={() => remove(r)}>{t("ex.delete")}</Button></td>
                </tr>
              ))}
            </tbody></table>
          </div>
        )}
        <p className="text-xs text-muted">{t("ex.cashOutsNote")}</p>
      </Card>
    </div>
  );
}
