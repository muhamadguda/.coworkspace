"use client";

import { useCallback, useEffect, useState } from "react";
import { useErrorText, useI18n } from "@/lib/i18n";
import { errorCode, isNetworkError, rpc } from "@/lib/supabase";
import { bundleCredit, computeRoomFee, round2, type FeeSettings } from "@/lib/billing";
import { isValidPhone, normalizePhone } from "@/lib/phone";
import type { ChosenOption, OrderStatus } from "@/lib/types";
import { Button, Card, Empty, Field, Input, Pill, SectionTitle } from "@/components/ui";
import { getIdentity, setIdentity } from "./local";

type BillData = {
  customer: { name: string; phone: string; code: string };
  outstanding: number;
  settings: FeeSettings;
  bill: null | {
    id: string;
    opened_at: string;
    room_fee_share: number;
    place: { kind: "room" | "table"; name_ar: string; name_en: string } | null;
    orders: { id: string; status: OrderStatus; created_at: string; items: { name_ar: string; name_en: string; qty: number; unit_price: number; options: ChosenOption[] }[] }[];
    session: null | {
      id: string; kind: "open" | "fixed"; planned_end: string | null; status: "active" | "ended"; started_at: string; ended_at: string | null; room_fee: number | null; is_booker: boolean; members: number;
      segments: { mode_id: string; rate: number; started_at: string; ended_at: string | null; name_ar: string; name_en: string }[];
    };
  };
  bookings: { id: string; status: "pending" | "confirmed"; starts_at: string; duration_minutes: number; place_ar: string; place_en: string; mode_ar: string; mode_en: string }[];
  bundles?: { name_ar: string; name_en: string; minutes_left: number; expires_at: string; mode_id: string | null; source: "purchase" | "loyalty" }[];
  loyalty?: { visits: number; every: number; reward_minutes: number };
  review_url?: string;
};

