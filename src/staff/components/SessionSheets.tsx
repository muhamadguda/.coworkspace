"use client";

import { useMemo, useState } from "react";
import { useI18n, formatClock } from "@/lib/i18n";
import { bundleCredit, round2, splitEqual } from "@/lib/billing";
import { isOpenBooking, modeFits, rateFor } from "@/lib/pricing";
import type { Place, Session } from "@/lib/types";
import { Button, Card, Field, Input, Pill, Segmented, Select, Sheet, Toggle, cx } from "@/components/ui";
import { activeBundlesOf, billsInSession, customerById, fmtHours, liveRoomFee, openBillOfCustomer, placeById, upcomingBookingFor } from "../derive";
import { dispatch, serverNow, uuid } from "../store";
import { useNow, useSnap } from "../hooks";
import { CustomerPicker } from "./CustomerPicker";

const DURATIONS = [60, 90, 120, 180, 240];

export function StartSessionSheet({ place, open, onClose, presetCustomer, presetBooking }: { place: Place; open: boolean; onClose: () => void; presetCustomer?: string; presetBooking?: string }) {
  const { t, n, money, time, dur } = useI18n();
  const snap = useSnap();
  const now = useNow(30000);
  const modes = snap.modes.filter((m) => m.active && modeFits(m, place.kind));
  const bookings = snap.bookings.filter((b) => b.place_id === place.id && b.status === "confirmed" && Math.abs(Date.parse(b.starts_at) - now.getTime()) < 6 * 3600_000);
  const initial = snap.bookings.find((x) => x.id === presetBooking);
  const [customerId, setCustomerId] = useState<string | undefined>(initial?.customer_id ?? presetCustomer);
  const [bookingId, setBookingId] = useState<string>(presetBooking ?? "");
  const [modeId, setModeId] = useState(initial?.mode_id ?? modes[0]?.id ?? "");
  const [kind, setKind] = useState<"open" | "fixed">(initial && !isOpenBooking(initial) ? "fixed" : "open");
  const [minutes, setMinutes] = useState(initial?.duration_minutes ?? 60);
  const [group, setGroup] = useState(initial?.group_size ? String(initial.group_size) : "");

  function pickBooking(id: string) {
    setBookingId(id);
    const b = snap.bookings.find((x) => x.id === id);
    if (!b) return;
    setCustomerId(b.customer_id);
    setModeId(b.mode_id);
    setKind(isOpenBooking(b) ? "open" : "fixed");
    setMinutes(isOpenBooking(b) ? 60 : b.duration_minutes);
    if (b.group_size) setGroup(String(b.group_size));
  }

  const cust = customerId ? customerById(snap, customerId) : undefined;
  const isArea = place.kind === "area";
  const next = isArea ? undefined : upcomingBookingFor(snap, place.id, now, 6 * 60);
  const nextIsOther = next && next.id !== bookingId;
  const here = isArea ? snap.sessions.filter((x) => x.place_id === place.id && x.status === "active") : [];
  const alreadyHere = !!customerId && here.some((x) => x.booker_customer_id === (snap.aliases?.[customerId] ?? customerId));
  const full = isArea && place.capacity != null && here.length >= place.capacity;
  const running = customerId ? snap.sessions.find((x) => x.status === "active" && x.booker_customer_id === (snap.aliases?.[customerId] ?? customerId)) : undefined;

  function start() {
    if (!customerId) return;
    const existing = openBillOfCustomer(snap, customerId);
    dispatch("start_session", {
      id: uuid(), place_id: place.id, customer_id: customerId, bill_id: existing?.id ?? uuid(), mode_id: modeId, kind,
      planned_end: kind === "fixed" ? new Date(serverNow().getTime() + minutes * 60000).toISOString() : null,
      group_size: isArea ? null : group ? Number(group) : null, booking_id: bookingId || null, segment_id: uuid(),
    });
    onClose();
  }

  return (
    <Sheet open={open} onClose={onClose} title={`${t("ss.start")} · ${n(place)}`} footer={<Button variant="accent" size="lg" disabled={!customerId || !modeId || full || alreadyHere || (isArea && !!running)} onClick={start}>{t("ss.start")}</Button>}>
      {!modes.length ? <p className="text-sm font-semibold text-warn border-s-4 border-warn ps-2">{t(isArea ? "md.noneArea" : "md.noneRoom")}</p> : null}
      {!isArea && bookings.length ? (
        <Field label={t("ss.fromBooking")}>
          <Select id="ss-booking" value={bookingId} onChange={(e) => pickBooking(e.target.value)}>
            <option value="">{t("ss.noBooking")}</option>
            {bookings.map((b) => (
              <option key={b.id} value={b.id}>{time(b.starts_at)} · {customerById(snap, b.customer_id)?.name || customerById(snap, b.customer_id)?.phone} · {isOpenBooking(b) ? t("bk.openEnded") : dur(b.duration_minutes)}</option>
            ))}
          </Select>
        </Field>
      ) : null}

      {cust ? (
        <Card className="p-3 flex items-center justify-between gap-2">
          <div className="grid">
            <span className="text-xs text-muted">{isArea ? t("ar.person") : t("ss.booker")}</span>
            <span className="font-semibold">{cust.name || "—"} <span className="num text-sm text-muted">{cust.phone}</span></span>
          </div>
          <Button size="sm" variant="ghost" onClick={() => setCustomerId(undefined)}>{t("common.edit")}</Button>
        </Card>
      ) : (
        <CustomerPicker label={isArea ? t("ar.person") : t("ss.booker")} onPick={setCustomerId} />
      )}
      {alreadyHere ? <p className="text-sm font-semibold text-busy border-s-4 border-busy ps-2">{t("ar.alreadyHere")}</p> : null}
      {isArea && !alreadyHere && running ? <p className="text-sm font-semibold text-warn border-s-4 border-warn ps-2">{t("ar.timerElsewhere", { place: n(placeById(snap, running.place_id)) })}</p> : null}
      {full ? <p className="text-sm font-semibold text-busy border-s-4 border-busy ps-2">{t("ar.fullNote")}</p> : null}

      <Field group label={t("ss.mode")}>
        <Segmented value={modeId} onChange={setModeId} options={modes.map((m) => ({ value: m.id, label: <span>{n(m)} · <span className="num">{money(rateFor(snap.modes, snap.mode_prices, place.id, m.id))}</span></span> }))} />
      </Field>
      <Field group label={t("ss.timing")}>
        <Segmented value={kind} onChange={setKind} options={[{ value: "open", label: t("ss.open") }, { value: "fixed", label: t("ss.fixed") }]} />
      </Field>
      {kind === "fixed" ? (
        <Field group label={t("ss.duration")}>
          <div className="flex flex-wrap gap-1.5">
            {DURATIONS.map((d) => (
              <button key={d} type="button" onClick={() => setMinutes(d)} className={cx("h-10 px-3 rounded-[2px] border-2 font-semibold text-sm", minutes === d ? "bg-strong text-bg border-strong" : "bg-surface border-line")}>
                {dur(d)}
              </button>
            ))}
            <Input id="ss-minutes" numeric inputMode="numeric" className="w-24" value={String(minutes)} onChange={(e) => setMinutes(Math.max(15, Number(e.target.value.replace(/\D/g, "")) || 0))} aria-label={t("common.minutes")} />
          </div>
        </Field>
      ) : null}
      {!isArea ? (
        <Field label={t("ss.group")}>
          <Input id="ss-group" numeric inputMode="numeric" value={group} onChange={(e) => setGroup(e.target.value.replace(/\D/g, "").slice(0, 3))} />
        </Field>
      ) : null}
      {nextIsOther ? <p className="text-sm font-semibold text-warn border-s-4 border-warn ps-2">{t("ss.bookingWarning", { time: time(next!.starts_at), n: snap.settings.booking_warning_minutes })}</p> : null}
    </Sheet>
  );
}

