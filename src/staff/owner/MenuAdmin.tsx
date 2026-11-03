"use client";

import { useState } from "react";
import { useErrorText, useI18n } from "@/lib/i18n";
import { errorCode, supabase } from "@/lib/supabase";
import type { Category, MenuItem, OptionGroup } from "@/lib/types";
import { Button, Card, Empty, Field, Input, Pill, SectionTitle, Select, Sheet, Textarea, Toggle, cx, useToast } from "@/components/ui";
import { dispatch, refresh, uuid } from "../store";
import { useOnline, useSnap } from "../hooks";
import { StockSheet } from "../components/StockSheet";

const slug = () => Math.random().toString(36).slice(2, 8);

export function MenuAdmin() {
  const { t, n, money } = useI18n();
  const snap = useSnap();
  const online = useOnline();
  const [editCat, setEditCat] = useState<Partial<Category> | null>(null);
  const [editItem, setEditItem] = useState<Partial<MenuItem> | null>(null);
  const cats = [...snap.categories].sort((a, b) => a.sort - b.sort);

  return (
    <div className="grid gap-5">
      {!online ? <p className="text-busy font-semibold">{t("m.onlineOnly")}</p> : null}
      <SectionTitle action={<div className="flex gap-2"><Button size="sm" onClick={() => setEditCat({ name_ar: "", name_en: "", sort: cats.length + 1, active: true })}>{t("m.newCategory")}</Button><Button size="sm" variant="accent" disabled={!cats.length} onClick={() => setEditItem({ category_id: cats[0]?.id, name_ar: "", name_en: "", desc_ar: "", desc_en: "", price: 0, options: [], available: true, active: true, sort: 0, image_url: null })}>{t("m.newItem")}</Button></div>}>
        {t("s.nav.menu")}
      </SectionTitle>
      {cats.length === 0 ? <Empty>{t("common.none")}</Empty> : null}
      {cats.map((c) => {
        const items = snap.items.filter((i) => i.category_id === c.id).sort((a, b) => a.sort - b.sort);
        return (
          <section key={c.id} className="grid gap-2">
            <div className="flex items-center justify-between gap-2">
              <h3 className={cx("font-display text-xl font-bold", !c.active && "opacity-50")}>{n(c)} {!c.active ? <Pill>{t("tm.disabled")}</Pill> : null}</h3>
              <Button size="sm" variant="ghost" onClick={() => setEditCat(c)}>{t("common.edit")}</Button>
            </div>
            <Card className="divide-y-2 divide-line">
              {items.map((i) => (
                <div key={i.id} className={cx("flex flex-wrap items-center gap-3 px-3 py-2", !i.active && "opacity-50")}>
                  {i.image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={i.image_url} alt="" className="size-10 object-cover rounded-[2px]" />
                  ) : <span aria-hidden className="size-10 rounded-[2px] tile-pattern" />}
                  <span className="flex-1 min-w-0 grid">
                    <span className="font-semibold truncate">{i.name_ar} · {i.name_en}</span>
                    <span className="num text-sm text-muted">{money(i.price)}{i.options.length ? ` · ${i.options.map((g) => n(g)).join(", ")}` : ""}</span>
                  </span>
                  <Toggle checked={!i.available} onChange={(v) => dispatch("set_item_available", { menu_item_id: i.id, available: !v })} label={t("m.soldOutToggle")} />
                  <Button size="sm" onClick={() => setEditItem(i)}>{t("common.edit")}</Button>
                </div>
              ))}
              {!items.length ? <div className="px-3 py-3 text-sm text-muted">{t("common.none")}</div> : null}
            </Card>
          </section>
        );
      })}
      {editCat ? <CategorySheet cat={editCat} onClose={() => setEditCat(null)} /> : null}
      {editItem ? <ItemSheet item={editItem} onClose={() => setEditItem(null)} /> : null}
    </div>
  );
}

function useSave() {
  const toast = useToast();
  const errText = useErrorText();
  const { t } = useI18n();
  return async (fn: () => PromiseLike<{ error: unknown }>) => {
    const { error } = await fn();
    if (error) {
      toast(errText(errorCode(error)), "error");
      return false;
    }
    await refresh();
    toast(t("common.saved"));
    return true;
  };
}

