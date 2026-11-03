"use client";

import { useState } from "react";
import { useI18n } from "@/lib/i18n";
import { round2 } from "@/lib/billing";
import { Button, Card, Field, Input, SectionTitle, Textarea, cx, useToast } from "@/components/ui";
import { currentBusinessDay, dayStats } from "../derive";
import { dispatch, uuid } from "../store";
import { useNow, useSnap } from "../hooks";
import { printDayReport } from "../receipts";

export function DayView() {
  const { t, money, time, lang } = useI18n();
  const toast = useToast();
  const snap = useSnap();
  const now = useNow(30000);
  const day = currentBusinessDay(snap, now);
  const st = dayStats(snap, day);
  const [outAmount, setOutAmount] = useState("");
  const [outReason, setOutReason] = useState("");
  const [counted, setCounted] = useState("");
  const [note, setNote] = useState("");
  const cd = snap.cash_day?.business_day === day ? snap.cash_day : null;
  const diff = counted !== "" ? round2(Number(counted) - st.expected) : null;

  return (
    <div className="grid gap-5 lg:grid-cols-2 items-start">
      <Card className="p-4 grid gap-3">
        <SectionTitle>{t("d.title")} · <span className="num">{day}</span></SectionTitle>
        <Row label={t("d.opening")} value={money(st.opening)} />
        <Row label={t("d.cashIn")} value={money(st.byMethod.cash)} />
        <Row label={t("d.cashOut")} value={`− ${money(st.cashOut)}`} />
        <Row label={t("d.expected")} value={money(st.expected)} strong />
        <div className="grid gap-1 border-t-2 border-line pt-3">
          <span className="font-semibold">{t("d.byMethod")}</span>
          <Row label={t("co.cash")} value={money(st.byMethod.cash)} />
          <Row label={t("co.instapay")} value={money(st.byMethod.instapay)} />
          <Row label={t("co.vf_cash")} value={money(st.byMethod.vf_cash)} />
          <Row label={t("common.total")} value={money(st.total)} strong />
        </div>
        {cd?.closed_at ? (
          <p className="font-semibold text-free">{t("d.closed")} · {t("d.counted")} <span className="num">{money(cd.closing_counted)}</span></p>
        ) : null}
      </Card>

      <div className="grid gap-5">
        <Card className="p-4 grid gap-3">
          <SectionTitle>{t("d.addCashOut")}</SectionTitle>
          <div className="grid gap-2 sm:grid-cols-[8rem_1fr_auto] items-end">
            <Field label={t("cu.payAmount")}>
              <Input id="out-amount" numeric value={outAmount} onChange={(e) => setOutAmount(e.target.value)} placeholder="0" />
            </Field>
            <Field label={t("d.reason")}>
              <Input id="out-reason" value={outReason} onChange={(e) => setOutReason(e.target.value)} maxLength={200} />
            </Field>
            <Button
              variant="primary"
              disabled={!(Number(outAmount) > 0) || !outReason.trim()}
              onClick={() => { dispatch("cash_out", { id: uuid(), amount: round2(Number(outAmount)), reason: outReason.trim() }); setOutAmount(""); setOutReason(""); toast(t("common.saved")); }}
            >
              {t("common.add")}
            </Button>
          </div>
          {st.outs.length ? (
            <ul className="grid gap-1 text-sm">
              {st.outs.map((o) => (
                <li key={o.id} className="flex justify-between gap-2">
                  <span>{time(o.created_at)} · {o.reason}</span>
                  <span className="num">{money(o.amount)}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </Card>

        <Card className="p-4 grid gap-3">
          <SectionTitle>{t("d.close")}</SectionTitle>
          <Field label={t("d.counted")}>
            <Input id="close-counted" numeric value={counted} onChange={(e) => setCounted(e.target.value)} placeholder="0" />
          </Field>
          {diff != null ? (
            <div className={cx("flex justify-between font-bold", diff === 0 ? "text-free" : "text-busy")}>
              <span>{t("d.difference")}</span>
              <span className="num">{money(diff)}</span>
            </div>
          ) : null}
          <Field label={t("common.noteOptional")}>
            <Textarea id="close-note" value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={300} />
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button variant="danger" disabled={counted === "" || !cd} onClick={() => { dispatch("close_day", { business_day: day, counted: round2(Number(counted)), note: note.trim() }); printDayReport(snap, day, lang, t, round2(Number(counted))); toast(t("d.closed")); }}>
              {t("d.close")}
            </Button>
            <Button onClick={() => printDayReport(snap, day, lang, t, counted !== "" ? round2(Number(counted)) : undefined)}>{t("d.printReport")}</Button>
          </div>
        </Card>
      </div>
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={cx("flex justify-between gap-2", strong && "font-bold text-lg")}>
      <span>{label}</span>
      <span className="num">{value}</span>
    </div>
  );
}