export function BillView() {
  const { t, n, money, dateTime, dur, lang } = useI18n();
  const errText = useErrorText();
  const [phone, setPhone] = useState(() => getIdentity().phone);
  const [code, setCode] = useState(() => getIdentity().code);
  const [data, setData] = useState<BillData | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());

  const load = useCallback(async (p: string, c: string, quiet = false) => {
    if (!quiet) setBusy(true);
    try {
      const res = await rpc<BillData>("customer_bill2", { p_phone: normalizePhone(p), p_code: c.trim() });
      setData(res);
      setError(null);
      const prev = getIdentity();
      setIdentity({ phone: normalizePhone(p), code: c.trim(), name: res.customer.name || prev.name });
    } catch (e) {
      if (!quiet) setError(errText(isNetworkError(e) ? "network" : errorCode(e)));
    } finally {
      if (!quiet) setBusy(false);
    }
  }, [errText]);

  useEffect(() => {
    const me = getIdentity();
    if (me.phone && me.code) {
      rpc<BillData>("customer_bill2", { p_phone: me.phone, p_code: me.code })
        .then(setData)
        .catch(() => {});
    }
  }, [load]);

  useEffect(() => {
    if (!data) return;
    // Tick every second while a room is running (the meter), otherwise every 15 s.
    const live = data.bill?.session?.status === "active";
    const tick = setInterval(() => setNow(new Date()), live ? 1000 : 15_000);
    const poll = setInterval(() => void load(data.customer.phone, data.customer.code, true), 30_000);
    return () => {
      clearInterval(tick);
      clearInterval(poll);
    };
  }, [data, load]);

  async function cancelBooking(id: string) {
    if (!data) return;
    try {
      await rpc("customer_cancel_booking", { p_phone: data.customer.phone, p_code: data.customer.code, p_booking_id: id });
      await load(data.customer.phone, data.customer.code, true);
    } catch (e) {
      setError(errText(errorCode(e)));
    }
  }

  if (!data) {
    return (
      <Card className="p-5 grid gap-4 max-w-md">
        <SectionTitle>{t("c.billTitle")}</SectionTitle>
        <p className="text-sm text-muted">{t("c.billHint")}</p>
        <Field label={t("common.phone")}>
          <Input id="bill-phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" placeholder="01xxxxxxxxx" />
        </Field>
        <Field label={t("common.code")}>
          <Input id="bill-code" numeric inputMode="numeric" value={code} maxLength={6} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} />
        </Field>
        {error ? <p className="text-busy font-semibold text-sm">{error}</p> : null}
        <Button variant="primary" busy={busy} disabled={!isValidPhone(phone) || code.length < 4} onClick={() => load(phone, code)}>
          {t("c.showBill")}
        </Button>
      </Card>
    );
  }

  const b = data.bill;
  const liveOrders = b?.orders.filter((o) => o.status === "accepted" || o.status === "served" || o.status === "new") ?? [];
  const itemsTotal = round2(
    (b?.orders ?? []).filter((o) => o.status === "accepted" || o.status === "served").reduce((a, o) => a + o.items.reduce((x, i) => x + i.qty * i.unit_price, 0), 0),
  );
  const s = b?.session;
  const fee = s && s.status === "active" && s.is_booker
    ? computeRoomFee({ segments: s.segments, kind: s.kind, plannedEnd: s.planned_end, end: now, settings: data.settings, chargeOverstay: false })
    : null;
  const bundle = s && s.is_booker ? (data.bundles ?? []).find((x) => !x.mode_id || s.segments.some((g) => g.mode_id === x.mode_id)) : undefined;
  const credit = fee && bundle ? bundleCredit(fee, bundle.minutes_left, bundle.mode_id) : null;
  const liveFee = fee ? round2(fee.fee - (credit?.amount ?? 0)) : 0;
  const roomAmount = s ? (s.status === "active" ? (s.is_booker ? liveFee : 0) : b!.room_fee_share) : b?.room_fee_share ?? 0;
  const total = round2(itemsTotal + roomAmount);

  return (
    <div className="grid gap-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <div className="font-display text-2xl font-bold">{data.customer.name || data.customer.phone}</div>
          <div className="text-sm text-muted">
            {t("common.code")}: <span className="num font-semibold">{data.customer.code}</span>
          </div>
        </div>
        <Button size="sm" variant="ghost" onClick={() => { setIdentity(null); setData(null); setPhone(""); setCode(""); }}>
          {t("c.forgetMe")}
        </Button>
      </div>

      {!b ? (
        <Empty>{t("c.noOpenBill")}</Empty>
      ) : (
        <Card className="p-4 grid gap-4">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <span className="font-semibold">{b.place ? n(b.place) : t("common.counter")}</span>
            <span className="text-sm text-muted">{dateTime(b.opened_at)}</span>
          </div>

          {s ? (
            <div className="grid gap-2 border-2 border-line rounded-[2px] p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold">{t("c.roomTime")}</span>
                {s.status === "active" ? <Pill tone="busy">{dur((now.getTime() - Date.parse(s.started_at)) / 60000)}</Pill> : null}
              </div>
              {s.segments.map((g, i) => (
                <div key={i} className="text-sm flex justify-between gap-2">
                  <span>{lang === "ar" ? g.name_ar : g.name_en}</span>
                  <span className="num text-muted">{money(g.rate)}{t("common.perHour")}</span>
                </div>
              ))}
              {s.status === "active" && !s.is_booker ? <p className="text-sm text-muted">{t("c.roomOnBooker")}</p> : null}
              {fee && s.status === "active" ? (
                <Meter startedAt={s.started_at} now={now} fee={liveFee} billedMinutes={fee.billedMinutes} settings={data.settings} covered={credit && credit.minutes > 0 ? credit.minutes : 0} />
              ) : s.status === "ended" ? (
                <div className="flex justify-between gap-2 font-semibold">
                  <span>{t("c.roomTime")}</span>
                  <span className="num">{money(b.room_fee_share)}</span>
                </div>
              ) : null}
            </div>
          ) : null}

          <ul className="grid gap-2">
            {liveOrders.map((o) => (
              <li key={o.id} className="grid gap-1 border-b-2 border-line pb-2">
                <div className="flex items-center justify-between gap-2">
                  <Pill tone={o.status === "new" ? "warn" : o.status === "served" ? "free" : "accent"}>{t(`c.status.${o.status}` as const)}</Pill>
                </div>
                {o.items.map((i, k) => (
                  <div key={k} className="flex justify-between gap-2 text-sm">
                    <span>
                      <span className="num">{i.qty}×</span> {lang === "ar" ? i.name_ar : i.name_en}
                      {i.options.length ? <span className="text-muted"> · {i.options.map((x) => (lang === "ar" ? x.choice_ar : x.choice_en)).join(" · ")}</span> : null}
                    </span>
                    <span className="num">{money(i.qty * i.unit_price)}</span>
                  </div>
                ))}
              </li>
            ))}
          </ul>

          <div className="grid gap-1">
            <Row label={t("c.itemsTotal")} value={money(itemsTotal)} />
            {s ? <Row label={t("c.roomTime")} value={money(roomAmount)} /> : null}
            <Row label={s?.status === "active" ? t("c.estimatedTotal") : t("common.total")} value={money(total)} strong />
          </div>
        </Card>
      )}

      {(data.bundles ?? []).length ? (
        <Card className="p-4 grid gap-2">
          <span className="font-semibold">{t("c.myTime")}</span>
          {data.bundles!.map((x, i) => (
            <div key={i} className="flex justify-between gap-2 text-sm">
              <span>{lang === "ar" ? x.name_ar : x.name_en}{x.source === "loyalty" ? <> <Pill tone="accent">{t("ly.reward")}</Pill></> : null}</span>
              <span className="num font-semibold">{dur(Math.round(x.minutes_left))}</span>
            </div>
          ))}
        </Card>
      ) : null}

      {data.loyalty && data.loyalty.every > 0 ? (
        <Card className="p-4 grid gap-2">
          <div className="flex justify-between gap-2 font-semibold">
            <span>{t("ly.visits")}</span>
            <span className="num">{data.loyalty.visits}</span>
          </div>
          <div className="flex gap-1" aria-hidden>
            {Array.from({ length: data.loyalty.every }).map((_, i) => (
              <span key={i} className={`h-2.5 flex-1 rounded-full ${i < data.loyalty!.visits % data.loyalty!.every ? "bg-accent" : "bg-line"}`} />
            ))}
          </div>
          <span className="text-sm text-muted">{t("ly.nextIn", { n: data.loyalty.every - (data.loyalty.visits % data.loyalty.every), m: data.loyalty.reward_minutes })}</span>
        </Card>
      ) : null}

      {data.outstanding > 0 ? (
        <Card className="p-4 flex justify-between gap-2 border-warn">
          <span className="font-semibold">{t("c.outstanding")}</span>
          <span className="num font-bold">{money(data.outstanding)}</span>
        </Card>
      ) : null}

      {data.bookings.length ? (
        <section className="grid gap-2">
          <SectionTitle>{t("c.myBookings")}</SectionTitle>
          {data.bookings.map((k) => (
            <Card key={k.id} className="p-3 flex items-center justify-between gap-3 flex-wrap">
              <div className="grid">
                <span className="font-semibold">{lang === "ar" ? k.place_ar : k.place_en} · {lang === "ar" ? k.mode_ar : k.mode_en}</span>
                <span className="text-sm text-muted">{dateTime(k.starts_at)} · {dur(k.duration_minutes)}</span>
              </div>
              <div className="flex items-center gap-2">
                <Pill tone={k.status === "confirmed" ? "free" : "warn"}>{t(`c.book.status.${k.status}` as const)}</Pill>
                <Button size="sm" variant="ghost" onClick={() => cancelBooking(k.id)}>{t("c.cancelBooking")}</Button>
              </div>
            </Card>
          ))}
        </section>
      ) : null}
      {error ? <p className="text-busy font-semibold text-sm">{error}</p> : null}
      {data.review_url ? (
        <a href={data.review_url} target="_blank" rel="noreferrer" className="justify-self-center text-sm font-semibold underline underline-offset-4">★ {t("c.reviewUs")}</a>
      ) : null}
    </div>
  );
}

