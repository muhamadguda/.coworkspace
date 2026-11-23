"use client";

import { useCallback, useEffect, useState } from "react";
import { useErrorText, useI18n } from "@/lib/i18n";
import { errorCode, rpc, supabase } from "@/lib/supabase";
import { isValidPhone, normalizePhone } from "@/lib/phone";
import { round2 } from "@/lib/billing";
import { Button, Card, Empty, Field, Input, Pill, SectionTitle, Select, Toggle, cx, useToast } from "@/components/ui";
import { useOnline, useSnap } from "../hooks";

type Member = { customer_id: string; phone: string; name: string };
type CustomMenu = { id: string; name_ar: string; name_en: string; active: boolean; station_id: string | null; item_ids: string[]; members: Member[]; targets?: Target[] };
type Target = { id: string; kind: TargetKind; ref_id: string | null };
type TargetKind = "place" | "all_tables" | "all_rooms" | "all_areas" | "all_stations" | "station" | "event";
type EventLite = { id: string; title_ar: string; title_en: string; starts_at: string };
type Station = { id: string; name: string; active: boolean; menu_id: string | null; account_customer_id: string; debt_limit: number; outstanding: number; open_bill: number | null; members: Member[] };
type Data = { menus: CustomMenu[]; stations: Station[]; events?: EventLite[] };

/** Owner: stations (private accounts members order on) and custom menus (items only some customers see). */
export function StationsAdmin() {
  const { t } = useI18n();
  const online = useOnline();
  const toast = useToast();
  const errText = useErrorText();
  const [data, setData] = useState<Data | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await rpc<Data>("owner_stations_menus"));
    } catch (e) {
      toast(errText(errorCode(e)), "error");
    }
  }, [toast, errText]);
  useEffect(() => {
    let alive = true;
    rpc<Data>("owner_stations_menus")
      .then((d) => alive && setData(d))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      await load();
      toast(t("common.saved"));
    } catch (e) {
      toast(errText(errorCode(e)), "error");
    } finally {
      setBusy(false);
    }
  };
  const db = async (q: PromiseLike<{ error: unknown }>) => {
    const { error } = await q;
    if (error) throw error;
  };

  if (!data) return <Empty>{t("common.loading")}</Empty>;

  return (
    <div className="grid gap-6">
      {!online ? <p className="text-busy font-semibold">{t("m.onlineOnly")}</p> : null}
      <SectionTitle action={<Button size="sm" variant="accent" busy={busy} disabled={!online} onClick={() => run(() => rpc("owner_create_station", { p_name: "" }))}>{t("stn.new")}</Button>}>
        {t("stn.nav")}
      </SectionTitle>
      <p className="text-sm text-muted">{t("stn.hint")}</p>
      {data.stations.length === 0 ? <Empty>{t("common.none")}</Empty> : null}
      {data.stations.map((s) => (
        <StationCard key={s.id} s={s} menu={data.menus.find((m) => m.id === s.menu_id) ?? null} busy={busy || !online} run={run} db={db} />
      ))}

      <SectionTitle action={<Button size="sm" busy={busy} disabled={!online} onClick={() => run(() => db(supabase().from("custom_menus").insert({ name_ar: t("stn.menuDefault"), name_en: "Custom menu" })))}>{t("stn.newMenu")}</Button>}>
        {t("stn.menus")}
      </SectionTitle>
      <p className="text-sm text-muted">{t("stn.menusHint")}</p>
      {data.menus.filter((m) => !m.station_id).map((m) => (
        <MenuCard key={m.id} m={m} busy={busy || !online} run={run} db={db} withMembers targetsCtx={{ stations: data.stations, events: data.events ?? [] }} />
      ))}
    </div>
  );
}

type Run = (fn: () => Promise<unknown>) => Promise<void>;
type Db = (q: PromiseLike<{ error: unknown }>) => Promise<void>;

