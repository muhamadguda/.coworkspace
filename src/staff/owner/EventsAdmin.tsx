"use client";

import { useCallback, useEffect, useState } from "react";
import { useErrorText, useI18n } from "@/lib/i18n";
import { errorCode, supabase } from "@/lib/supabase";
import { cairoInstant } from "@/lib/billing";
import { dotQrSvg } from "@/lib/dotqr";
import { downloadCsv, intlPhone } from "@/lib/csv";
import { openWhatsApp, waNumber } from "@/lib/phone";
import { printHtml } from "@/lib/print";
import { Button, Card, Empty, Field, Input, Pill, SectionTitle, Select, Sheet, Textarea, Toggle, cx, useToast } from "@/components/ui";
import { uuid } from "../store";
import { useNow, useOnline, useSnap } from "../hooks";

type EventRow = {
  id: string;
  title_ar: string;
  title_en: string;
  desc_ar: string;
  desc_en: string;
  starts_at: string;
  ends_at: string | null;
  place_id: string | null;
  price: number;
  capacity: number | null;
  image_url: string;
  active: boolean;
};
type Signup = { id: string; event_id: string; seats: number; note: string; status: "going" | "cancelled" | "attended"; created_at: string; customers: { name: string; phone: string } | null };

// <input type="datetime-local"> speaks Cairo wall-clock time, whatever the device's zone.
const cairoFmt = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
function toLocalInput(iso: string | null) {
  if (!iso) return "";
  const p = Object.fromEntries(cairoFmt.formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}
function fromLocalInput(v: string): string | null {
  const m = v.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  return m ? new Date(cairoInstant(+m[1], +m[2], +m[3], +m[4], +m[5])).toISOString() : null;
}

export function EventsAdmin() {
  const { t, n, money, dateTime } = useI18n();
  const online = useOnline();
  const errText = useErrorText();
  const toast = useToast();
  const [events, setEvents] = useState<EventRow[] | null>(null);
  const [signups, setSignups] = useState<Signup[]>([]);
  const [edit, setEdit] = useState<Partial<EventRow> | null>(null);
  const [viewing, setViewing] = useState<EventRow | null>(null);

  const load = useCallback(() => {
    const sb = supabase();
    return Promise.all([
      sb.from("events").select("*").order("starts_at", { ascending: false }).limit(100),
      sb.from("event_signups").select("id, event_id, seats, note, status, created_at, customers(name, phone)").order("created_at").limit(5000),
    ]).then(([e, s]) => {
      if (e.error || s.error) {
        toast(errText(errorCode(e.error ?? s.error)), "error");
        return;
      }
      setEvents(e.data as EventRow[]);
      setSignups(s.data as unknown as Signup[]);
    });
  }, [errText, toast]);
  useEffect(() => {
    void load();
    // Sign-ups arrive live while this screen is open.
    const ch = supabase().channel("events-admin").on("postgres_changes", { event: "*", schema: "public", table: "event_signups" }, () => void load()).subscribe();
    return () => void supabase().removeChannel(ch);
  }, [load]);

  const now = useNow(60_000).getTime();
  const upcoming = (events ?? []).filter((e) => Date.parse(e.ends_at ?? e.starts_at) + 3 * 3600_000 > now).reverse();
  const past = (events ?? []).filter((e) => !upcoming.includes(e));
  const taken = (id: string) => signups.filter((s) => s.event_id === id && s.status !== "cancelled").reduce((a, s) => a + s.seats, 0);

  const row = (e: EventRow) => (
    <div key={e.id} className={cx("flex flex-wrap items-center justify-between gap-2 py-3", !e.active && "opacity-50")}>
      <span className="grid min-w-0">
        <span className="font-semibold">{n({ name_ar: e.title_ar, name_en: e.title_en })}</span>
        <span className="text-xs text-muted">{dateTime(e.starts_at)} · {e.price > 0 ? money(e.price) : t("ev.free")}</span>
      </span>
      <span className="flex flex-wrap items-center gap-2">
        <Pill tone={e.capacity != null && taken(e.id) >= e.capacity ? "busy" : "accent"}>
          <span className="num">{taken(e.id)}{e.capacity != null ? ` / ${e.capacity}` : ""}</span> {t("ev.seatsShort")}
        </Pill>
        <Button size="sm" onClick={() => setViewing(e)}>{t("ev.signups")}</Button>
        <Button size="sm" disabled={!online} onClick={() => setEdit({ ...e })}>{t("common.edit")}</Button>
      </span>
    </div>
  );

  return (
    <div className="grid gap-6">
      {!online ? <p className="text-busy font-semibold">{t("m.onlineOnly")}</p> : null}
      <Card className="p-4 grid gap-3">
        <SectionTitle action={<div className="flex flex-wrap gap-2">
          <a href="/events" target="_blank" rel="noreferrer" className="h-9 px-3 inline-flex items-center rounded-[2px] border-2 border-line font-semibold text-sm">{t("ev.openPage")}</a>
          <Button size="sm" variant="accent" disabled={!online} onClick={() => setEdit({ title_ar: "", title_en: "", desc_ar: "", desc_en: "", starts_at: new Date(Math.ceil(Date.now() / 3600_000) * 3600_000 + 7 * 86400_000).toISOString(), ends_at: null, place_id: null, price: 0, capacity: 20, image_url: "", active: true })}>{t("ev.new")}</Button>
        </div>}>{t("ev.upcoming")}</SectionTitle>
        {!events ? <div className="h-20 bg-surface-2 animate-pulse rounded-[2px]" /> : upcoming.length ? <div className="divide-y-2 divide-line">{upcoming.map(row)}</div> : <Empty>{t("ev.none")}</Empty>}
      </Card>
      {past.length ? (
        <Card className="p-4 grid gap-3">
          <SectionTitle>{t("ev.past")}</SectionTitle>
          <div className="divide-y-2 divide-line">{past.map(row)}</div>
        </Card>
      ) : null}
      {edit ? <EventEditor edit={edit} setEdit={setEdit} onSaved={() => { setEdit(null); void load(); }} /> : null}
      {viewing ? <SignupsSheet e={viewing} list={signups.filter((s) => s.event_id === viewing.id)} onClose={() => setViewing(null)} onChanged={load} /> : null}
    </div>
  );
}

function EventEditor({ edit, setEdit, onSaved }: { edit: Partial<EventRow>; setEdit: (e: Partial<EventRow> | null) => void; onSaved: () => void }) {
  const { t, n } = useI18n();
  const snap = useSnap();
  const toast = useToast();
  const errText = useErrorText();
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [start, setStart] = useState(toLocalInput(edit.starts_at ?? null));
  const [end, setEnd] = useState(toLocalInput(edit.ends_at ?? null));
  const places = snap.places.filter((p) => p.active);
  const startsAt = fromLocalInput(start);
  const endsAt = end ? fromLocalInput(end) : null;
  const valid = !!edit.title_ar?.trim() && !!edit.title_en?.trim() && !!startsAt && (!endsAt || endsAt > startsAt);

  async function upload(file: File) {
    setUploading(true);
    const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
    const path = `events/${uuid()}.${ext}`;
    const { error } = await supabase().storage.from("menu").upload(path, file, { contentType: file.type, upsert: false });
    setUploading(false);
    if (error) return toast(errText(errorCode(error)), "error");
    setEdit({ ...edit, image_url: supabase().storage.from("menu").getPublicUrl(path).data.publicUrl });
  }

  async function save() {
    setBusy(true);
    const row = {
      title_ar: edit.title_ar!.trim(), title_en: edit.title_en!.trim(), desc_ar: (edit.desc_ar ?? "").trim(), desc_en: (edit.desc_en ?? "").trim(),
      starts_at: startsAt, ends_at: endsAt, place_id: edit.place_id || null, price: Math.max(0, Number(edit.price) || 0),
      capacity: edit.capacity == null || String(edit.capacity) === "" ? null : Math.min(2000, Math.max(1, Math.round(Number(edit.capacity) || 1))),
      image_url: edit.image_url ?? "", active: edit.active !== false,
    };
    const sb = supabase();
    const { error } = edit.id ? await sb.from("events").update(row).eq("id", edit.id) : await sb.from("events").insert(row);
    setBusy(false);
    if (error) return toast(errText(errorCode(error)), "error");
    toast(t("common.saved"));
    onSaved();
  }

  async function remove() {
    const { error } = await supabase().from("events").delete().eq("id", edit.id!);
    if (error) return toast(errText(errorCode(error)), "error");
    onSaved();
  }

  return (
    <Sheet open wide onClose={() => setEdit(null)} title={edit.id ? n({ name_ar: edit.title_ar ?? "", name_en: edit.title_en ?? "" }) : t("ev.new")} footer={<>
      {edit.id ? <Button variant="danger" onClick={remove}>{t("common.delete")}</Button> : null}
      <Button variant="primary" busy={busy} disabled={!valid} onClick={save}>{t("common.save")}</Button>
    </>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("ev.titleAr")}><Input id="ev-tar" dir="rtl" maxLength={120} value={edit.title_ar ?? ""} onChange={(e) => setEdit({ ...edit, title_ar: e.target.value })} placeholder="ليلة سينما" /></Field>
        <Field label={t("ev.titleEn")}><Input id="ev-ten" dir="ltr" maxLength={120} value={edit.title_en ?? ""} onChange={(e) => setEdit({ ...edit, title_en: e.target.value })} placeholder="Movie night" /></Field>
        <Field label={t("ev.descAr")}><Textarea id="ev-dar" dir="rtl" maxLength={2000} rows={4} value={edit.desc_ar ?? ""} onChange={(e) => setEdit({ ...edit, desc_ar: e.target.value })} /></Field>
        <Field label={t("ev.descEn")}><Textarea id="ev-den" dir="ltr" maxLength={2000} rows={4} value={edit.desc_en ?? ""} onChange={(e) => setEdit({ ...edit, desc_en: e.target.value })} /></Field>
        <Field label={t("ev.starts")}><Input id="ev-start" type="datetime-local" dir="ltr" value={start} onChange={(e) => setStart(e.target.value)} /></Field>
        <Field label={t("ev.ends")} hint={t("ev.endsHint")}><Input id="ev-end" type="datetime-local" dir="ltr" value={end} onChange={(e) => setEnd(e.target.value)} /></Field>
        <Field label={t("ev.price")} hint={t("ev.priceHint")}><Input id="ev-price" numeric value={String(edit.price ?? "")} onChange={(e) => setEdit({ ...edit, price: e.target.value as unknown as number })} /></Field>
        <Field label={t("ev.capacity")} hint={t("ev.capacityHint")}><Input id="ev-cap" numeric value={edit.capacity == null ? "" : String(edit.capacity)} onChange={(e) => setEdit({ ...edit, capacity: e.target.value === "" ? null : (e.target.value as unknown as number) })} /></Field>
        <Field label={t("ev.place")}>
          <Select id="ev-place" value={edit.place_id ?? ""} onChange={(e) => setEdit({ ...edit, place_id: e.target.value || null })}>
            <option value="">—</option>
            {places.map((p) => <option key={p.id} value={p.id}>{n(p)}</option>)}
          </Select>
        </Field>
        <Field group label={t("ev.image")}>
          <div className="flex items-center gap-3">
            {edit.image_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={edit.image_url} alt="" className="h-16 aspect-[16/9] object-cover rounded-[2px] border-2 border-line" />
            ) : null}
            <label className={cx("h-10 px-3 inline-flex items-center rounded-[2px] border-2 border-strong font-semibold text-sm cursor-pointer", uploading && "opacity-50 pointer-events-none")}>
              {uploading ? t("common.loading") : t("m.uploadPhoto")}
              <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
            </label>
            {edit.image_url ? <Button size="sm" variant="ghost" onClick={() => setEdit({ ...edit, image_url: "" })}>{t("common.delete")}</Button> : null}
          </div>
        </Field>
      </div>
      <Toggle checked={edit.active !== false} onChange={(x) => setEdit({ ...edit, active: x })} label={t("ev.visible")} />
    </Sheet>
  );
}

