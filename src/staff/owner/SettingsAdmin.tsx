"use client";

import { useState } from "react";
import { placeCard, printQrCards, wifiCard, type QrCard } from "@/lib/qrPrint";
import { useErrorText, useI18n } from "@/lib/i18n";
import { errorCode, rpc, supabase } from "@/lib/supabase";
import type { BundlePlan, HappyHour, Mode, Place, Settings } from "@/lib/types";
import { Button, Card, Field, Input, Pill, SectionTitle, Select, Sheet, Toggle, cx, useToast } from "@/components/ui";
import { refresh } from "../store";
import { useOnline, useSnap } from "../hooks";

export function SettingsAdmin() {
  const { t } = useI18n();
  const online = useOnline();
  return (
    <div className="grid gap-6">
      {!online ? <p className="text-busy font-semibold">{t("m.onlineOnly")}</p> : null}
      <GeneralSettingsKeyed />
      <PrintQrs />
      <ModesSettings />
      <RoomPrices />
      <BundlePlans />
      <HappyHours />
      <PlacesSettings />
    </div>
  );
}

function useAfterSave() {
  const toast = useToast();
  const errText = useErrorText();
  const { t } = useI18n();
  return async (p: PromiseLike<{ error: unknown }>) => {
    const { error } = await p;
    if (error) {
      toast(errText(errorCode(error)), "error");
      return false;
    }
    await refresh();
    toast(t("common.saved"));
    return true;
  };
}

function GeneralSettingsKeyed() {
  const snap = useSnap();
  return <GeneralSettings key={snap.settings.updated_at ?? "s"} />;
}