function CategorySheet({ cat, onClose }: { cat: Partial<Category>; onClose: () => void }) {
  const { t } = useI18n();
  const online = useOnline();
  const save = useSave();
  const [v, setV] = useState(cat);
  const [busy, setBusy] = useState(false);
  async function submit() {
    setBusy(true);
    const row = { name_ar: v.name_ar!.trim(), name_en: v.name_en!.trim(), sort: Number(v.sort) || 0, active: !!v.active };
    const ok = await save(() => (cat.id ? supabase().from("menu_categories").update(row).eq("id", cat.id) : supabase().from("menu_categories").insert(row)));
    setBusy(false);
    if (ok) onClose();
  }
  return (
    <Sheet open onClose={onClose} title={cat.id ? t("common.edit") : t("m.newCategory")} footer={<Button variant="primary" busy={busy} disabled={!online || !v.name_ar?.trim() || !v.name_en?.trim()} onClick={submit}>{t("common.save")}</Button>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("m.nameAr")}><Input id="cat-ar" dir="rtl" value={v.name_ar ?? ""} onChange={(e) => setV({ ...v, name_ar: e.target.value })} /></Field>
        <Field label={t("m.nameEn")}><Input id="cat-en" dir="ltr" value={v.name_en ?? ""} onChange={(e) => setV({ ...v, name_en: e.target.value })} /></Field>
        <Field label={t("m.sort")}><Input id="cat-sort" numeric value={String(v.sort ?? 0)} onChange={(e) => setV({ ...v, sort: Number(e.target.value) || 0 })} /></Field>
      </div>
      <Toggle checked={!!v.active} onChange={(x) => setV({ ...v, active: x })} label={t("m.visible")} />
    </Sheet>
  );
}