/** Live room meter: running clock, current price, and when the next billing step lands. */
function Meter({ startedAt, now, fee, billedMinutes, settings, covered }: { startedAt: string; now: Date; fee: number; billedMinutes: number; settings: FeeSettings; covered: number }) {
  const { t, money, time, dur } = useI18n();
  const elapsedMs = Math.max(0, now.getTime() - Date.parse(startedAt));
  const sec = Math.floor(elapsedMs / 1000);
  const clock = `${String(Math.floor(sec / 3600)).padStart(2, "0")}:${String(Math.floor((sec % 3600) / 60)).padStart(2, "0")}:${String(sec % 60).padStart(2, "0")}`;
  const step = Math.max(1, settings.billing_step_minutes);
  const nextAt = new Date(Date.parse(startedAt) + billedMinutes * 60_000);
  const windowStart = Math.max(0, billedMinutes - (billedMinutes <= settings.min_session_minutes ? settings.min_session_minutes : step));
  const span = Math.max(1, billedMinutes - windowStart);
  const progress = Math.min(1, Math.max(0, (elapsedMs / 60_000 - windowStart) / span));
  return (
    <div className="grid gap-2" aria-live="off">
      <div className="flex items-end justify-between gap-3">
        <span className="num font-display text-4xl font-bold tracking-tight tabular-nums" dir="ltr">{clock}</span>
        <span key={fee} className="num text-2xl font-bold meter-tick">{money(fee)}</span>
      </div>
      <div className="h-2 rounded-full bg-line overflow-hidden" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}>
        <div className="h-full bg-accent transition-[width] duration-1000 ease-linear" style={{ width: `${progress * 100}%` }} />
      </div>
      <div className="flex flex-wrap justify-between gap-2 text-xs text-muted">
        <span>{t("c.meterNext", { at: time(nextAt.toISOString()) })}</span>
        {billedMinutes <= settings.min_session_minutes ? <span>{t("c.meterMin", { t: dur(settings.min_session_minutes) })}</span> : null}
        {covered > 0 ? <span className="text-strong font-semibold">{t("c.coveredByBundle", { t: dur(Math.round(covered)) })}</span> : null}
      </div>
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={strong ? "flex justify-between gap-2 font-bold text-lg border-t-2 border-strong pt-2 mt-1" : "flex justify-between gap-2"}>
      <span>{label}</span>
      <span className="num">{value}</span>
    </div>
  );
}