function StationCard({ s, menu, busy, run, db }: { s: Station; menu: CustomMenu | null; busy: boolean; run: Run; db: Db }) {
  const { t, money } = useI18n();
  const [name, setName] = useState(s.name);
  const [limit, setLimit] = useState(String(s.debt_limit));
  return (
    <Card className={cx("p-4 grid gap-3", !s.active && "opacity-60")}>
      <div className="flex flex-wrap items-end gap-3">
        <Field label={t("common.name")} className="flex-1 min-w-48">
          <Input id={`st-name-${s.id}`} value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Toggle checked={s.active} onChange={(v) => run(() => rpc("owner_update_station", { p_station: s.id, p_name: name.trim() || s.name, p_active: v }))} label={t("stn.active")} />
        <Button size="sm" disabled={busy || !name.trim() || name.trim() === s.name} onClick={() => run(() => rpc("owner_update_station", { p_station: s.id, p_name: name.trim(), p_active: s.active }))}>{t("common.save")}</Button>
      </div>
      <div className="flex flex-wrap items-end gap-3 text-sm">
        <span>{t("stn.openTab")}: <b className="num">{money(s.open_bill ?? 0)}</b></span>
        <span>{t("stn.owes")}: <b className="num">{money(s.outstanding)}</b></span>
        <Field label={t("stn.debtLimit")}>
          <Input id={`st-limit-${s.id}`} numeric className="w-28" value={limit} onChange={(e) => setLimit(e.target.value)} />
        </Field>
        <Button size="sm" disabled={busy || Number(limit) === s.debt_limit} onClick={() => run(() => rpc("owner_set_debt_limit", { p_customer: s.account_customer_id, p_limit: round2(Number(limit) || 0) }))}>{t("common.save")}</Button>
      </div>
      <Members
        title={t("stn.members")}
        members={s.members}
        busy={busy}
        onAdd={(phone, nm) => run(() => rpc("owner_add_member", { p_kind: "station", p_target: s.id, p_phone: phone, p_name: nm }))}
        onRemove={(cid) => run(() => db(supabase().from("station_members").delete().eq("station_id", s.id).eq("customer_id", cid)))}
      />
      {menu ? <MenuCard m={menu} busy={busy} run={run} db={db} /> : null}
    </Card>
  );
}

function MenuCard({ m, busy, run, db, withMembers, targetsCtx }: { m: CustomMenu; busy: boolean; run: Run; db: Db; withMembers?: boolean; targetsCtx?: { stations: Station[]; events: EventLite[] } }) {
  const { t, n, money } = useI18n();
  const snap = useSnap();
  const [ar, setAr] = useState(m.name_ar);
  const [en, setEn] = useState(m.name_en);
  const [open, setOpen] = useState(false);
  const items = snap.items.filter((i) => i.active);
  const cats = [...snap.categories].sort((a, b) => a.sort - b.sort);
  const toggle = (itemId: string, on: boolean) =>
    run(() => db(on ? supabase().from("custom_menu_items").insert({ menu_id: m.id, menu_item_id: itemId }) : supabase().from("custom_menu_items").delete().eq("menu_id", m.id).eq("menu_item_id", itemId)));
  return (
    <div className="grid gap-3 border-2 border-line rounded-[2px] p-3">
      <div className="flex flex-wrap items-end gap-3">
        <Field label={t("m.nameAr")}><Input id={`cm-ar-${m.id}`} dir="rtl" value={ar} maxLength={80} onChange={(e) => setAr(e.target.value)} /></Field>
        <Field label={t("m.nameEn")}><Input id={`cm-en-${m.id}`} dir="ltr" value={en} maxLength={80} onChange={(e) => setEn(e.target.value)} /></Field>
        <Toggle checked={m.active} onChange={(v) => run(() => db(supabase().from("custom_menus").update({ active: v }).eq("id", m.id)))} label={t("stn.active")} />
        <Button size="sm" disabled={busy || !ar.trim() || !en.trim() || (ar === m.name_ar && en === m.name_en)} onClick={() => run(() => db(supabase().from("custom_menus").update({ name_ar: ar.trim(), name_en: en.trim() }).eq("id", m.id)))}>{t("common.save")}</Button>
      </div>
      <button type="button" className="text-sm font-semibold underline justify-self-start" onClick={() => setOpen((x) => !x)}>
        {t("stn.items", { n: m.item_ids.length })}
      </button>
      {open ? (
        <div className="grid gap-2">
          {cats.map((c) => {
            const list = items.filter((i) => i.category_id === c.id);
            if (!list.length) return null;
            return (
              <div key={c.id} className="grid gap-1">
                <span className="font-semibold text-sm">{n(c)}</span>
                {list.map((i) => (
                  <label key={i.id} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" className="size-5 accent-[var(--strong)]" disabled={busy} checked={m.item_ids.includes(i.id)} onChange={(e) => toggle(i.id, e.target.checked)} />
                    <span className="flex-1">{n(i)}</span>
                    {i.public === false ? <Pill tone="accent">{t("stn.privatePill")}</Pill> : null}
                    <span className="num text-muted">{money(i.price)}</span>
                  </label>
                ))}
              </div>
            );
          })}
        </div>
      ) : null}
      {targetsCtx ? <Targets m={m} busy={busy} run={run} db={db} ctx={targetsCtx} /> : null}
      {withMembers ? (
        <Members
          title={t("stn.menuMembers")}
          members={m.members}
          busy={busy}
          onAdd={(phone, nm) => run(() => rpc("owner_add_member", { p_kind: "menu", p_target: m.id, p_phone: phone, p_name: nm }))}
          onRemove={(cid) => run(() => db(supabase().from("custom_menu_members").delete().eq("menu_id", m.id).eq("customer_id", cid)))}
        />
      ) : null}
    </div>
  );
}

