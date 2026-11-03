"use client";

import { useMemo, useState } from "react";
import { useErrorText, useI18n } from "@/lib/i18n";
import { errorCode, isNetworkError, rpc } from "@/lib/supabase";
import { isValidPhone, normalizePhone } from "@/lib/phone";
import type { Catalog } from "@/lib/types";
import { Button, Card, Field, Input, Pill, Segmented, Select, SectionTitle, Sheet, StatusDot, Textarea } from "@/components/ui";
import { getIdentity, setIdentity } from "./local";

// Builds an ISO timestamp from a Cairo wall-clock date + time.
function cairoToIso(date: string, time: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const offsetMin = (ms: number) => {
    const p = new Intl.DateTimeFormat("en-US", { timeZone: "Africa/Cairo", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(new Date(ms));
    const g = (t: string) => Number(p.find((x) => x.type === t)?.value);
    return (Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute")) - ms) / 60000;
  };
  return new Date(guess - offsetMin(guess) * 60000).toISOString();
}

function cairoToday(offsetDays = 0) {
  const d = new Date(Date.now() + offsetDays * 86400000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

export function BookView({ catalog }: { catalog: Catalog }) {
  const { t, n, money, time, date, dur } = useI18n();
  const errText = useErrorText();
  const rooms = catalog.places.filter((p) => p.kind === "room");
  const [roomId, setRoomId] = useState(rooms[0]?.id ?? "");
  const [modeId, setModeId] = useState(catalog.modes[0]?.id ?? "");
  const [day, setDay] = useState(cairoToday());
  const [clock, setClock] = useState("18:00");
  const [duration, setDuration] = useState("120");
  const [group, setGroup] = useState("");
  const [phone, setPhone] = useState(() => getIdentity().phone);
  const [name, setName] = useState(() => getIdentity().name);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ code: string | null } | null>(null);

  const days = useMemo(() => Array.from({ length: 14 }, (_, i) => cairoToday(i)), []);
  const schedule = catalog.schedule.filter((s) => s.place_id === roomId);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await rpc<{ booking_id: string; customer_code: string | null }>("customer_book", {
        p_phone: normalizePhone(phone),
        p_name: name.trim(),
        p_place_id: roomId,
        p_mode_id: modeId,
        p_starts_at: cairoToIso(day, clock),
        p_duration: Number(duration),
        p_group_size: group ? Number(group) : null,
        p_note: note.trim(),
      });
      const prev = getIdentity();
      setIdentity({ phone: normalizePhone(phone), code: res.customer_code ?? (prev.phone === normalizePhone(phone) ? prev.code : ""), name: name.trim() || prev.name });
      setDone({ code: res.customer_code });
    } catch (e) {
      setError(errText(isNetworkError(e) ? "network" : errorCode(e)));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-5">
      <SectionTitle>{t("c.book.title")}</SectionTitle>
      <p className="text-sm text-muted">{t("c.book.hint")}</p>

      <div className="grid gap-3 sm:grid-cols-3">
        {rooms.map((r) => {
          const upcoming = catalog.schedule.filter((s) => s.place_id === r.id).slice(0, 3);
          return (
            <button
              key={r.id}
              type="button"
              onClick={() => setRoomId(r.id)}
              aria-pressed={roomId === r.id}
              className={`text-start rounded-[2px] border-2 p-3 grid gap-2 ${roomId === r.id ? "border-strong bg-surface" : "border-line bg-surface/60"} ${r.busy ? "hatch" : ""}`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-display text-lg font-bold">{n(r)}</span>
                <span className="inline-flex items-center gap-1.5 text-xs font-semibold">
                  <StatusDot tone={r.busy ? "busy" : "free"} />
                  {r.busy ? t("c.book.nowBusy") : t("c.book.nowFree")}
                </span>
              </div>
              {upcoming.length ? (
                <div className="text-xs text-muted grid gap-0.5">
                  {upcoming.map((u, i) => (
                    <span key={i}>{date(u.starts_at)} · {time(u.starts_at)} · {dur(u.duration_minutes)}</span>
                  ))}
                </div>
              ) : null}
            </button>
          );
        })}
      </div>

      <Card className="p-4 grid gap-4">
        <Field group label={t("c.book.mode")}>
          <Segmented value={modeId} onChange={setModeId} options={catalog.modes.map((m) => ({ value: m.id, label: <span>{n(m)} · <span className="num">{money(m.hourly_rate)}</span>{t("common.perHour")}</span> }))} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label={t("c.book.date")}>
            <Select id="book-day" value={day} onChange={(e) => setDay(e.target.value)}>
              {days.map((d) => (
                <option key={d} value={d}>{date(cairoToIso(d, "12:00"))}</option>
              ))}
            </Select>
          </Field>
          <Field label={t("c.book.time")}>
            <Input id="book-time" type="time" step={900} value={clock} onChange={(e) => setClock(e.target.value)} className="num" dir="ltr" />
          </Field>
          <Field label={t("c.book.duration")}>
            <Select id="book-duration" value={duration} onChange={(e) => setDuration(e.target.value)}>
              {[60, 90, 120, 180, 240, 300, 360, 480].map((m) => (
                <option key={m} value={m}>{dur(m)}</option>
              ))}
            </Select>
          </Field>
        </div>
        {schedule.length ? (
          <div className="grid gap-1">
            <span className="text-sm font-semibold">{t("c.book.taken")}</span>
            <div className="flex flex-wrap gap-1.5">
              {schedule.map((s, i) => (
                <Pill key={i} tone="busy">{date(s.starts_at)} {time(s.starts_at)} · {dur(s.duration_minutes)}</Pill>
              ))}
            </div>
          </div>
        ) : null}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("common.phone")}>
            <Input id="book-phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" placeholder="01xxxxxxxxx" />
          </Field>
          <Field label={t("common.nameOptional")}>
            <Input id="book-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} autoComplete="name" />
          </Field>
          <Field label={t("c.book.group")}>
            <Input id="book-group" numeric inputMode="numeric" value={group} onChange={(e) => setGroup(e.target.value.replace(/\D/g, "").slice(0, 3))} />
          </Field>
        </div>
        <Field label={t("common.noteOptional")}>
          <Textarea id="book-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} rows={2} />
        </Field>
        {error ? <p className="text-busy font-semibold text-sm">{error}</p> : null}
        <Button variant="accent" size="lg" busy={busy} disabled={!roomId || !modeId || !isValidPhone(phone)} onClick={submit}>
          {t("c.book.send")}
        </Button>
      </Card>

      <Sheet open={!!done} onClose={() => setDone(null)} title={t("c.book.sent")} footer={<Button variant="primary" onClick={() => setDone(null)}>{t("common.close")}</Button>}>
        <p>{t("c.book.hint")}</p>
        {done?.code ? (
          <Card className="p-4 grid gap-1 text-center border-strong">
            <span className="text-sm text-muted">{t("c.yourCodeIs")}</span>
            <span className="num text-4xl font-bold tracking-[0.3em]">{done.code}</span>
            <span className="text-sm">{t("c.keepCode")}</span>
          </Card>
        ) : null}
      </Sheet>
    </div>
  );
}
