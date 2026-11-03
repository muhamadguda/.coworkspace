"use client";

import { useState } from "react";
import { useI18n } from "@/lib/i18n";
import { rateFor } from "@/lib/pricing";
import type { Booking } from "@/lib/types";
import { Button, Card, Empty, Field, Input, Pill, SectionTitle, Segmented, Select, Sheet, Textarea } from "@/components/ui";
import { customerById, placeById } from "../derive";
import { dispatch, uuid } from "../store";
import { useSnap } from "../hooks";
import { CustomerPicker } from "../components/CustomerPicker";

function cairoLocalToIso(local: string) {
  // local = "YYYY-MM-DDTHH:mm" in Cairo time
  const [d, tm] = local.split("T");
  const [y, m, day] = d.split("-").map(Number);
  const [hh, mm] = tm.split(":").map(Number);
  const guess = Date.UTC(y, m - 1, day, hh, mm);
  const p = new Intl.DateTimeFormat("en-US", { timeZone: "Africa/Cairo", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(new Date(guess));
  const g = (k: string) => Number(p.find((x) => x.type === k)?.value);
  const off = Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute")) - guess;
  return new Date(guess - off).toISOString();
}

export function BookingsView() {
  const { t } = useI18n();
  const snap = useSnap();
  const [creating, setCreating] = useState(false);
  const pending = snap.bookings.filter((b) => b.status === "pending").sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  const upcoming = snap.bookings.filter((b) => b.status === "confirmed").sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  return (
    <div className="grid gap-6">
      <section className="grid gap-3">
        <SectionTitle action={<Button size="sm" variant="accent" onClick={() => setCreating(true)}>{t("bk.new")}</Button>}>
          {t("bk.requests")} <span className="num">({pending.length})</span>
        </SectionTitle>
        {pending.length ? <div className="grid gap-3 md:grid-cols-2">{pending.map((b) => <BookingCard key={b.id} b={b} />)}</div> : <Empty>{t("bk.none")}</Empty>}
      </section>
      <section className="grid gap-3">
        <SectionTitle>{t("bk.upcoming")}</SectionTitle>
        {upcoming.length ? <div className="grid gap-3 md:grid-cols-2">{upcoming.map((b) => <BookingCard key={b.id} b={b} />)}</div> : <Empty>{t("bk.none")}</Empty>}
      </section>
      {creating ? <NewBooking onClose={() => setCreating(false)} /> : null}
    </div>
  );
}

function BookingCard({ b }: { b: Booking }) {
  const { t, n, money, dateTime, dur } = useI18n();
  const snap = useSnap();
  const c = customerById(snap, b.customer_id);
  const place = placeById(snap, b.place_id);
  const mode = snap.modes.find((m) => m.id === b.mode_id);
  const busy = snap.sessions.some((s) => s.place_id === b.place_id && s.status === "active");
  return (
    <Card className="p-3 grid gap-2">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="grid">
          <span className="font-display text-xl font-bold">{n(place)} · {n(mode)}</span>
          <span className="text-sm">{dateTime(b.starts_at)} · {dur(b.duration_minutes)}{b.group_size ? ` · ${t("common.people", { n: b.group_size })}` : ""}</span>
        </div>
        <Pill tone={b.status === "pending" ? "warn" : "free"}>{b.status === "pending" ? t("c.book.status.pending") : t("c.book.status.confirmed")}</Pill>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <span>{c?.name || "—"} <span className="num text-muted">{c?.phone}</span></span>
        {mode ? <span className="num text-muted">≈ {money((rateFor(snap.modes, snap.mode_prices, b.place_id, mode.id) * b.duration_minutes) / 60)}</span> : null}
      </div>
      {b.note ? <p className="text-sm text-muted">{b.note}</p> : null}
      <div className="flex flex-wrap gap-1.5">
        {c?.phone ? <a className="h-9 px-3 inline-flex items-center rounded-[2px] border-2 border-strong font-semibold text-sm num" href={`tel:${c.phone}`}>{t("bk.call")} {c.phone}</a> : null}
        {b.status === "pending" ? (
          <>
            <Button size="sm" variant="free" onClick={() => dispatch("booking_decide", { booking_id: b.id, status: "confirmed" })}>{t("bk.confirm")}</Button>
            <Button size="sm" onClick={() => dispatch("booking_decide", { booking_id: b.id, status: "rejected" })}>{t("bk.reject")}</Button>
          </>
        ) : (
          <>
            <Button size="sm" variant="accent" disabled={busy} onClick={() => window.dispatchEvent(new CustomEvent("dot:start-session", { detail: { placeId: b.place_id, customerId: b.customer_id, bookingId: b.id } }))}>
              {t("bk.start")}
            </Button>
            <Button size="sm" onClick={() => dispatch("booking_decide", { booking_id: b.id, status: "no_show" })}>{t("bk.noShow")}</Button>
            <Button size="sm" variant="ghost" onClick={() => dispatch("booking_decide", { booking_id: b.id, status: "cancelled" })}>{t("common.cancel")}</Button>
          </>
        )}
      </div>
    </Card>
  );
}

function NewBooking({ onClose }: { onClose: () => void }) {
  const { t, n, money, dur } = useI18n();
  const snap = useSnap();
  const rooms = snap.places.filter((p) => p.kind === "room" && p.active);
  const modes = snap.modes.filter((m) => m.active);
  const [customerId, setCustomerId] = useState<string>();
  const [placeId, setPlaceId] = useState(rooms[0]?.id ?? "");
  const [modeId, setModeId] = useState(modes[0]?.id ?? "");
  const [when, setWhen] = useState("");
  const [duration, setDuration] = useState("120");
  const [group, setGroup] = useState("");
  const [note, setNote] = useState("");
  const cust = customerId ? customerById(snap, customerId) : undefined;

  function create() {
    if (!customerId || !when) return;
    dispatch("booking_create", { id: uuid(), customer_id: customerId, place_id: placeId, mode_id: modeId, starts_at: cairoLocalToIso(when), duration_minutes: Number(duration), group_size: group ? Number(group) : null, note: note.trim() });
    onClose();
  }

  return (
    <Sheet open onClose={onClose} title={t("bk.new")} footer={<Button variant="accent" disabled={!customerId || !when} onClick={create}>{t("bk.create")}</Button>}>
      {cust ? (
        <Card className="p-3 flex items-center justify-between gap-2">
          <span className="font-semibold">{cust.name || "—"} <span className="num text-sm text-muted">{cust.phone}</span></span>
          <Button size="sm" variant="ghost" onClick={() => setCustomerId(undefined)}>{t("common.edit")}</Button>
        </Card>
      ) : (
        <CustomerPicker onPick={setCustomerId} />
      )}
      <Field group label={t("c.book.room")}>
        <Segmented value={placeId} onChange={setPlaceId} options={rooms.map((r) => ({ value: r.id, label: n(r) }))} />
      </Field>
      <Field group label={t("c.book.mode")}>
        <Segmented value={modeId} onChange={setModeId} options={modes.map((m) => ({ value: m.id, label: <span>{n(m)} · <span className="num">{money(rateFor(snap.modes, snap.mode_prices, placeId, m.id))}</span></span> }))} />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={`${t("c.book.date")} / ${t("c.book.time")}`}>
          <Input id="bk-when" type="datetime-local" step={900} value={when} onChange={(e) => setWhen(e.target.value)} className="num" dir="ltr" />
        </Field>
        <Field label={t("c.book.duration")}>
          <Select id="bk-duration" value={duration} onChange={(e) => setDuration(e.target.value)}>
            {[60, 90, 120, 180, 240, 300, 360, 480].map((m) => <option key={m} value={m}>{dur(m)}</option>)}
          </Select>
        </Field>
        <Field label={t("c.book.group")}>
          <Input id="bk-group" numeric inputMode="numeric" value={group} onChange={(e) => setGroup(e.target.value.replace(/\D/g, "").slice(0, 3))} />
        </Field>
      </div>
      <Field label={t("common.noteOptional")}>
        <Textarea id="bk-note" value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={300} />
      </Field>
    </Sheet>
  );
}