function GeneralSettings() {
  const { t } = useI18n();
  const toast = useToast();
  const snap = useSnap();
  const online = useOnline();
  const after = useAfterSave();
  const [v, setV] = useState<Settings>(snap.settings);
  const [busy, setBusy] = useState(false);
  const num = (k: keyof Settings) => ({ value: String(v[k] ?? ""), onChange: (e: React.ChangeEvent<HTMLInputElement>) => setV({ ...v, [k]: e.target.value as unknown as number }) });
  const txt = (k: keyof Settings) => ({ value: String(v[k] ?? ""), onChange: (e: React.ChangeEvent<HTMLInputElement>) => setV({ ...v, [k]: e.target.value }) });

  async function save() {
    setBusy(true);
    const row = {
      venue_name: v.venue_name.trim() || "dot", venue_address: v.venue_address.trim(), venue_whatsapp: v.venue_whatsapp.trim(),
      receipt_footer_ar: v.receipt_footer_ar.trim(), receipt_footer_en: v.receipt_footer_en.trim(),
      min_session_minutes: Number(v.min_session_minutes) || 0, billing_step_minutes: Math.max(1, Number(v.billing_step_minutes) || 1),
      grace_minutes: Number(v.grace_minutes) || 0, day_rollover_hour: Number(v.day_rollover_hour) || 0, booking_warning_minutes: Number(v.booking_warning_minutes) || 0,
      staff_discount_max_percent: Number(v.staff_discount_max_percent) || 0, staff_discount_max_amount: Number(v.staff_discount_max_amount) || 0,
      google_review_url: (v.google_review_url ?? "").trim(),
      loyalty_every: Math.min(100, Math.max(0, Math.round(Number(v.loyalty_every) || 0))),
      loyalty_reward_minutes: Math.min(1440, Math.max(0, Math.round(Number(v.loyalty_reward_minutes) || 0))),
      wifi_ssid: (v.wifi_ssid ?? "").trim().slice(0, 64),
      wifi_password: (v.wifi_password ?? "").slice(0, 64),
      instapay_link: (v.instapay_link ?? "").trim(),
      updated_at: new Date().toISOString(),
    };
    if (row.instapay_link && !/^https:\/\/\S+$/.test(row.instapay_link)) {
      toast(t("st.instapayBad"), "error");
      setBusy(false);
      return;
    }
    if (row.google_review_url && !/^https:\/\/\S+$/.test(row.google_review_url)) {
      toast(t("st.reviewUrlBad"), "error");
      setBusy(false);
      return;
    }
    await after(supabase().from("settings").update(row).eq("id", 1));
    setBusy(false);
  }

  return (
    <Card className="p-4 grid gap-5">
      <SectionTitle action={<Button variant="primary" busy={busy} disabled={!online} onClick={save}>{t("common.save")}</Button>}>{t("s.nav.settings")}</SectionTitle>
      <fieldset className="grid gap-3 sm:grid-cols-2">
        <legend className="font-semibold mb-2">{t("st.venue")}</legend>
        <Field label={t("st.venueName")}><Input id="st-name" {...txt("venue_name")} /></Field>
        <Field label={t("st.whatsapp")}><Input id="st-wa" type="tel" {...txt("venue_whatsapp")} /></Field>
        <Field label={t("st.address")} className="sm:col-span-2"><Input id="st-address" {...txt("venue_address")} /></Field>
        <Field label={t("st.footerAr")}><Input id="st-far" dir="rtl" {...txt("receipt_footer_ar")} /></Field>
        <Field label={t("st.footerEn")}><Input id="st-fen" dir="ltr" {...txt("receipt_footer_en")} /></Field>
      </fieldset>
      <fieldset className="grid gap-3 sm:grid-cols-3">
        <legend className="font-semibold mb-2">{t("st.billing")}</legend>
        <Field label={t("st.minMinutes")}><Input id="st-min" numeric {...num("min_session_minutes")} /></Field>
        <Field label={t("st.step")}><Input id="st-step" numeric {...num("billing_step_minutes")} /></Field>
        <Field label={t("st.grace")}><Input id="st-grace" numeric {...num("grace_minutes")} /></Field>
        <Field label={t("st.rollover")}><Input id="st-roll" numeric {...num("day_rollover_hour")} /></Field>
        <Field label={t("st.bookingWarn")}><Input id="st-bw" numeric {...num("booking_warning_minutes")} /></Field>
      </fieldset>
      <fieldset className="grid gap-3 sm:grid-cols-3">
        <legend className="font-semibold mb-2">{t("st.discountCaps")}</legend>
        <Field label={t("st.maxPercent")}><Input id="st-pct" numeric {...num("staff_discount_max_percent")} /></Field>
        <Field label={t("st.maxAmount")}><Input id="st-amt" numeric {...num("staff_discount_max_amount")} /></Field>
      </fieldset>
      <fieldset className="grid gap-3 sm:grid-cols-3">
        <legend className="font-semibold mb-2">{t("st.growth")}</legend>
        <Field label={t("st.reviewUrl")} hint={t("st.reviewUrlHint")} className="sm:col-span-3"><Input id="st-review" type="url" dir="ltr" placeholder="https://g.page/r/…/review" {...txt("google_review_url")} /></Field>
        <Field label={t("st.loyaltyEvery")} hint={t("st.loyaltyEveryHint")}><Input id="st-loy-every" numeric {...num("loyalty_every")} /></Field>
        <Field label={t("st.loyaltyMinutes")}><Input id="st-loy-min" numeric {...num("loyalty_reward_minutes")} /></Field>
      </fieldset>
      <fieldset className="grid gap-3 sm:grid-cols-3">
        <legend className="font-semibold mb-2">{t("st.guestQr")}</legend>
        <Field label={t("wifi.network")}><Input id="st-wifi" dir="ltr" maxLength={64} {...txt("wifi_ssid")} /></Field>
        <Field label={t("wifi.password")}><Input id="st-wifi-pass" dir="ltr" maxLength={64} autoComplete="off" {...txt("wifi_password")} /></Field>
        <Field label={t("st.instapay")} hint={t("st.instapayHint")} className="sm:col-span-3"><Input id="st-instapay" type="url" dir="ltr" placeholder="https://ipn.eg/S/…" {...txt("instapay_link")} /></Field>
      </fieldset>
    </Card>
  );
}