function ItemSheet({ item, onClose }: { item: Partial<MenuItem>; onClose: () => void }) {
  const { t, n } = useI18n();
  const snap = useSnap();
  const online = useOnline();
  const toast = useToast();
  const errText = useErrorText();
  const save = useSave();
  const [v, setV] = useState<Partial<MenuItem>>({ ...item, options: structuredClone(item.options ?? []) });
  const [busy, setBusy] = useState(false);
  const [stocking, setStocking] = useState(false);
  const [uploading, setUploading] = useState(false);
  const opts = v.options ?? [];
  const setOpts = (o: OptionGroup[]) => setV({ ...v, options: o });

  async function upload(file: File) {
    setUploading(true);
    const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
    const path = `items/${uuid()}.${ext}`;
    const { error } = await supabase().storage.from("menu").upload(path, file, { contentType: file.type, upsert: false });
    setUploading(false);
    if (error) return toast(errText(errorCode(error)), "error");
    const { data } = supabase().storage.from("menu").getPublicUrl(path);
    setV((x) => ({ ...x, image_url: data.publicUrl }));
  }

  async function submit() {
    setBusy(true);
    const clean = opts
      .map((g) => ({ ...g, name_ar: g.name_ar.trim(), name_en: g.name_en.trim(), choices: g.choices.filter((c) => c.name_ar.trim() || c.name_en.trim()) }))
      .filter((g) => (g.name_ar || g.name_en) && g.choices.length);
    const row = {
      category_id: v.category_id, name_ar: v.name_ar!.trim(), name_en: v.name_en!.trim(), desc_ar: (v.desc_ar ?? "").trim(), desc_en: (v.desc_en ?? "").trim(),
      price: Number(v.price) || 0, options: clean, available: !!v.available, active: !!v.active, sort: Number(v.sort) || 0, image_url: v.image_url ?? null,
      track_stock: !!v.track_stock, low_stock_at: Math.max(0, Number(v.low_stock_at) || 0),
    };
    const ok = await save(() => (item.id ? supabase().from("menu_items").update(row).eq("id", item.id) : supabase().from("menu_items").insert(row)));
    setBusy(false);
    if (ok) onClose();
  }

  return (
    <Sheet open onClose={onClose} wide title={item.id ? n(item as MenuItem) : t("m.newItem")} footer={<Button variant="primary" busy={busy} disabled={!online || !v.name_ar?.trim() || !v.name_en?.trim() || !v.category_id} onClick={submit}>{t("common.save")}</Button>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("m.nameAr")}><Input id="it-ar" dir="rtl" value={v.name_ar ?? ""} onChange={(e) => setV({ ...v, name_ar: e.target.value })} /></Field>
        <Field label={t("m.nameEn")}><Input id="it-en" dir="ltr" value={v.name_en ?? ""} onChange={(e) => setV({ ...v, name_en: e.target.value })} /></Field>
        <Field label={t("m.descAr")}><Textarea id="it-dar" dir="rtl" rows={2} value={v.desc_ar ?? ""} onChange={(e) => setV({ ...v, desc_ar: e.target.value })} /></Field>
        <Field label={t("m.descEn")}><Textarea id="it-den" dir="ltr" rows={2} value={v.desc_en ?? ""} onChange={(e) => setV({ ...v, desc_en: e.target.value })} /></Field>
        <Field label={t("common.price")}><Input id="it-price" numeric value={String(v.price ?? "")} onChange={(e) => setV({ ...v, price: e.target.value as unknown as number })} /></Field>
        <Field label={t("m.category")}>
          <Select id="it-cat" value={v.category_id} onChange={(e) => setV({ ...v, category_id: e.target.value })}>
            {snap.categories.map((c) => <option key={c.id} value={c.id}>{n(c)}</option>)}
          </Select>
        </Field>
        <Field label={t("m.sort")}><Input id="it-sort" numeric value={String(v.sort ?? 0)} onChange={(e) => setV({ ...v, sort: Number(e.target.value) || 0 })} /></Field>
      </div>
      <div className="flex flex-wrap gap-4">
        <Toggle checked={!!v.available} onChange={(x) => setV({ ...v, available: x })} label={t("m.available")} />
        <Toggle checked={!!v.active} onChange={(x) => setV({ ...v, active: x })} label={t("m.visible")} />
      </div>

      <div className="grid gap-2 border-2 border-line rounded-[2px] p-3">
        <Toggle checked={!!v.track_stock} onChange={(x) => setV({ ...v, track_stock: x })} label={t("sk.track")} />
        {v.track_stock ? (
          <>
            <p className="text-xs text-muted">{t("sk.hint")}</p>
            <div className="flex flex-wrap items-end gap-3">
              <Field label={t("sk.lowAt")}><Input id="it-low" numeric className="w-28" value={String(v.low_stock_at ?? 0)} onChange={(e) => setV({ ...v, low_stock_at: e.target.value as unknown as number })} /></Field>
              {item.id && item.track_stock ? (
                <Button size="sm" onClick={() => setStocking(true)}>{t("sk.qty")}: <span className="num">{snap.items.find((x) => x.id === item.id)?.stock_qty ?? 0}</span></Button>
              ) : null}
            </div>
          </>
        ) : null}
      </div>
      {stocking && item.id ? <StockSheet item={item as MenuItem} onClose={() => setStocking(false)} /> : null}

      <div className="grid gap-2">
        <span className="font-semibold">{t("m.photo")}</span>
        <div className="flex items-center gap-3">
          {v.image_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={v.image_url} alt="" className="size-20 object-cover rounded-[2px] border-2 border-line" />
          ) : <span aria-hidden className="size-20 rounded-[2px] tile-pattern" />}
          <label className={cx("h-10 px-3 inline-flex items-center rounded-[2px] border-2 border-strong font-semibold text-sm cursor-pointer", (!online || uploading) && "opacity-50 pointer-events-none")}>
            {uploading ? t("common.loading") : t("m.uploadPhoto")}
            <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
          </label>
          {v.image_url ? <Button size="sm" variant="ghost" onClick={() => setV({ ...v, image_url: null })}>{t("m.removePhoto")}</Button> : null}
        </div>
      </div>

      <div className="grid gap-3">
        <div className="flex items-center justify-between">
          <span className="font-semibold">{t("m.options")}</span>
          <Button size="sm" onClick={() => setOpts([...opts, { id: slug(), name_ar: "", name_en: "", choices: [{ id: slug(), name_ar: "", name_en: "" }] }])}>{t("m.addGroup")}</Button>
        </div>
        {opts.map((g, gi) => (
          <Card key={g.id} className="p-3 grid gap-2">
            <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
              <Input aria-label={t("m.groupName")} placeholder={`${t("m.groupName")} (ع)`} dir="rtl" value={g.name_ar} onChange={(e) => setOpts(opts.map((x, i) => (i === gi ? { ...x, name_ar: e.target.value } : x)))} />
              <Input aria-label={t("m.groupName")} placeholder={`${t("m.groupName")} (EN)`} dir="ltr" value={g.name_en} onChange={(e) => setOpts(opts.map((x, i) => (i === gi ? { ...x, name_en: e.target.value } : x)))} />
              <Button size="sm" variant="ghost" onClick={() => setOpts(opts.filter((_, i) => i !== gi))}>{t("common.delete")}</Button>
            </div>
            {g.choices.map((c, ci) => (
              <div key={c.id} className="grid gap-2 grid-cols-[1fr_1fr_auto] ps-4">
                <Input aria-label={t("m.choiceName")} placeholder={`${t("m.choiceName")} (ع)`} dir="rtl" value={c.name_ar} onChange={(e) => setOpts(opts.map((x, i) => (i === gi ? { ...x, choices: x.choices.map((y, j) => (j === ci ? { ...y, name_ar: e.target.value } : y)) } : x)))} />
                <Input aria-label={t("m.choiceName")} placeholder={`${t("m.choiceName")} (EN)`} dir="ltr" value={c.name_en} onChange={(e) => setOpts(opts.map((x, i) => (i === gi ? { ...x, choices: x.choices.map((y, j) => (j === ci ? { ...y, name_en: e.target.value } : y)) } : x)))} />
                <Button size="sm" variant="ghost" aria-label={t("common.delete")} onClick={() => setOpts(opts.map((x, i) => (i === gi ? { ...x, choices: x.choices.filter((_, j) => j !== ci) } : x)))}>×</Button>
              </div>
            ))}
            <Button size="sm" variant="ghost" className="justify-self-start" onClick={() => setOpts(opts.map((x, i) => (i === gi ? { ...x, choices: [...x.choices, { id: slug(), name_ar: "", name_en: "" }] } : x)))}>{t("m.addChoice")}</Button>
          </Card>
        ))}
      </div>
    </Sheet>
  );
}
