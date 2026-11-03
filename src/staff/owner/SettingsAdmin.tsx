"use client";

import { useState } from "react";
import QRCode from "qrcode";
import { useErrorText, useI18n } from "@/lib/i18n";
import { errorCode, rpc, supabase } from "@/lib/supabase";
import { printHtml } from "@/lib/print";
import type { Mode, Place, Settings } from "@/lib/types";
import { Button, Card, Field, Input, Pill, SectionTitle, Sheet, Toggle, cx, useToast } from "@/components/ui";
import { refresh } from "../store";
import { useOnline, useSnap } from "../hooks";

export function SettingsAdmin() {
  const { t } = useI18n();
  const online = useOnline();
  return (
    <div className="grid gap-6">
      {!online ? <p className="text-busy font-semibold">{t("m.onlineOnly")}</p> : null}
      <GeneralSettingsKeyed />
      <ModesSettings />
      <RoomPrices />
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
      staff_discount_max_percent: Number(v.staff_discount_max_percent) || 0, staff_discount_max_amount: Number(v.staff_discount_max_amount) || 0, updated_at: new Date().toISOString(),
    };
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
  const rooms = snap.places.filter((p) => p.kind === "room" && p.active);
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

const orderUrl = (token: string) => `${location.origin}/?t=${token}`;

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

  async function printQrs() {
    const cards = await Promise.all(
      places.filter((p) => p.active && p.qr_token).map(async (p) => {
        const svg = await QRCode.toString(orderUrl(p.qr_token!), { type: "svg", margin: 1, errorCorrectionLevel: "M", color: { dark: "#173a39", light: "#ffffff" } });
        return `<div class="card"><div class="name">${p.name_ar} · ${p.name_en}</div><div class="qr">${svg}</div><div class="cta">${t("st.scanToOrder")} · Scan to order</div><div class="brand">dot</div></div>`;
      }),
    );
    printHtml(`<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><title>QR</title><style>
      @page { size: A4; margin: 10mm; } body { margin: 0; font-family: "IBM Plex Sans Arabic", "Segoe UI", Tahoma, sans-serif; color: #173a39; }
      .grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8mm; }
      .card { border: 2px solid #173a39; border-top: 8px solid #d9a21b; padding: 6mm; text-align: center; break-inside: avoid; }
      .name { font-size: 20px; font-weight: 700; } .qr svg { width: 60mm; height: 60mm; } .cta { font-size: 14px; font-weight: 600; } .brand { font-size: 12px; margin-top: 2mm; letter-spacing: .2em; }
    </style></head><body><div class="grid">${cards.join("")}</div></body></html>`);
  }

  return (
    <Card className="p-4 grid gap-3">
      <SectionTitle action={<div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={printQrs}>{t("st.printQr")}</Button>
        <Button size="sm" variant="accent" disabled={!online} onClick={() => setEdit({ kind: "room", name_ar: "", name_en: "", sort: places.filter((p) => p.kind === "room").length + 1, active: true })}>{t("st.newRoom")}</Button>
        <Button size="sm" variant="accent" disabled={!online} onClick={() => setEdit({ kind: "table", name_ar: "", name_en: "", sort: places.filter((p) => p.kind === "table").length + 1, active: true })}>{t("st.newTable")}</Button>
      </div>}>{t("st.places")}</SectionTitle>
      <div className="divide-y-2 divide-line">
        {places.map((p) => (
          <div key={p.id} className={cx("flex flex-wrap items-center justify-between gap-2 py-2", !p.active && "opacity-50")}>
            <span className="flex items-center gap-2">
              <Pill>{p.kind === "room" ? t("common.room") : t("common.table")}</Pill>
              <span className="font-semibold">{n(p)}</span>
            </span>
            <span className="flex items-center gap-2">
              {p.qr_token ? <a className="num text-xs underline text-muted" href={orderUrl(p.qr_token)} target="_blank" rel="noreferrer">/?t={p.qr_token}</a> : null}
              <Button size="sm" disabled={!online} onClick={() => setConfirmRegen(p)}>{t("st.regenQr")}</Button>
              <Button size="sm" disabled={!online} onClick={() => setEdit(p)}>{t("common.edit")}</Button>
            </span>
          </div>
        ))}
      </div>
      {edit ? (
        <Sheet open onClose={() => setEdit(null)} title={edit.id ? n(edit as Place) : edit.kind === "room" ? t("st.newRoom") : t("st.newTable")} footer={<Button variant="primary" disabled={!edit.name_ar?.trim() || !edit.name_en?.trim()} onClick={async () => {
          const row = { kind: edit.kind, name_ar: edit.name_ar!.trim(), name_en: edit.name_en!.trim(), sort: Number(edit.sort) || 0, active: !!edit.active };
          if (await after(edit.id ? supabase().from("places").update(row).eq("id", edit.id) : supabase().from("places").insert(row))) setEdit(null);
        }}>{t("common.save")}</Button>}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t("m.nameAr")}><Input id="pl-ar" dir="rtl" value={edit.name_ar ?? ""} onChange={(e) => setEdit({ ...edit, name_ar: e.target.value })} /></Field>
            <Field label={t("m.nameEn")}><Input id="pl-en" dir="ltr" value={edit.name_en ?? ""} onChange={(e) => setEdit({ ...edit, name_en: e.target.value })} /></Field>
            <Field label={t("m.sort")}><Input id="pl-sort" numeric value={String(edit.sort ?? 0)} onChange={(e) => setEdit({ ...edit, sort: Number(e.target.value) || 0 })} /></Field>
          </div>
          <Toggle checked={!!edit.active} onChange={(x) => setEdit({ ...edit, active: x })} label={t("st.active")} />
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