function BundlePlans() {
  const { t, n, money } = useI18n();
  const snap = useSnap();
  const online = useOnline();
  const after = useAfterSave();
  const [edit, setEdit] = useState<Partial<BundlePlan> | null>(null);
  const plans = snap.bundle_plans ?? [];
  const modeName = (id: string | null | undefined) => (id ? n(snap.modes.find((m) => m.id === id)) : t("bu.anyMode"));
  return (
    <Card className="p-4 grid gap-3">
      <SectionTitle action={<Button size="sm" variant="accent" disabled={!online} onClick={() => setEdit({ name_ar: "", name_en: "", hours: 10, price: 0, valid_days: 30, mode_id: null, sort: plans.length + 1, active: true })}>{t("bu.new")}</Button>}>{t("bu.title")}</SectionTitle>
      <p className="text-sm text-muted">{t("bu.hint")}</p>
      <div className="divide-y-2 divide-line">
        {plans.map((b) => (
          <div key={b.id} className={cx("flex flex-wrap items-center justify-between gap-2 py-2", b.active === false && "opacity-50")}>
            <span className="grid">
              <span className="font-semibold">{n(b)}</span>
              <span className="text-xs text-muted"><span className="num">{b.hours}</span> h · {modeName(b.mode_id)} · <span className="num">{b.valid_days}</span> {t("bu.validDays")}</span>
            </span>
            <span className="flex items-center gap-2">
              <span className="num font-bold">{money(b.price)}</span>
              <Button size="sm" disabled={!online} onClick={() => setEdit(b)}>{t("common.edit")}</Button>
            </span>
          </div>
        ))}
      </div>
      {edit ? (
        <Sheet open onClose={() => setEdit(null)} title={edit.id ? n(edit as BundlePlan) : t("bu.new")} footer={<Button variant="primary" disabled={!edit.name_ar?.trim() || !edit.name_en?.trim() || !(Number(edit.hours) > 0)} onClick={async () => {
          const row = {
            name_ar: edit.name_ar!.trim(), name_en: edit.name_en!.trim(), hours: Number(edit.hours) || 0, price: Number(edit.price) || 0,
            valid_days: Math.min(730, Math.max(1, Number(edit.valid_days) || 30)), mode_id: edit.mode_id || null, sort: Number(edit.sort) || 0, active: edit.active !== false,
          };
          if (await after(edit.id ? supabase().from("bundle_plans").update(row).eq("id", edit.id) : supabase().from("bundle_plans").insert(row))) setEdit(null);
        }}>{t("common.save")}</Button>}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t("m.nameAr")}><Input id="bu-ar" dir="rtl" value={edit.name_ar ?? ""} onChange={(e) => setEdit({ ...edit, name_ar: e.target.value })} placeholder="باقة ١٠ ساعات" /></Field>
            <Field label={t("m.nameEn")}><Input id="bu-en" dir="ltr" value={edit.name_en ?? ""} onChange={(e) => setEdit({ ...edit, name_en: e.target.value })} placeholder="10-hour pack" /></Field>
            <Field label={t("bu.hours")}><Input id="bu-hours" numeric value={String(edit.hours ?? "")} onChange={(e) => setEdit({ ...edit, hours: e.target.value as unknown as number })} /></Field>
            <Field label={t("bu.price")}><Input id="bu-price" numeric value={String(edit.price ?? "")} onChange={(e) => setEdit({ ...edit, price: e.target.value as unknown as number })} /></Field>
            <Field label={t("bu.validDays")}><Input id="bu-days" numeric value={String(edit.valid_days ?? "")} onChange={(e) => setEdit({ ...edit, valid_days: e.target.value as unknown as number })} /></Field>
            <Field label={t("bu.mode")}>
              <Select id="bu-mode" value={edit.mode_id ?? ""} onChange={(e) => setEdit({ ...edit, mode_id: e.target.value || null })}>
                <option value="">{t("bu.anyMode")}</option>
                {snap.modes.filter((m) => m.active).map((m) => <option key={m.id} value={m.id}>{n(m)}</option>)}
              </Select>
            </Field>
          </div>
          <Toggle checked={edit.active !== false} onChange={(x) => setEdit({ ...edit, active: x })} label={t("st.active")} />
        </Sheet>
      ) : null}
    </Card>
  );
}

const DAYS = [6, 0, 1, 2, 3, 4, 5]; // Saturday first, as the week runs in Egypt

