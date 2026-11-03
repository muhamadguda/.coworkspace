"use client";

import { useMemo, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { isValidPhone, normalizePhone } from "@/lib/phone";
import type { Customer } from "@/lib/types";
import { Button, Field, Input, Pill } from "@/components/ui";
import { openBillOfCustomer, placeById, searchCustomers } from "../derive";
import { dispatch, uuid } from "../store";
import { useSnap } from "../hooks";

/** Find a customer by phone/name/code, or add a new one by phone. Calls onPick with the customer id. */
export function CustomerPicker({ onPick, label, exclude = [] }: { onPick: (customerId: string) => void; label?: string; exclude?: string[] }) {
  const { t, n, money } = useI18n();
  const snap = useSnap();
  const [q, setQ] = useState("");
  const [name, setName] = useState("");
  const results = useMemo(() => searchCustomers(snap, q).filter((c) => !exclude.includes(c.id)), [snap, q, exclude]);
  const phone = normalizePhone(q);
  const exact = snap.customers.find((c) => c.phone === phone);
  const canCreate = isValidPhone(q) && !exact && /^[\d\s+()-]+$/.test(q.trim());

  function create() {
    const id = uuid();
    dispatch("ensure_customer", { id, phone, name: name.trim() });
    onPick(id);
    setQ("");
    setName("");
  }

  return (
    <div className="grid gap-3">
      <Field label={label ?? t("cu.search")}>
        <Input id="customer-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="01xxxxxxxxx" autoComplete="off" />
      </Field>
      {results.length ? (
        <ul className="grid gap-1.5 max-h-64 overflow-y-auto">
          {results.map((c) => (
            <CustomerRow key={c.id} c={c} onPick={() => onPick(c.id)} openAt={(() => { const b = openBillOfCustomer(snap, c.id); return b ? n(placeById(snap, b.place_id)) || t("common.counter") : null; })()} money={money} />
          ))}
        </ul>
      ) : null}
      {canCreate ? (
        <div className="grid gap-2 border-2 border-dashed border-line rounded-[2px] p-3">
          <p className="text-sm text-muted">{t("cu.notFound")}</p>
          <Field label={t("common.nameOptional")}>
            <Input id="customer-new-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
          </Field>
          <Button variant="primary" onClick={create}>{t("cu.create")}</Button>
        </div>
      ) : null}
    </div>
  );
}

function CustomerRow({ c, onPick, openAt, money }: { c: Customer; onPick: () => void; openAt: string | null; money: (n: number) => string }) {
  const { t } = useI18n();
  return (
    <li>
      <button type="button" onClick={onPick} className="w-full text-start flex items-center justify-between gap-2 border-2 border-line hover:border-strong rounded-[2px] px-3 py-2 bg-surface">
        <span className="grid min-w-0">
          <span className="font-semibold truncate">{c.name || "—"}</span>
          <span className="num text-sm text-muted">{c.phone}{c.code ? ` · ${c.code}` : ""}</span>
        </span>
        <span className="flex flex-col items-end gap-1">
          {openAt ? <Pill tone="warn">{openAt}</Pill> : null}
          {c.outstanding > 0 ? <Pill tone="busy">{t("cu.owes", { amount: money(c.outstanding) })}</Pill> : null}
        </span>
      </button>
    </li>
  );
}
