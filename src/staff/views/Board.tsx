"use client";

import { useState } from "react";
import { useI18n, formatClock } from "@/lib/i18n";
import { rateFor } from "@/lib/pricing";
import type { Place, Session } from "@/lib/types";
import { Button, Card, Empty, Field, Input, Pill, SectionTitle, Select, Sheet, StatusDot, cx } from "@/components/ui";
import { activeSessionAt, billRunningTotal, billsAtPlace, billsInSession, customerById, liveRoomFee, segmentsOf, upcomingBookingFor } from "../derive";
import { dispatch, uuid } from "../store";
import { useNow, useSnap } from "../hooks";
import { BillCard } from "../components/BillCard";
import { CustomerPicker } from "../components/CustomerPicker";
import { EndSessionSheet, StartSessionSheet } from "../components/SessionSheets";

export type StartPreset = { placeId: string; customerId?: string; bookingId?: string };

export function Board({ focus, preset, onPresetHandled }: { focus?: string; preset: StartPreset | null; onPresetHandled: () => void }) {
  const { t } = useI18n();
  const snap = useSnap();
  const [openPlace, setOpenPlace] = useState<string | null>(focus ?? null);
  const rooms = snap.places.filter((p) => p.kind === "room" && p.active);
  const tables = snap.places.filter((p) => p.kind === "table" && p.active);


  const counterBills = snap.bills.filter((b) => b.status === "open" && !b.place_id);
  const placeOpen = snap.places.find((p) => p.id === openPlace);
  const presetPlace = preset ? snap.places.find((p) => p.id === preset.placeId) : undefined;

  return (
    <div className="grid gap-6">
      <section className="grid gap-3">
        <SectionTitle>{t("common.rooms")}</SectionTitle>
        <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 xl:grid-cols-4">
          {rooms.map((r) => <RoomTile key={r.id} room={r} onOpen={() => setOpenPlace(r.id)} />)}
        </div>
      </section>
      <section className="grid gap-3">
        <SectionTitle>{t("common.tables")}</SectionTitle>
        <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 xl:grid-cols-6">
          {tables.map((p) => <TableTile key={p.id} table={p} onOpen={() => setOpenPlace(p.id)} />)}
        </div>
      </section>
      <section className="grid gap-3">
        <SectionTitle action={<NewCounterBill />}>{t("common.counter")}</SectionTitle>
        {counterBills.length ? (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{counterBills.map((b) => <BillCard key={b.id} bill={b} compact />)}</div>
        ) : null}
      </section>

      {placeOpen ? (placeOpen.kind === "room" ? <RoomPanel room={placeOpen} onClose={() => setOpenPlace(null)} /> : <TablePanel table={placeOpen} onClose={() => setOpenPlace(null)} />) : null}
      {presetPlace ? <StartSessionSheet place={presetPlace} open onClose={onPresetHandled} presetCustomer={preset?.customerId} presetBooking={preset?.bookingId} /> : null}
    </div>
  );
}

function RoomTile({ room, onOpen }: { room: Place; onOpen: () => void }) {
  const { t, n, money, time } = useI18n();
  const snap = useSnap();
  const now = useNow(10000);
  const sess = activeSessionAt(snap, room.id);
  const next = upcomingBookingFor(snap, room.id, now, 12 * 60);
  if (!sess) {
    const openBills = billsAtPlace(snap, room.id).length;
    return (
      <button type="button" onClick={onOpen} className="text-start rounded-[2px] border-2 border-free bg-free-bg p-4 grid gap-2 min-h-36 hover:brightness-[1.03]">
        <div className="flex items-center justify-between gap-2">
          <span className="font-display text-2xl font-bold">{n(room)}</span>
          <span className="inline-flex items-center gap-1.5 font-bold text-free"><StatusDot tone="free" />{t("b.free")}</span>
        </div>
        {next ? <Pill tone="warn" className="justify-self-start">{t("b.nextBooking", { time: time(next.starts_at) })}</Pill> : null}
        {openBills ? <Pill className="justify-self-start">{t("b.bills", { n: openBills })} · {t("bl.checkout")}</Pill> : null}
      </button>
    );
  }
  const segs = segmentsOf(snap, sess.id);
  const mode = snap.modes.find((m) => m.id === segs[segs.length - 1]?.mode_id);
  const booker = customerById(snap, sess.booker_customer_id);
  const elapsed = (now.getTime() - Date.parse(sess.started_at)) / 60000;
  const fee = liveRoomFee(snap, sess, now);
  const members = billsInSession(snap, sess.id).length;
  const left = sess.kind === "fixed" && sess.planned_end ? (Date.parse(sess.planned_end) - now.getTime()) / 60000 : null;
  const timeUp = left != null && left <= 0;
  const soon = left != null && left > 0 && left <= 10;
  return (
    <button type="button" onClick={onOpen} className={cx("text-start rounded-[2px] border-2 border-busy bg-busy-bg p-4 grid gap-2 min-h-36 hover:brightness-[1.03]", timeUp && "alarm")}>
      <div className="flex items-center justify-between gap-2">
        <span className="font-display text-2xl font-bold">{n(room)}</span>
        <span className="inline-flex items-center gap-1.5 font-bold text-busy"><StatusDot tone="busy" />{t("b.inUse")}</span>
      </div>
      <div className="text-sm font-semibold">{n(mode)}{sess.group_size ? ` · ${t("common.people", { n: sess.group_size })}` : ""}</div>
      <div className="text-sm truncate">{booker?.name || booker?.phone}{members > 1 ? ` +${members - 1}` : ""}</div>
      <div className="flex items-end justify-between gap-2">
        <span className="num text-2xl font-bold">{formatClock(elapsed)}</span>
        <span className="num text-sm">{money(fee.fee)} <span className="text-muted">{t("b.estimate")}</span></span>
      </div>
      {left != null ? (
        <Pill tone={timeUp || soon ? "busy" : "neutral"} className="justify-self-start">{timeUp ? t("b.over", { t: formatClock(-left) }) : t("b.left", { t: formatClock(left) })}</Pill>
      ) : (
        <Pill className="justify-self-start">{t("b.openEnded")}</Pill>
      )}
      {next && next.session_id !== sess.id ? <Pill tone="warn" className="justify-self-start">{t("b.nextBooking", { time: time(next.starts_at) })}</Pill> : null}
    </button>
  );
}