export function EndSessionSheet({ session, open, onClose, onEnded }: { session: Session; open: boolean; onClose: () => void; onEnded: () => void }) {
  const { t, n, money, dur } = useI18n();
  const snap = useSnap();
  const now = useNow(5000);
  const [chargeOverstay, setChargeOverstay] = useState(true);
  const [split, setSplit] = useState<"booker" | "equal">("booker");
  const bills = billsInSession(snap, session.id);
  const bookerBill = bills.find((b) => b.customer_id === session.booker_customer_id) ?? bills[0];
  const [selected, setSelected] = useState<string[]>(() => bills.map((b) => b.id));

  const fee = useMemo(() => liveRoomFee(snap, session, now, chargeOverstay), [snap, session, now, chargeOverstay]);
  // Booker's hour bundle (soonest to expire first). Only when the booker pays the room.
  const bundle = activeBundlesOf(snap, session.booker_customer_id, now)
    .filter((b) => !b.mode_id || fee.lines.some((l) => l.mode_id === b.mode_id))[0];
  const [useBundle, setUseBundle] = useState(true);
  const credit = bundle && split === "booker" && useBundle ? bundleCredit(fee, bundle.minutes_total - bundle.minutes_used, bundle.mode_id) : null;
  const netFee = credit && credit.minutes > 0 ? round2(fee.fee - credit.amount) : fee.fee;
  const participants = !bookerBill
    ? []
    : split === "equal"
      ? [bookerBill.id, ...bills.filter((b) => b.id !== bookerBill.id && selected.includes(b.id)).map((b) => b.id)]
      : [bookerBill.id];
  const shares = splitEqual(netFee, participants);
  const place = placeById(snap, session.place_id);

  function end() {
    dispatch("end_session", {
      session_id: session.id, billed_minutes: fee.billedMinutes, room_fee: netFee, overstay_charged: fee.overstayCharged, split_mode: split, shares,
      ...(credit && credit.minutes > 0 && bundle ? { bundle: { id: uuid(), bundle_id: bundle.id, minutes: credit.minutes, amount: credit.amount } } : {}),
    });
    onEnded();
  }

  return (
    <Sheet open={open} onClose={onClose} title={t("ss.endTitle", { place: n(place) })} footer={<Button variant="danger" size="lg" disabled={!bookerBill} onClick={end}>{t("ss.confirmEnd")} · <span className="num">{money(netFee)}</span></Button>}>
      <div className="grid gap-1 text-sm">
        {fee.lines.map((l, i) => (
          <div key={i} className="flex justify-between gap-2">
            <span>{n(snap.modes.find((m) => m.id === l.mode_id))} · <span className="num">{formatClock(l.minutes)}</span> × <span className="num">{money(l.rate)}</span></span>
            <span className="num">{money(round2(l.amount + (l.off ?? 0)))}</span>
          </div>
        ))}
        {fee.extraMinutes > 0.01 ? (
          <div className="flex justify-between gap-2 text-muted">
            <span>{t("ss.minimumOrRounding")} · <span className="num">{formatClock(fee.extraMinutes)}</span></span>
            <span className="num">{money(round2((fee.extraMinutes * fee.extraRate) / 60))}</span>
          </div>
        ) : null}
        {fee.happyOff > 0 ? (
          <div className="flex justify-between gap-2 font-semibold text-free">
            <span>{t("hh.title")}</span>
            <span className="num">−{money(fee.happyOff)}</span>
          </div>
        ) : null}
        <div className="flex justify-between gap-2 font-bold border-t-2 border-strong pt-1 mt-1">
          <span>{t("ss.billedTime")} · {dur(fee.billedMinutes)}</span>
          <span className="num">{money(fee.fee)}</span>
        </div>
      </div>
      {bundle ? (
        <div className="grid gap-1 border-2 border-accent rounded-[2px] p-3">
          <Toggle
            checked={useBundle && split === "booker"}
            onChange={setUseBundle}
            label={<span>{t("bu.use")} · {n(bundle)} · <span className="num">{t("bu.left", { h: fmtHours(bundle.minutes_total - bundle.minutes_used) })}</span></span>}
          />
          {split !== "booker" ? <span className="text-xs text-muted">{t("bu.bookerOnly")}</span> : null}
          {credit && credit.minutes > 0 ? (
            <div className="flex justify-between gap-2 text-sm font-semibold">
              <span>{t("bu.covers", { t: dur(Math.round(credit.minutes)) })}</span>
              <span className="num">−{money(credit.amount)}</span>
            </div>
          ) : null}
        </div>
      ) : null}
      {fee.overstayBeyondGrace ? (
        <div className="grid gap-1 border-2 border-warn rounded-[2px] p-3">
          <span className="font-semibold">{t("ss.overstay", { t: dur(fee.overstayMinutes) })}</span>
          <Toggle checked={chargeOverstay} onChange={setChargeOverstay} label={t("ss.chargeOverstay")} />
        </div>
      ) : null}
      {bills.length > 1 ? (
        <fieldset className="grid gap-2">
          <legend className="font-semibold mb-1">{t("ss.split")}</legend>
          <Segmented value={split} onChange={setSplit} options={[{ value: "booker", label: t("ss.splitBooker") }, { value: "equal", label: t("ss.splitEqual") }]} />
          {split === "equal" ? (
            <ul className="grid gap-1.5">
              {bills.map((b) => {
                const c = customerById(snap, b.customer_id);
                const share = shares.find((s) => s.bill_id === b.id);
                const isBooker = b.id === bookerBill?.id;
                return (
                  <li key={b.id} className="flex items-center justify-between gap-2">
                    <Toggle checked={isBooker || selected.includes(b.id)} onChange={(v) => !isBooker && setSelected((s) => (v ? [...s, b.id] : s.filter((x) => x !== b.id)))} label={<span>{c?.name || c?.phone} {isBooker ? <Pill tone="accent">{t("ss.booker")}</Pill> : null}</span>} />
                    <span className="num">{share ? money(share.amount) : "—"}</span>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </fieldset>
      ) : null}
    </Sheet>
  );
}