/** Happy hours: % off the hourly price on chosen days and times. */
function HappyHours() {
  const { t, n, lang } = useI18n();
  const snap = useSnap();
  const online = useOnline();
  const after = useAfterSave();
  const [edit, setEdit] = useState<Partial<HappyHour> | null>(null);
  const list = snap.happy_hours ?? [];
  const dayName = (d: number) => new Intl.DateTimeFormat(lang === "ar" ? "ar-EG" : "en-GB", { weekday: "short", timeZone: "UTC" }).format(new Date(Date.UTC(2024, 0, 7 + d)));
  const days = (h: Partial<HappyHour>) => (h.days?.length === 7 ? t("hh.everyDay") : DAYS.filter((d) => h.days?.includes(d)).map(dayName).join(" · "));
  const scope = (h: Partial<HappyHour>) => [h.applies_to === "room" ? t("hh.roomsOnly") : h.applies_to === "area" ? t("hh.areasOnly") : t("hh.everywhere"), h.mode_id ? n(snap.modes.find((m) => m.id === h.mode_id)) : null].filter(Boolean).join(" · ");
  const valid = !!edit && !!edit.days?.length && /^\d{2}:\d{2}$/.test(edit.start_time ?? "") && /^\d{2}:\d{2}$/.test(edit.end_time ?? "") && edit.start_time !== edit.end_time && Number(edit.percent_off) > 0 && Number(edit.percent_off) <= 100;
  return (
    <Card className="p-4 grid gap-3">
      <SectionTitle action={<Button size="sm" variant="accent" disabled={!online} onClick={() => setEdit({ name_ar: "", name_en: "", days: [0, 1, 2, 3, 4, 5, 6], start_time: "12:00", end_time: "16:00", percent_off: 20, applies_to: "all", mode_id: null, active: true })}>{t("hh.new")}</Button>}>{t("hh.title")}</SectionTitle>
      <p className="text-sm text-muted">{t("hh.hint")}</p>
      <div className="divide-y-2 divide-line">
        {list.map((h) => (
          <div key={h.id} className={cx("flex flex-wrap items-center justify-between gap-2 py-2", h.active === false && "opacity-50")}>
            <span className="grid">
              <span className="font-semibold">{n(h) || t("hh.title")} · <span className="num">−{h.percent_off}%</span></span>
              <span className="text-xs text-muted"><span className="num" dir="ltr">{h.start_time.slice(0, 5)}–{h.end_time.slice(0, 5)}</span> · {days(h)} · {scope(h)}</span>
            </span>
            <Button size="sm" disabled={!online} onClick={() => setEdit({ ...h, start_time: h.start_time.slice(0, 5), end_time: h.end_time.slice(0, 5) })}>{t("common.edit")}</Button>
          </div>
        ))}
      </div>
      {edit ? (
        <Sheet open onClose={() => setEdit(null)} title={edit.id ? t("hh.title") : t("hh.new")} footer={<>
          {edit.id ? <Button variant="danger" onClick={async () => { if (await after(supabase().from("happy_hours").delete().eq("id", edit.id!))) setEdit(null); }}>{t("common.delete")}</Button> : null}
          <Button variant="primary" disabled={!valid} onClick={async () => {
            const row = {
              name_ar: (edit.name_ar ?? "").trim(), name_en: (edit.name_en ?? "").trim(), days: [...new Set(edit.days)].sort(), start_time: edit.start_time, end_time: edit.end_time,
              percent_off: Math.min(100, Math.max(1, Number(edit.percent_off) || 0)), applies_to: edit.applies_to ?? "all", mode_id: edit.mode_id || null, active: edit.active !== false,
            };
            if (await after(edit.id ? supabase().from("happy_hours").update(row).eq("id", edit.id) : supabase().from("happy_hours").insert(row))) setEdit(null);
          }}>{t("common.save")}</Button>
        </>}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t("m.nameAr")}><Input id="hh-ar" dir="rtl" value={edit.name_ar ?? ""} onChange={(e) => setEdit({ ...edit, name_ar: e.target.value })} placeholder="ساعة الضهر" /></Field>
            <Field label={t("m.nameEn")}><Input id="hh-en" dir="ltr" value={edit.name_en ?? ""} onChange={(e) => setEdit({ ...edit, name_en: e.target.value })} placeholder="Quiet afternoons" /></Field>
            <Field label={t("hh.from")}><Input id="hh-from" type="time" dir="ltr" value={edit.start_time ?? ""} onChange={(e) => setEdit({ ...edit, start_time: e.target.value })} /></Field>
            <Field label={t("hh.to")} hint={t("hh.toHint")}><Input id="hh-to" type="time" dir="ltr" value={edit.end_time ?? ""} onChange={(e) => setEdit({ ...edit, end_time: e.target.value })} /></Field>
            <Field label={t("hh.percent")}><Input id="hh-pct" numeric value={String(edit.percent_off ?? "")} onChange={(e) => setEdit({ ...edit, percent_off: e.target.value as unknown as number })} /></Field>
            <Field label={t("hh.where")}>
              <Select id="hh-where" value={edit.applies_to ?? "all"} onChange={(e) => setEdit({ ...edit, applies_to: e.target.value as HappyHour["applies_to"] })}>
                <option value="all">{t("hh.everywhere")}</option>
                <option value="room">{t("hh.roomsOnly")}</option>
                <option value="area">{t("hh.areasOnly")}</option>
              </Select>
            </Field>
            <Field label={t("bu.mode")}>
              <Select id="hh-mode" value={edit.mode_id ?? ""} onChange={(e) => setEdit({ ...edit, mode_id: e.target.value || null })}>
                <option value="">{t("bu.anyMode")}</option>
                {snap.modes.filter((m) => m.active).map((m) => <option key={m.id} value={m.id}>{n(m)}</option>)}
              </Select>
            </Field>
          </div>
          <fieldset className="grid gap-2">
            <legend className="font-semibold mb-1">{t("hh.days")}</legend>
            <div className="flex flex-wrap gap-1.5">
              {DAYS.map((d) => {
                const on = !!edit.days?.includes(d);
                return (
                  <button key={d} type="button" aria-pressed={on} onClick={() => setEdit({ ...edit, days: on ? edit.days!.filter((x) => x !== d) : [...(edit.days ?? []), d] })} className={cx("h-10 px-3 rounded-[2px] border-2 font-semibold text-sm", on ? "bg-strong text-bg border-strong" : "bg-surface border-line")}>
                    {dayName(d)}
                  </button>
                );
              })}
            </div>
          </fieldset>
          <Toggle checked={edit.active !== false} onChange={(x) => setEdit({ ...edit, active: x })} label={t("st.active")} />
        </Sheet>
      ) : null}
    </Card>
  );
}

