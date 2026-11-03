"use client";

import { useState } from "react";
import { useI18n } from "@/lib/i18n";
import { westernDigits } from "@/lib/phone";
import type { DictKey } from "@/lib/dict";
import type { MenuItem } from "@/lib/types";
import { Button, Field, Input, Pill, Segmented, Sheet, useToast } from "@/components/ui";
import { dispatch } from "../store";
import { useSnap } from "../hooks";
import { isLowStock } from "../derive";

type Reason = "restock" | "count" | "waste";

/** Restock, count or write off a tracked item. Works offline (queued like any counter change). */
export function StockSheet({ item, onClose }: { item: MenuItem; onClose: () => void }) {
  const { t, n, time } = useI18n();
  const snap = useSnap();
  const toast = useToast();
  const live = snap.items.find((x) => x.id === item.id) ?? item;
  const [reason, setReason] = useState<Reason>("restock");
  const [qty, setQty] = useState("");
  const [note, setNote] = useState("");
  const q = Number(westernDigits(qty));
  const moves = (snap.stock_moves ?? []).filter((m) => m.menu_item_id === item.id).slice(0, 8);

  function save() {
    dispatch("stock_adjust", { menu_item_id: item.id, reason, qty: q, note: note.trim() });
    toast(t("common.saved"));
    onClose();
  }

  return (
    <Sheet open onClose={onClose} title={`${t("sk.adjust")} · ${n(live)}`} footer={<Button variant="primary" disabled={!(q > 0 || (reason === "count" && qty !== "" && q >= 0))} onClick={save}>{t("common.save")}</Button>}>
      <div className="flex items-center gap-2">
        <span className="text-sm">{t("sk.qty")}:</span>
        <span className="num text-2xl font-bold">{live.stock_qty ?? 0}</span>
        {(live.stock_qty ?? 0) <= 0 ? <Pill tone="busy">{t("sk.out")}</Pill> : isLowStock(live) ? <Pill tone="warn">{t("sk.low")}</Pill> : null}
      </div>
      <Segmented value={reason} onChange={setReason} options={[{ value: "restock", label: t("sk.restock") }, { value: "count", label: t("sk.count") }, { value: "waste", label: t("sk.waste") }]} />
      <Field label={reason === "count" ? t("sk.countLabel") : t("sk.qtyLabel")}>
        <Input id="sk-qty" numeric inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} autoFocus />
      </Field>
      <Field label={t("d.reason")}>
        <Input id="sk-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} />
      </Field>
      {moves.length ? (
        <div className="grid gap-1 text-sm">
          <span className="font-semibold">{t("sk.moves")}</span>
          {moves.map((m) => (
            <div key={m.id} className="flex justify-between gap-2">
              <span>{t(`sk.reason.${m.reason}` as DictKey)}{m.note ? ` · ${m.note}` : ""} <span className="text-muted">{time(m.at)}</span></span>
              <span className="num">{m.delta > 0 ? "+" : ""}{m.delta} → {m.qty_after}</span>
            </div>
          ))}
        </div>
      ) : null}
    </Sheet>
  );
}