function TableTile({ table, onOpen }: { table: Place; onOpen: () => void }) {
  const { t, n, money } = useI18n();
  const snap = useSnap();
  const now = useNow(15000);
  const bills = billsAtPlace(snap, table.id);
  const busy = bills.length > 0;
  const total = bills.reduce((a, b) => a + billRunningTotal(snap, b, now), 0);
  const hasNew = snap.orders.some((o) => o.place_id === table.id && o.status === "new");
  return (
    <button type="button" onClick={onOpen} className={cx("text-start rounded-[2px] border-2 p-3 grid gap-1.5 min-h-24 hover:brightness-[1.03]", busy ? "border-busy bg-busy-bg" : "border-free bg-free-bg", hasNew && "alarm")}>
      <div className="flex items-center justify-between gap-2">
        <span className="font-display text-xl font-bold">{n(table)}</span>
        <StatusDot tone={busy ? "busy" : "free"} />
      </div>
      <span className={cx("text-sm font-bold", busy ? "text-busy" : "text-free")}>{busy ? t("b.inUse") : t("b.free")}</span>
      {busy ? <span className="num text-sm">{t("b.bills", { n: bills.length })} · {money(total)}</span> : null}
    </button>
  );
}

function NewCounterBill() {
  const { t } = useI18n();
  const snap = useSnap();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>{t("bl.counterBill")}</Button>
      <Sheet open={open} onClose={() => setOpen(false)} title={t("bl.counterBill")}>
        <CustomerPicker
          onPick={(cid) => {
            if (!snap.bills.some((b) => b.customer_id === cid && b.status === "open")) dispatch("open_bill", { id: uuid(), customer_id: cid, place_id: null, session_id: null });
            setOpen(false);
          }}
        />
      </Sheet>
    </>
  );
}

function RoomPanel({ room, onClose }: { room: Place; onClose: () => void }) {
  const { t, n } = useI18n();
  const snap = useSnap();
  const sess = activeSessionAt(snap, room.id);
  const endedBills = snap.bills.filter((b) => b.place_id === room.id && b.status === "open" && (!b.session_id || snap.sessions.find((s) => s.id === b.session_id)?.status === "ended"));
  // Unpaid bills from a finished session come first; "Start session" opens on top only when asked.
  const [starting, setStarting] = useState(!sess && !endedBills.length);
  const [ending, setEnding] = useState(false);

  if (!sess) {
    if (endedBills.length) {
      // Session ended but bills still open: show them for checkout.
      return (
        <Sheet open onClose={onClose} wide title={n(room)}>
          <div className="grid gap-3">{endedBills.map((b) => <BillCard key={b.id} bill={b} compact />)}</div>
          <Button variant="free" onClick={() => setStarting(true)}>{t("ss.start")}</Button>
          {starting ? <StartSessionSheet place={room} open onClose={() => setStarting(false)} /> : null}
        </Sheet>
      );
    }
    return <StartSessionSheet place={room} open={starting} onClose={onClose} />;
  }

  return (
    <Sheet open onClose={onClose} wide title={n(room)}>
      <SessionControls session={sess} onEnd={() => setEnding(true)} />
      {ending ? <EndSessionSheet session={sess} open onClose={() => setEnding(false)} onEnded={() => setEnding(false)} /> : null}
    </Sheet>
  );
}