function ModesSettings() {
  const { t, n, money } = useI18n();
  const snap = useSnap();
  const online = useOnline();
  const after = useAfterSave();
  const [edit, setEdit] = useState<Partial<Mode> | null>(null);
  return (
    <Card className="p-4 grid gap-3">
      <SectionTitle action={<Button size="sm" variant="accent" disabled={!online} onClick={() => setEdit({ name_ar: "", name_en: "", hourly_rate: 0, sort: snap.modes.length + 1, active: true })}>{t("st.newMode")}</Button>}>{t("st.modes")}</SectionTitle>
      <div className="divide-y-2 divide-line">
        {snap.modes.map((m) => (
          <div key={m.id} className={cx("flex items-center justify-between gap-2 py-2", !m.active && "opacity-50")}>
            <span className="font-semibold">{n(m)}</span>
            <span className="flex items-center gap-2">
              <span className="num">{money(m.hourly_rate)}{t("common.perHour")}</span>
              <Button size="sm" disabled={!online} onClick={() => setEdit(m)}>{t("common.edit")}</Button>
            </span>
          </div>
        ))}
      </div>
      {edit ? (
        <Sheet open onClose={() => setEdit(null)} title={edit.id ? n(edit as Mode) : t("st.newMode")} footer={<Button variant="primary" disabled={!edit.name_ar?.trim() || !edit.name_en?.trim()} onClick={async () => {
          const row = { name_ar: edit.name_ar!.trim(), name_en: edit.name_en!.trim(), hourly_rate: Number(edit.hourly_rate) || 0, sort: Number(edit.sort) || 0, active: !!edit.active };
          if (await after(edit.id ? supabase().from("room_modes").update(row).eq("id", edit.id) : supabase().from("room_modes").insert(row))) setEdit(null);
        }}>{t("common.save")}</Button>}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t("m.nameAr")}><Input id="md-ar" dir="rtl" value={edit.name_ar ?? ""} onChange={(e) => setEdit({ ...edit, name_ar: e.target.value })} /></Field>
            <Field label={t("m.nameEn")}><Input id="md-en" dir="ltr" value={edit.name_en ?? ""} onChange={(e) => setEdit({ ...edit, name_en: e.target.value })} /></Field>
            <Field label={t("st.rate")}><Input id="md-rate" numeric value={String(edit.hourly_rate ?? "")} onChange={(e) => setEdit({ ...edit, hourly_rate: e.target.value as unknown as number })} /></Field>
            <Field label={t("m.sort")}><Input id="md-sort" numeric value={String(edit.sort ?? 0)} onChange={(e) => setEdit({ ...edit, sort: Number(e.target.value) || 0 })} /></Field>
          </div>
          <Toggle checked={!!edit.active} onChange={(x) => setEdit({ ...edit, active: x })} label={t("st.active")} />
        </Sheet>
      ) : null}
    </Card>
  );
}