function SignupsSheet({ e, list, onClose, onChanged }: { e: EventRow; list: Signup[]; onClose: () => void; onChanged: () => void }) {
  const { t, n, lang, dateTime } = useI18n();
  const toast = useToast();
  const errText = useErrorText();
  const title = n({ name_ar: e.title_ar, name_en: e.title_en });
  const going = list.filter((s) => s.status !== "cancelled");
  const seats = going.reduce((a, s) => a + s.seats, 0);

  async function setStatus(s: Signup, status: Signup["status"]) {
    const { error } = await supabase().from("event_signups").update({ status, updated_at: new Date().toISOString() }).eq("id", s.id);
    if (error) return toast(errText(errorCode(error)), "error");
    onChanged();
  }

  function poster() {
    const url = `${location.origin}/events#${e.id}`;
    const qr = dotQrSvg(url, { label: e.title_en });
    const when = new Intl.DateTimeFormat(lang === "ar" ? "ar-EG-u-nu-latn" : "en-GB", { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Cairo" }).format(new Date(e.starts_at));
    const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
    printHtml(`<!doctype html><html lang="${lang}" dir="${lang === "ar" ? "rtl" : "ltr"}"><head><meta charset="utf-8"><title>${esc(title)}</title><style>
      @page { size: A4; margin: 14mm; } body { margin: 0; font-family: "IBM Plex Sans Arabic", "Segoe UI", Tahoma, sans-serif; color: #173a39; text-align: center; }
      .wrap { border: 3px solid #173a39; border-top: 14px solid #d9a21b; padding: 14mm 10mm; display: grid; gap: 6mm; justify-items: center; }
      h1 { font-size: 40px; margin: 0; } h2 { font-size: 22px; margin: 0; font-weight: 600; } .when { font-size: 20px; font-weight: 700; }
      .qr svg { width: 90mm; height: 90mm; } .cta { font-size: 18px; font-weight: 700; } .brand { letter-spacing: .3em; font-size: 14px; }
    </style></head><body><div class="wrap"><h1>${esc(e.title_ar)}</h1><h2>${esc(e.title_en)}</h2><div class="when">${esc(when)}</div><div class="qr">${qr}</div><div class="cta">${esc(t("ev.scanToJoin"))} · Scan to save your seat</div><div class="brand">dot · dotcowork.space/events</div></div></body></html>`);
  }

  function exportCsv() {
    downloadCsv(`dot-event-${e.starts_at.slice(0, 10)}.csv`, ["name", "phone", "seats", "status", "note", "signed_up"], list.map((s) => [s.customers?.name ?? "", s.customers ? intlPhone(waNumber(s.customers.phone)) : "", s.seats, s.status, s.note, s.created_at.slice(0, 16).replace("T", " ")]));
  }

  return (
    <Sheet open wide onClose={onClose} title={title} footer={<>
      <Button onClick={poster}>{t("ev.poster")}</Button>
      <Button disabled={!list.length} onClick={exportCsv}>{t("ev.export")}</Button>
    </>}>
      <div className="flex flex-wrap gap-2">
        <Pill tone="accent"><span className="num">{seats}{e.capacity != null ? ` / ${e.capacity}` : ""}</span> {t("ev.seatsShort")}</Pill>
        <Pill><span className="num">{going.length}</span> {t("ev.people")}</Pill>
      </div>
      {list.length ? (
        <ul className="divide-y-2 divide-line">
          {list.map((s) => (
            <li key={s.id} className={cx("py-2 flex flex-wrap items-center justify-between gap-2", s.status === "cancelled" && "opacity-50")}>
              <span className="grid min-w-0">
                <span className="font-semibold">{s.customers?.name || "—"} · <span className="num">×{s.seats}</span></span>
                <span className="num text-xs text-muted">{s.customers?.phone} · {dateTime(s.created_at)}{s.note ? ` · ${s.note}` : ""}</span>
              </span>
              <span className="flex flex-wrap gap-1.5">
                {s.status === "attended" ? <Pill tone="free">{t("ev.attended")}</Pill> : null}
                {s.customers ? <Button size="sm" onClick={() => openWhatsApp(s.customers!.phone, t("ev.waMsg", { name: s.customers!.name ? ` ${s.customers!.name}` : "", title }))}>WhatsApp</Button> : null}
                {s.status === "going" ? <Button size="sm" variant="free" onClick={() => setStatus(s, "attended")}>{t("ev.markAttended")}</Button> : null}
                {s.status !== "cancelled" ? <Button size="sm" variant="ghost" onClick={() => setStatus(s, "cancelled")}>{t("common.cancel")}</Button> : <Button size="sm" variant="ghost" onClick={() => setStatus(s, "going")}>{t("ev.restore")}</Button>}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <Empty>{t("ev.noSignups")}</Empty>
      )}
    </Sheet>
  );
}
