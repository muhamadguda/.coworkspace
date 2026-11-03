"use client";

import { useCallback, useEffect, useState } from "react";
import { useErrorText, useI18n } from "@/lib/i18n";
import { errorCode, isNetworkError, rpc } from "@/lib/supabase";
import { computeRoomFee, round2, type FeeSettings } from "@/lib/billing";
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
};

export function BillView() {
  const { t, n, money, dateTime, dur, lang } = useI18n();
  const errText = useErrorText();
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [data, setData] = useState<BillData | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());

  const load = useCallback(async (p: string, c: string, quiet = false) => {
    if (!quiet) setBusy(true);
    try {
      const res = await rpc<BillData>("customer_bill", { p_phone: normalizePhone(p), p_code: c.trim() });
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
    setPhone(me.phone);
    setCode(me.code);
    if (me.phone && me.code) void load(me.phone, me.code);
  }, [load]);

  useEffect(() => {
    if (!data) return;
    const tick = setInterval(() => setNow(new Date()), 15_000);
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
  const roomAmount = s ? (s.status === "active" ? (s.is_booker ? fee!.fee : 0) : b!.room_fee_share) : b?.room_fee_share ?? 0;
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
              {fee ? (
                <div className="flex justify-between gap-2 font-semibold">
                  <span>{t("c.roomTimeEstimate")}</span>
                  <span className="num">{money(fee.fee)}</span>
                </div>
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