/** Per-room price for each mode. Blank cells use the mode's default price. */
function RoomPrices() {
  const { t, n, money } = useI18n();
  const snap = useSnap();
  const online = useOnline();
  const toast = useToast();
  const errText = useErrorText();
  const rooms = snap.places.filter((p) => (p.kind === "room" || p.kind === "area") && p.active);
  const modes = snap.modes.filter((m) => m.active);
  const key = (r: string, m: string) => `${r}:${m}`;
  const [cells, setCells] = useState<Record<string, string>>(() =>
    Object.fromEntries((snap.mode_prices ?? []).map((x) => [key(x.place_id, x.mode_id), String(x.hourly_rate)])),
  );
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    const upserts: { place_id: string; mode_id: string; hourly_rate: number }[] = [];
    const deletes: { place_id: string; mode_id: string }[] = [];
    for (const r of rooms)
      for (const m of modes) {
        const v = (cells[key(r.id, m.id)] ?? "").trim();
        if (v === "") deletes.push({ place_id: r.id, mode_id: m.id });
        else upserts.push({ place_id: r.id, mode_id: m.id, hourly_rate: Math.max(0, Number(v) || 0) });
      }
    const sb = supabase();
    try {
      if (upserts.length) {
        const { error } = await sb.from("room_mode_prices").upsert(upserts);
        if (error) throw error;
      }
      for (const d of deletes) {
        if (!(snap.mode_prices ?? []).some((x) => x.place_id === d.place_id && x.mode_id === d.mode_id)) continue;
        const { error } = await sb.from("room_mode_prices").delete().eq("place_id", d.place_id).eq("mode_id", d.mode_id);
        if (error) throw error;
      }
      await refresh();
      toast(t("common.saved"));
    } catch (e) {
      toast(errText(errorCode(e)), "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="p-4 grid gap-3">
      <SectionTitle action={<Button variant="primary" size="sm" busy={busy} disabled={!online} onClick={save}>{t("common.save")}</Button>}>{t("st.roomPrices")}</SectionTitle>
      <p className="text-sm text-muted">{t("st.roomPricesHint")}</p>
      <div className="overflow-x-auto">
        <table className="text-sm min-w-full">
          <thead>
            <tr>
              <th className="text-start py-2 pe-3"></th>
              {modes.map((m) => <th key={m.id} className="text-start py-2 pe-3 font-semibold">{n(m)}</th>)}
            </tr>
          </thead>
          <tbody className="divide-y-2 divide-line">
            {rooms.map((r) => (
              <tr key={r.id}>
                <td className="py-2 pe-3 font-semibold whitespace-nowrap">{n(r)}</td>
                {modes.map((m) => (
                  <td key={m.id} className="py-2 pe-3">
                    <Input
                      aria-label={`${n(r)} · ${n(m)}`}
                      numeric
                      className="w-28"
                      value={cells[key(r.id, m.id)] ?? ""}
                      placeholder={money(m.hourly_rate)}
                      onChange={(e) => setCells((c) => ({ ...c, [key(r.id, m.id)]: e.target.value }))}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

/** One-off QR prints: the general menu, booking, events, Wi-Fi and InstaPay. Each prints on its own page. */
function PrintQrs() {
  const { t, lang } = useI18n();
  const snap = useSnap();
  const st = snap.settings;
  const o = typeof location === "undefined" ? "https://dotcowork.space" : location.origin;
  const items: { key: string; label: string; hint: string; card: QrCard | null }[] = [
    { key: "menu", label: t("qr.menu"), hint: "/menu", card: { value: `${o}/menu`, titleAr: "المنيو", titleEn: "Menu", ctaAr: "امسح واطلب", ctaEn: "Scan to order" } },
    { key: "book", label: t("qr.book"), hint: "/menu?tab=book", card: { value: `${o}/menu?tab=book`, titleAr: "احجز أوضة", titleEn: "Book a room", ctaAr: "امسح واحجز", ctaEn: "Scan to book" } },
    { key: "events", label: t("qr.events"), hint: "/events", card: { value: `${o}/events`, titleAr: "الإيفنتات", titleEn: "Events", ctaAr: "امسح واحجز مكانك", ctaEn: "Scan to save your seat" } },
    { key: "wifi", label: t("wifi.title"), hint: st.wifi_ssid || t("qr.setFirst"), card: st.wifi_ssid ? wifiCard(st.wifi_ssid, st.wifi_password ?? "") : null },
    { key: "instapay", label: t("pay.title"), hint: st.instapay_link || t("qr.setFirst"), card: st.instapay_link ? { value: st.instapay_link, titleAr: "ادفع بإنستاباي", titleEn: "Pay with InstaPay", ctaAr: "امسح وحوّل", ctaEn: "Scan to pay" } : null },
  ];
  return (
    <Card className="p-4 grid gap-3">
      <SectionTitle>{t("qr.title")}</SectionTitle>
      <p className="text-sm text-muted">{t("qr.hint")}</p>
      <div className="divide-y-2 divide-line">
        {items.map((x) => (
          <div key={x.key} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <span className="grid min-w-0">
              <span className="font-semibold">{x.label}</span>
              <span className="text-xs text-muted truncate" dir="ltr">{x.hint}</span>
            </span>
            <Button size="sm" disabled={!x.card} onClick={() => x.card && printQrCards([x.card], lang)}>{t("qr.print")}</Button>
          </div>
        ))}
      </div>
    </Card>
  );
}

const orderUrl = (token: string) => `${location.origin}/menu?t=${token}`;

function PlacesSettings() {
  const { t, n, lang } = useI18n();
  const snap = useSnap();
  const online = useOnline();
  const after = useAfterSave();
  const toast = useToast();
  const errText = useErrorText();
  const [edit, setEdit] = useState<Partial<Place> | null>(null);
  const [confirmRegen, setConfirmRegen] = useState<Place | null>(null);
  const places = [...snap.places].sort((a, b) => a.kind.localeCompare(b.kind) || a.sort - b.sort);

  function printQrs() {
    printQrCards(places.filter((p) => p.active && p.qr_token).map((p) => placeCard({ ...p, qr_token: p.qr_token! }, location.origin)), lang);
  }

  return (
    <Card className="p-4 grid gap-3">
      <SectionTitle action={<div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={printQrs}>{t("st.printQr")}</Button>
        <Button size="sm" variant="accent" disabled={!online} onClick={() => setEdit({ kind: "room", name_ar: "", name_en: "", sort: places.filter((p) => p.kind === "room").length + 1, active: true })}>{t("st.newRoom")}</Button>
        <Button size="sm" variant="accent" disabled={!online} onClick={() => setEdit({ kind: "table", name_ar: "", name_en: "", sort: places.filter((p) => p.kind === "table").length + 1, active: true })}>{t("st.newTable")}</Button>
        <Button size="sm" variant="accent" disabled={!online} onClick={() => { const k = places.filter((p) => p.kind === "area").length + 1; setEdit({ kind: "area", name_ar: `مساحة مشتركة ${k}`, name_en: `Shared area ${k}`, sort: k, active: true, capacity: 10 }); }}>{t("ar.new")}</Button>
      </div>}>{t("st.places")}</SectionTitle>
      <div className="divide-y-2 divide-line">
        {places.map((p) => (
          <div key={p.id} className={cx("flex flex-wrap items-center justify-between gap-2 py-2", !p.active && "opacity-50")}>
            <span className="flex items-center gap-2">
              <Pill>{p.kind === "room" ? t("common.room") : p.kind === "area" ? t("ar.one") : t("common.table")}</Pill>
              <span className="font-semibold">{n(p)}</span>
              {p.kind === "area" && p.capacity ? <span className="num text-xs text-muted">{t("ar.seats", { n: p.capacity })}</span> : null}
            </span>
            <span className="flex items-center gap-2">
              {p.qr_token ? <a className="num text-xs underline text-muted" href={orderUrl(p.qr_token)} target="_blank" rel="noreferrer">/menu?t={p.qr_token}</a> : null}
              {p.qr_token && p.active ? <Button size="sm" onClick={() => printQrCards([placeCard({ ...p, qr_token: p.qr_token! }, location.origin)], lang)}>{t("qr.print")}</Button> : null}
              <Button size="sm" disabled={!online} onClick={() => setConfirmRegen(p)}>{t("st.regenQr")}</Button>
              <Button size="sm" disabled={!online} onClick={() => setEdit(p)}>{t("common.edit")}</Button>
            </span>
          </div>
        ))}
      </div>
      {edit ? (
        <Sheet open onClose={() => setEdit(null)} title={edit.id ? n(edit as Place) : edit.kind === "room" ? t("st.newRoom") : edit.kind === "area" ? t("ar.new") : t("st.newTable")} footer={<Button variant="primary" disabled={!edit.name_ar?.trim() || !edit.name_en?.trim()} onClick={async () => {
          const row = {
            kind: edit.kind, name_ar: edit.name_ar!.trim(), name_en: edit.name_en!.trim(), sort: Number(edit.sort) || 0, active: !!edit.active,
            capacity: edit.kind === "area" ? Math.min(500, Math.max(1, Math.round(Number(edit.capacity) || 1))) : null,
          };
          if (await after(edit.id ? supabase().from("places").update(row).eq("id", edit.id) : supabase().from("places").insert(row))) setEdit(null);
        }}>{t("common.save")}</Button>}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t("m.nameAr")}><Input id="pl-ar" dir="rtl" value={edit.name_ar ?? ""} onChange={(e) => setEdit({ ...edit, name_ar: e.target.value })} /></Field>
            <Field label={t("m.nameEn")}><Input id="pl-en" dir="ltr" value={edit.name_en ?? ""} onChange={(e) => setEdit({ ...edit, name_en: e.target.value })} /></Field>
            <Field label={t("m.sort")}><Input id="pl-sort" numeric value={String(edit.sort ?? 0)} onChange={(e) => setEdit({ ...edit, sort: Number(e.target.value) || 0 })} /></Field>
            {edit.kind === "area" ? <Field label={t("ar.capacity")} hint={t("ar.capacityHint")}><Input id="pl-cap" numeric value={String(edit.capacity ?? "")} onChange={(e) => setEdit({ ...edit, capacity: e.target.value as unknown as number })} /></Field> : null}
          </div>
          <Toggle checked={!!edit.active} onChange={(x) => setEdit({ ...edit, active: x })} label={t("st.active")} />
          {edit.id ? (
            <Button variant="danger" size="sm" className="justify-self-start" onClick={async () => {
              const sb = supabase();
              if (snap.sessions.some((x) => x.place_id === edit.id && x.status === "active") || snap.bills.some((b) => b.place_id === edit.id && b.status === "open")) {
                toast(t("st.placeInUse"), "error");
                return;
              }
              await sb.from("room_mode_prices").delete().eq("place_id", edit.id!);
              const { error } = await sb.from("places").delete().eq("id", edit.id!);
              if (error && (error as { code?: string }).code === "23503") {
                // Has history (bills, sessions, bookings): hide it instead so reports stay intact.
                if (await after(sb.from("places").update({ active: false }).eq("id", edit.id!))) { toast(t("st.placeHidden")); setEdit(null); }
                return;
              }
              if (await after(Promise.resolve({ error }))) setEdit(null);
            }}>{t("common.delete")}</Button>
          ) : null}
        </Sheet>
      ) : null}
      <Sheet open={!!confirmRegen} onClose={() => setConfirmRegen(null)} title={t("st.regenQr")} footer={<Button variant="danger" onClick={async () => {
        try {
          await rpc("owner_regenerate_qr", { p_place: confirmRegen!.id });
          await refresh();
          toast(t("common.saved"));
        } catch (e) {
          toast(errText(errorCode(e)), "error");
        }
        setConfirmRegen(null);
      }}>{t("common.confirm")}</Button>}>
        <p>{t("st.regenQrConfirm")}</p>
      </Sheet>
    </Card>
  );
}
