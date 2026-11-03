"use client";

import { useI18n } from "@/lib/i18n";
import { Button, Card, Empty, SectionTitle } from "@/components/ui";
import { customerById, openBills, placeById } from "../derive";
import { useSnap } from "../hooks";
import { BillCard } from "../components/BillCard";
import { printBill } from "../receipts";

export function BillsView() {
  const { t, n, money, time, lang } = useI18n();
  const snap = useSnap();
  const open = openBills(snap).sort((a, b) => {
    const pa = placeById(snap, a.place_id);
    const pb = placeById(snap, b.place_id);
    return (pa?.kind ?? "z").localeCompare(pb?.kind ?? "z") || (pa?.sort ?? 99) - (pb?.sort ?? 99) || a.opened_at.localeCompare(b.opened_at);
  });
  const closed = snap.bills.filter((b) => b.status === "closed").sort((a, b) => (b.closed_at ?? "").localeCompare(a.closed_at ?? "")).slice(0, 30);

  return (
    <div className="grid gap-6">
      <section className="grid gap-3">
        <SectionTitle>{t("bl.open")} <span className="num">({open.length})</span></SectionTitle>
        {open.length ? <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{open.map((b) => <BillCard key={b.id} bill={b} />)}</div> : <Empty>{t("bl.none")}</Empty>}
      </section>
      <section className="grid gap-3">
        <SectionTitle>{t("bl.recent")}</SectionTitle>
        {closed.length ? (
          <Card className="divide-y-2 divide-line">
            {closed.map((b) => {
              const c = customerById(snap, b.customer_id);
              const p = placeById(snap, b.place_id);
              return (
                <div key={b.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                  <div className="grid min-w-0">
                    <span className="font-semibold truncate">{c?.name || c?.phone} · {p ? n(p) : t("common.counter")}</span>
                    <span className="text-xs text-muted">{b.closed_at ? time(b.closed_at) : ""}{b.pay_later > 0 ? ` · ${t("co.payLater")} ${money(b.pay_later)}` : ""}{b.discount_amount > 0 ? ` · ${t("co.discount")} ${money(b.discount_amount)}` : ""}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="num font-bold">{money(b.total)}</span>
                    <Button size="sm" onClick={() => printBill(snap, b, lang, t)}>{t("bl.reprint")}</Button>
                  </div>
                </div>
              );
            })}
          </Card>
        ) : (
          <Empty>{t("common.none")}</Empty>
        )}
      </section>
    </div>
  );
}