function Members({ title, members, busy, onAdd, onRemove }: { title: string; members: Member[]; busy: boolean; onAdd: (phone: string, name: string) => Promise<void>; onRemove: (id: string) => void }) {
  const { t } = useI18n();
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  return (
    <div className="grid gap-2">
      <span className="font-semibold">{title}</span>
      {members.length === 0 ? <span className="text-sm text-muted">{t("common.none")}</span> : null}
      <ul className="grid gap-1">
        {members.map((x) => (
          <li key={x.customer_id} className="flex items-center justify-between gap-2 text-sm">
            <span><span className="num">{x.phone}</span>{x.name ? ` · ${x.name}` : ""}</span>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => onRemove(x.customer_id)}>{t("common.delete")}</Button>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-end gap-2">
        <Field label={t("common.phone")}><Input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="01xxxxxxxxx" /></Field>
        <Field label={t("common.nameOptional")}><Input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} /></Field>
        <Button
          size="sm"
          variant="accent"
          disabled={busy || !isValidPhone(phone)}
          onClick={async () => {
            await onAdd(normalizePhone(phone), name.trim());
            setPhone("");
            setName("");
          }}
        >
          {t("common.add")}
        </Button>
      </div>
    </div>
  );
}

/** Where a menu applies: places (by QR), all stations or one, an event. All matching menus show together. */
function Targets({ m, busy, run, db, ctx }: { m: CustomMenu; busy: boolean; run: Run; db: Db; ctx: { stations: Station[]; events: EventLite[] } }) {
  const { t, n, lang } = useI18n();
  const snap = useSnap();
  const [pick, setPick] = useState("");
  const places = snap.places.filter((p) => p.active);
  const options: { value: string; label: string }[] = [
    { value: "all_tables:", label: t("stn.tAllTables") },
    { value: "all_rooms:", label: t("stn.tAllRooms") },
    { value: "all_areas:", label: t("stn.tAllAreas") },
    { value: "all_stations:", label: t("stn.tAllStations") },
    ...places.map((p) => ({ value: `place:${p.id}`, label: n(p) })),
    ...ctx.stations.map((s) => ({ value: `station:${s.id}`, label: s.name })),
    ...ctx.events.map((e) => ({ value: `event:${e.id}`, label: `${lang === "ar" ? e.title_ar : e.title_en} · ${new Date(e.starts_at).toLocaleDateString()}` })),
  ];
  const label = (x: Target) => options.find((o) => o.value === `${x.kind}:${x.ref_id ?? ""}`)?.label ?? t("common.none");
  const targets = m.targets ?? [];
  const taken = new Set(targets.map((x) => `${x.kind}:${x.ref_id ?? ""}`));
  return (
    <div className="grid gap-2">
      <span className="font-semibold">{t("stn.appliesTo")}</span>
      <p className="text-xs text-muted">{t("stn.appliesHint")}</p>
      {targets.length === 0 ? <span className="text-sm text-muted">{t("common.none")}</span> : null}
      <ul className="grid gap-1">
        {targets.map((x) => (
          <li key={x.id} className="flex items-center justify-between gap-2 text-sm">
            <span>{label(x)}</span>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => run(() => db(supabase().from("custom_menu_targets").delete().eq("id", x.id)))}>{t("common.delete")}</Button>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-end gap-2">
        <Select aria-label={t("stn.appliesTo")} value={pick} onChange={(e) => setPick(e.target.value)}>
          <option value="">…</option>
          {options.filter((o) => !taken.has(o.value)).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </Select>
        <Button
          size="sm"
          variant="accent"
          disabled={busy || !pick}
          onClick={async () => {
            const [kind, ref] = pick.split(":");
            await run(() => db(supabase().from("custom_menu_targets").insert({ menu_id: m.id, kind, ref_id: ref || null })));
            setPick("");
          }}
        >
          {t("common.add")}
        </Button>
      </div>
    </div>
  );
}
