"use client";

import { useMemo, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { round2 } from "@/lib/billing";
import type { MenuItem } from "@/lib/types";
import { Button, Input, Pill, Sheet, cx, useToast } from "@/components/ui";
import { dispatch, uuid } from "../store";
import { useSnap } from "../hooks";
import type { ItemInput } from "../reducer";

type Line = ItemInput & { key: string };

/** Staff adds items straight onto an open bill (accepted immediately). */
export function OrderPad({ billId, title, open, onClose }: { billId: string; title: string; open: boolean; onClose: () => void }) {
  const { t, n, money, lang } = useI18n();
  const toast = useToast();
  const snap = useSnap();
  const cats = snap.categories.filter((c) => c.active);
  const [cat, setCat] = useState<string>(cats[0]?.id ?? "");
  const [lines, setLines] = useState<Line[]>([]);
  const [picking, setPicking] = useState<MenuItem | null>(null);
  const [sel, setSel] = useState<Record<string, string>>({});
  const items = useMemo(() => snap.items.filter((i) => i.active && i.category_id === cat), [snap.items, cat]);
  const total = round2(lines.reduce((a, l) => a + l.qty * (snap.items.find((i) => i.id === l.menu_item_id)?.price ?? 0), 0));

  function addLine(item: MenuItem, options: { group_id: string; choice_id: string }[]) {
    const key = `${item.id}|${options.map((o) => o.choice_id).join(",")}`;
    setLines((ls) => (ls.some((l) => l.key === key) ? ls.map((l) => (l.key === key ? { ...l, qty: l.qty + 1 } : l)) : [...ls, { key, menu_item_id: item.id, qty: 1, options, note: "" }]));
  }

  function tap(item: MenuItem) {
    if (item.options.length) {
      setSel(Object.fromEntries(item.options.map((g) => [g.id, g.choices[0]?.id ?? ""])));
      setPicking(item);
    } else addLine(item, []);
  }

  function submit() {
    dispatch("staff_order", { order_id: uuid(), bill_id: billId, items: lines.map(({ key: _k, ...l }) => l) });
    toast(t("o.staffOrderAdded"));
    setLines([]);
    onClose();
  }

  const label = (l: Line) => {
    const m = snap.items.find((i) => i.id === l.menu_item_id);
    const opts = l.options.map((o) => {
      const g = m?.options.find((x) => x.id === o.group_id);
      const c = g?.choices.find((x) => x.id === o.choice_id);
      return c ? n(c) : "";
    });
    return [n(m), ...opts].filter(Boolean).join(" · ");
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      wide
      title={`${t("o.addItems")} · ${title}`}
      footer={
        <Button variant="accent" size="lg" disabled={!lines.length} onClick={submit}>
          {t("o.addToBill")} · <span className="num">{money(total)}</span>
        </Button>
      }
    >
      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {cats.map((c) => (
          <button key={c.id} type="button" onClick={() => setCat(c.id)} className={cx("h-10 px-3 shrink-0 rounded-[2px] border-2 font-semibold text-sm", cat === c.id ? "bg-strong text-bg border-strong" : "bg-surface border-line")}>
            {n(c)}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {items.map((it) => (
          <button key={it.id} type="button" onClick={() => tap(it)} className={cx("text-start rounded-[2px] border-2 p-3 grid gap-1 min-h-20", it.available ? "bg-surface border-line hover:border-strong" : "bg-surface-2 border-line opacity-60")}>
            <span className="font-semibold leading-tight">{n(it)}</span>
            <span className="flex items-center justify-between gap-1">
              <span className="num text-sm">{money(it.price)}</span>
              {!it.available ? <Pill tone="busy">{t("c.soldOut")}</Pill> : null}
            </span>
          </button>
        ))}
      </div>
      {lines.length ? (
        <ul className="grid gap-1.5 border-t-2 border-line pt-3">
          {lines.map((l) => (
            <li key={l.key} className="flex items-center gap-2">
              <span className="flex-1 min-w-0 text-sm font-medium">{label(l)}</span>
              <Input aria-label={t("common.note")} placeholder={t("common.note")} value={l.note} onChange={(e) => setLines((ls) => ls.map((x) => (x.key === l.key ? { ...x, note: e.target.value } : x)))} className="h-9 w-32 text-sm" dir={lang === "ar" ? "rtl" : "ltr"} />
              <div className="flex items-center gap-1" dir="ltr">
                <Button size="sm" onClick={() => setLines((ls) => ls.flatMap((x) => (x.key === l.key ? (x.qty > 1 ? [{ ...x, qty: x.qty - 1 }] : []) : [x])))}>−</Button>
                <span className="num w-6 text-center font-bold">{l.qty}</span>
                <Button size="sm" onClick={() => setLines((ls) => ls.map((x) => (x.key === l.key ? { ...x, qty: Math.min(50, x.qty + 1) } : x)))}>+</Button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      <Sheet
        open={!!picking}
        onClose={() => setPicking(null)}
        title={picking ? n(picking) : ""}
        footer={
          <Button variant="accent" onClick={() => { if (picking) addLine(picking, picking.options.map((g) => ({ group_id: g.id, choice_id: sel[g.id] }))); setPicking(null); }}>
            {t("common.add")}
          </Button>
        }
      >
        {picking?.options.map((g) => (
          <fieldset key={g.id} className="grid gap-2">
            <legend className="font-semibold mb-1">{n(g)}</legend>
            <div className="flex flex-wrap gap-2">
              {g.choices.map((c) => (
                <button key={c.id} type="button" onClick={() => setSel((s) => ({ ...s, [g.id]: c.id }))} className={cx("h-11 px-4 rounded-[2px] border-2 font-semibold", sel[g.id] === c.id ? "bg-strong text-bg border-strong" : "bg-surface border-line")}>
                  {n(c)}
                </button>
              ))}
            </div>
          </fieldset>
        ))}
      </Sheet>
    </Sheet>
  );
}