function SessionControls({ session, onEnd }: { session: Session; onEnd: () => void }) {
  const { t, n, money, time, dur } = useI18n();
  const snap = useSnap();
  const now = useNow(5000);
  const [adding, setAdding] = useState(false);
  const [group, setGroup] = useState(session.group_size ? String(session.group_size) : "");
  const segs = segmentsOf(snap, session.id);
  const current = segs[segs.length - 1];
  const fee = liveRoomFee(snap, session, now);
  const bills = billsInSession(snap, session.id);
  const booker = customerById(snap, session.booker_customer_id);
  const extend = (min: number) => {
    const base = session.kind === "fixed" && session.planned_end ? Math.max(Date.parse(session.planned_end), Date.now()) : Date.now();
    dispatch("update_session", { session_id: session.id, kind: "fixed", planned_end: new Date(base + min * 60000).toISOString() });
  };

  return (
    <div className="grid gap-4">
      <Card className="p-3 grid gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="grid">
            <span className="text-sm text-muted">{t("ss.booker")}</span>
            <span className="font-semibold">{booker?.name || "—"} <span className="num text-sm text-muted">{booker?.phone}</span></span>
          </div>
          <div className="text-end">
            <div className="num text-2xl font-bold">{formatClock((now.getTime() - Date.parse(session.started_at)) / 60000)}</div>
            <div className="num text-sm">{money(fee.fee)} <span className="text-muted">{t("b.estimate")}</span></div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {session.kind === "fixed" && session.planned_end ? <Pill tone="warn">{t("ss.plannedEnd", { time: time(session.planned_end) })}</Pill> : <Pill>{t("b.openEnded")}</Pill>}
          <span className="text-muted">{segs.map((g) => `${n(snap.modes.find((m) => m.id === g.mode_id))} (${dur(((g.ended_at ? Date.parse(g.ended_at) : now.getTime()) - Date.parse(g.started_at)) / 60000)})`).join(" → ")}</span>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("ss.changeMode")}>
            <Select id="sess-mode" value={current?.mode_id} onChange={(e) => e.target.value !== current?.mode_id && dispatch("change_mode", { session_id: session.id, mode_id: e.target.value, segment_id: uuid() })}>
              {snap.modes.filter((m) => m.active || m.id === current?.mode_id).map((m) => (
                <option key={m.id} value={m.id}>{n(m)} · {money(rateFor(snap.modes, snap.mode_prices, session.place_id, m.id))}{t("common.perHour")}</option>
              ))}
            </Select>
          </Field>
          <Field label={t("ss.group")}>
            <Input id="sess-group" numeric inputMode="numeric" value={group} onChange={(e) => setGroup(e.target.value.replace(/\D/g, "").slice(0, 3))} onBlur={() => dispatch("update_session", { session_id: session.id, group_size: group ? Number(group) : null })} />
          </Field>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <span className="text-sm font-semibold self-center">{t("ss.extend")}:</span>
          <Button size="sm" onClick={() => extend(30)}>{t("a.extend30")}</Button>
          <Button size="sm" onClick={() => extend(60)}>{t("a.extend60")}</Button>
          {session.kind === "fixed" ? <Button size="sm" onClick={() => dispatch("update_session", { session_id: session.id, kind: "open" })}>{t("ss.makeOpen")}</Button> : null}
          <Button size="sm" variant="danger" className="ms-auto" onClick={onEnd}>{t("ss.end")}</Button>
        </div>
      </Card>

      <div className="flex items-center justify-between gap-2">
        <h4 className="font-display text-lg font-bold">{t("ss.members")}</h4>
        <Button size="sm" onClick={() => setAdding(true)}>{t("ss.addMember")}</Button>
      </div>
      {bills.length ? <div className="grid gap-3 md:grid-cols-2">{bills.map((b) => <BillCard key={b.id} bill={b} compact />)}</div> : <Empty>{t("common.none")}</Empty>}

      <Sheet open={adding} onClose={() => setAdding(false)} title={t("ss.addMember")}>
        <CustomerPicker
          exclude={bills.map((b) => b.customer_id)}
          onPick={(cid) => {
            dispatch("add_member", { session_id: session.id, customer_id: cid, bill_id: uuid() });
            setAdding(false);
          }}
        />
      </Sheet>
    </div>
  );
}

function TablePanel({ table, onClose }: { table: Place; onClose: () => void }) {
  const { t, n } = useI18n();
  const snap = useSnap();
  const [adding, setAdding] = useState(false);
  const bills = billsAtPlace(snap, table.id);
  return (
    <Sheet open onClose={onClose} wide title={n(table)}>
      {bills.length ? <div className="grid gap-3 md:grid-cols-2">{bills.map((b) => <BillCard key={b.id} bill={b} compact />)}</div> : <Empty>{t("bl.none")}</Empty>}
      <Button variant="accent" onClick={() => setAdding(true)}>{t("bl.new")}</Button>
      <Sheet open={adding} onClose={() => setAdding(false)} title={`${t("bl.new")} · ${n(table)}`}>
        <CustomerPicker
          onPick={(cid) => {
            const existing = snap.bills.find((b) => b.customer_id === (snap.aliases?.[cid] ?? cid) && b.status === "open");
            if (existing) dispatch("move_bill", { bill_id: existing.id, place_id: table.id });
            else dispatch("open_bill", { id: uuid(), customer_id: cid, place_id: table.id, session_id: null });
            setAdding(false);
          }}
        />
      </Sheet>
    </Sheet>
  );
}
