"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useErrorText, useI18n } from "@/lib/i18n";
import { errorCode, isNetworkError, rpc } from "@/lib/supabase";
import { isValidPhone, normalizePhone } from "@/lib/phone";
import { round2 } from "@/lib/billing";
import type { CartLine, Catalog, ChosenOption, MenuItem, OrderStatus } from "@/lib/types";
import { Button, Card, Empty, Field, Input, Pill, Sheet, Textarea, cx, useToast } from "@/components/ui";
import { addMyOrder, getIdentity, getMyOrders, setIdentity, type QrPlace } from "./local";

export function MenuView({ catalog, place, onRefresh }: { catalog: Catalog; place: QrPlace | null; onRefresh: () => void }) {
  const { t, n, money } = useI18n();
  const [cart, setCart] = useState<CartLine[]>([]);
  const [picking, setPicking] = useState<MenuItem | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [activeCat, setActiveCat] = useState<string | null>(null);
  const [sent, setSent] = useState<{ code: string | null } | null>(null);
  const [ordersTick, setOrdersTick] = useState(0);
  const sectionRefs = useRef<Record<string, HTMLElement | null>>({});

  const itemsByCat = useMemo(() => {
    const m = new Map<string, MenuItem[]>();
    for (const it of catalog.items) m.set(it.category_id, [...(m.get(it.category_id) ?? []), it]);
    return m;
  }, [catalog.items]);
  const cats = catalog.categories.filter((c) => itemsByCat.get(c.id)?.length);
  const priceOf = (id: string) => catalog.items.find((i) => i.id === id)?.price ?? 0;
  const cartCount = cart.reduce((a, l) => a + l.qty, 0);
  const cartTotal = round2(cart.reduce((a, l) => a + l.qty * priceOf(l.menu_item_id), 0));

  // Drop items that sold out while sitting in the cart.
  useEffect(() => {
    setCart((c) => c.filter((l) => catalog.items.find((i) => i.id === l.menu_item_id)?.available));
  }, [catalog.items]);

  function add(item: MenuItem, options: ChosenOption[], note: string) {
    const key = `${item.id}|${options.map((o) => o.choice_id).join(",")}|${note}`;
    setCart((c) => {
      const ex = c.find((l) => l.key === key);
      if (ex) return c.map((l) => (l.key === key ? { ...l, qty: Math.min(50, l.qty + 1) } : l));
      return [...c, { key, menu_item_id: item.id, qty: 1, options, note }];
    });
  }

  function onAddClick(item: MenuItem) {
    if (item.options.length) setPicking(item);
    else add(item, [], "");
  }

  return (
    <div className="grid gap-6 pb-28">
      {!place ? <p className="text-sm text-muted border-s-4 border-accent ps-3">{t("c.noPlace")}</p> : null}

      <MyOrders key={ordersTick} />

      {cats.length > 1 ? (
        <div className="sticky top-[104px] z-20 -mx-4 px-4 py-2 bg-bg/95 backdrop-blur flex gap-2 overflow-x-auto">
          {cats.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => {
                setActiveCat(c.id);
                sectionRefs.current[c.id]?.scrollIntoView({ behavior: "smooth", block: "start" });
              }}
              className={cx("h-9 px-3 shrink-0 rounded-[2px] border-2 text-sm font-semibold", activeCat === c.id ? "bg-strong text-bg border-strong" : "bg-surface border-line")}
            >
              {n(c)}
            </button>
          ))}
        </div>
      ) : null}

      {cats.length === 0 ? <Empty>{t("common.none")}</Empty> : null}

      {cats.map((c) => (
        <section key={c.id} ref={(el) => { sectionRefs.current[c.id] = el; }} className="grid gap-3 scroll-mt-40">
          <h2 className="font-display text-2xl font-bold">{n(c)}</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {itemsByCat.get(c.id)!.map((it) => (
              <ItemCard key={it.id} item={it} onAdd={() => onAddClick(it)} inCart={cart.filter((l) => l.menu_item_id === it.id).reduce((a, l) => a + l.qty, 0)} />
            ))}
          </div>
        </section>
      ))}

      {cartCount > 0 ? (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t-2 border-strong bg-bg" style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}>
          <div className="mx-auto max-w-3xl flex items-center justify-between gap-3 py-3" style={{ paddingInline: "max(16px, env(safe-area-inset-left, 0px))" }}>
            <div className="grid">
              <span className="text-sm text-muted">{t("c.cartCount", { n: cartCount })}</span>
              <span className="num font-bold text-lg">{money(cartTotal)}</span>
            </div>
            <Button variant="accent" size="lg" onClick={() => setReviewing(true)}>
              {t("c.reviewOrder")}
            </Button>
          </div>
        </div>
      ) : null}

      <OptionSheet item={picking} onClose={() => setPicking(null)} onAdd={(opts, note) => { if (picking) add(picking, opts, note); setPicking(null); }} />

      <CheckoutSheet
        open={reviewing}
        onClose={() => setReviewing(false)}
        cart={cart}
        setCart={setCart}
        catalog={catalog}
        place={place}
        total={cartTotal}
        onSent={(code) => {
          setCart([]);
          setReviewing(false);
          setSent({ code });
          setOrdersTick((x) => x + 1);
          onRefresh();
        }}
      />

      <Sheet open={!!sent} onClose={() => setSent(null)} title={t("c.orderSent")} footer={<Button variant="primary" onClick={() => setSent(null)}>{t("common.close")}</Button>}>
        <p>{t("c.orderSentHint")}</p>
        {sent?.code ? (
          <Card className="p-4 grid gap-1 text-center border-strong">
            <span className="text-sm text-muted">{t("c.yourCodeIs")}</span>
            <span className="num text-4xl font-bold tracking-[0.3em]">{sent.code}</span>
            <span className="text-sm">{t("c.keepCode")}</span>
          </Card>
        ) : null}
      </Sheet>
    </div>
  );
}

function ItemCard({ item, onAdd, inCart }: { item: MenuItem; onAdd: () => void; inCart: number }) {
  const { t, n, money, lang } = useI18n();
  const desc = lang === "ar" ? item.desc_ar || item.desc_en : item.desc_en || item.desc_ar;
  return (
    <Card className={cx("flex gap-3 p-3", !item.available && "opacity-60")}>
      {item.image_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={item.image_url} alt="" className="size-20 shrink-0 object-cover rounded-[2px] border-2 border-line" loading="lazy" />
      ) : (
        <div aria-hidden className="size-20 shrink-0 rounded-[2px] tile-pattern" />
      )}
      <div className="flex-1 min-w-0 grid gap-1 content-between">
        <div className="min-w-0">
          <div className="font-semibold leading-snug">{n(item)}</div>
          {desc ? <div className="text-sm text-muted line-clamp-2">{desc}</div> : null}
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="num font-bold">{money(item.price)}</span>
          {item.available ? (
            <Button size="sm" variant={inCart ? "primary" : "accent"} onClick={onAdd} aria-label={`${t("common.add")} ${n(item)}`}>
              {inCart ? <span className="num">{inCart}</span> : null}+
            </Button>
          ) : (
            <Pill tone="busy">{t("c.soldOut")}</Pill>
          )}
        </div>
      </div>
    </Card>
  );
}

function OptionSheet({ item, onClose, onAdd }: { item: MenuItem | null; onClose: () => void; onAdd: (o: ChosenOption[], note: string) => void }) {
  const { t, n, money } = useI18n();
  const [sel, setSel] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");
  useEffect(() => {
    if (item) {
      setSel(Object.fromEntries(item.options.map((g) => [g.id, g.choices[0]?.id ?? ""])));
      setNote("");
    }
  }, [item]);
  if (!item) return null;
  const chosen: ChosenOption[] = item.options.flatMap((g) => {
    const c = g.choices.find((x) => x.id === sel[g.id]);
    return c ? [{ group_id: g.id, choice_id: c.id, group_ar: g.name_ar, group_en: g.name_en, choice_ar: c.name_ar, choice_en: c.name_en }] : [];
  });
  return (
    <Sheet
      open
      onClose={onClose}
      title={n(item)}
      footer={
        <Button variant="accent" size="lg" className="w-full" onClick={() => onAdd(chosen, note.trim())}>
          {t("c.addToOrder")} · <span className="num">{money(item.price)}</span>
        </Button>
      }
    >
      {item.options.map((g) => (
        <fieldset key={g.id} className="grid gap-2">
          <legend className="font-semibold mb-2">{t("c.chooseOption", { group: n(g) })}</legend>
          <div className="flex flex-wrap gap-2">
            {g.choices.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setSel((s) => ({ ...s, [g.id]: c.id }))}
                aria-pressed={sel[g.id] === c.id}
                className={cx("h-11 px-4 rounded-[2px] border-2 font-semibold", sel[g.id] === c.id ? "bg-strong text-bg border-strong" : "bg-surface border-line")}
              >
                {n(c)}
              </button>
            ))}
          </div>
        </fieldset>
      ))}
      <Field label={t("c.itemNote")}>
        <Input id="item-note" value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} placeholder={t("common.optional")} />
      </Field>
    </Sheet>
  );
}

function CheckoutSheet({
  open, onClose, cart, setCart, catalog, place, total, onSent,
}: {
  open: boolean; onClose: () => void; cart: CartLine[]; setCart: (f: (c: CartLine[]) => CartLine[]) => void; catalog: Catalog; place: QrPlace | null; total: number; onSent: (code: string | null) => void;
}) {
  const { t, n, money, lang } = useI18n();
  const errText = useErrorText();
  const toast = useToast();
  const [useCode, setUseCode] = useState(false);
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const orderId = useRef<string>("");

  useEffect(() => {
    if (!open) return;
    const me = getIdentity();
    setPhone(me.phone);
    setCode(me.code);
    setName(me.name);
    setUseCode(!!me.code && !me.phone);
    setError(null);
    orderId.current = crypto.randomUUID();
  }, [open]);

  const valid = cart.length > 0 && (useCode ? /^\d{4,6}$/.test(code.trim()) : isValidPhone(phone));

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await rpc<{ order_id: string; customer_code: string | null; name: string | null }>("customer_place_order", {
        p_order_id: orderId.current,
        p_token: place?.token ?? null,
        p_phone: useCode ? "" : normalizePhone(phone),
        p_code: useCode ? code.trim() : null,
        p_name: name.trim(),
        p_items: cart.map((l) => ({ menu_item_id: l.menu_item_id, qty: l.qty, options: l.options.map((o) => ({ group_id: o.group_id, choice_id: o.choice_id })), note: l.note })),
        p_note: note.trim(),
      });
      const prev = getIdentity();
      setIdentity({
        phone: useCode ? prev.phone : normalizePhone(phone),
        code: res.customer_code ?? (useCode ? code.trim() : prev.phone === normalizePhone(phone) ? prev.code : ""),
        name: name.trim() || res.name || prev.name,
      });
      addMyOrder(res.order_id);
      onSent(res.customer_code);
    } catch (e) {
      const c = isNetworkError(e) ? "network" : errorCode(e);
      setError(errText(c));
      if (c === "item_sold_out") onClose();
      toast(errText(c), "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={t("c.yourOrder")}
      footer={
        <Button variant="accent" size="lg" className="w-full" disabled={!valid} busy={busy} onClick={submit}>
          {busy ? t("c.sending") : t("c.sendOrder")} · <span className="num">{money(total)}</span>
        </Button>
      }
    >
      {cart.length === 0 ? <Empty>{t("c.emptyCart")}</Empty> : null}
      <ul className="grid gap-2">
        {cart.map((l) => {
          const it = catalog.items.find((i) => i.id === l.menu_item_id);
          if (!it) return null;
          return (
            <li key={l.key} className="flex items-center gap-3 border-b-2 border-line pb-2">
              <div className="flex-1 min-w-0">
                <div className="font-semibold">{n(it)}</div>
                {l.options.length || l.note ? (
                  <div className="text-sm text-muted">{[...l.options.map((o) => (lang === "ar" ? o.choice_ar : o.choice_en)), l.note].filter(Boolean).join(" · ")}</div>
                ) : null}
                <div className="num text-sm">{money(it.price * l.qty)}</div>
              </div>
              <div className="flex items-center gap-1" dir="ltr">
                <Button size="sm" aria-label="−" onClick={() => setCart((c) => c.flatMap((x) => (x.key === l.key ? (x.qty > 1 ? [{ ...x, qty: x.qty - 1 }] : []) : [x])))}>
                  −
                </Button>
                <span className="num w-7 text-center font-bold">{l.qty}</span>
                <Button size="sm" aria-label="+" onClick={() => setCart((c) => c.map((x) => (x.key === l.key ? { ...x, qty: Math.min(50, x.qty + 1) } : x)))}>
                  +
                </Button>
              </div>
            </li>
          );
        })}
      </ul>

      <div className="text-sm font-semibold">{place ? t("c.orderingFrom", { place: n(place) }) : t("c.pickupCounter")}</div>

      <fieldset className="grid gap-3">
        <legend className="font-display text-lg font-bold mb-1">{t("c.whoAreYou")}</legend>
        {useCode ? (
          <Field label={t("common.code")}>
            <Input id="order-code" numeric inputMode="numeric" value={code} maxLength={6} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} autoComplete="off" />
          </Field>
        ) : (
          <Field label={t("common.phone")}>
            <Input id="order-phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" placeholder="01xxxxxxxxx" />
          </Field>
        )}
        <button type="button" className="text-sm font-semibold underline justify-self-start" onClick={() => setUseCode((x) => !x)}>
          {useCode ? t("c.usePhone") : t("c.useCode")}
        </button>
        <Field label={t("common.nameOptional")}>
          <Input id="order-name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} autoComplete="name" />
        </Field>
        <Field label={t("common.noteOptional")}>
          <Textarea id="order-note" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} rows={2} />
        </Field>
      </fieldset>
      {error ? <p className="text-busy font-semibold">{error}</p> : null}
    </Sheet>
  );
}

function MyOrders() {
  const { t } = useI18n();
  const [statuses, setStatuses] = useState<{ id: string; status: OrderStatus }[]>([]);
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      const mine = getMyOrders();
      if (!mine.length) return setStatuses([]);
      try {
        const res = await rpc<{ id: string; status: OrderStatus }[]>("customer_order_status", { p_ids: mine.map((m) => m.id) });
        if (alive) setStatuses(mine.map((m) => res.find((r) => r.id === m.id)).filter(Boolean) as { id: string; status: OrderStatus }[]);
      } catch {}
    };
    void tick();
    const id = setInterval(tick, 8000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);
  const visible = statuses.filter((s) => s.status === "new" || s.status === "accepted" || s.status === "rejected");
  if (!visible.length) return null;
  const tone = (s: OrderStatus) => (s === "new" ? "warn" : s === "accepted" ? "accent" : s === "served" ? "free" : "busy") as "warn" | "accent" | "free" | "busy";
  return (
    <Card className="p-3 grid gap-2 border-strong">
      <div className="font-semibold">{t("c.myOrders")}</div>
      <ul className="grid gap-1.5">
        {visible.map((s, i) => (
          <li key={s.id} className="flex items-center justify-between gap-2 text-sm">
            <span className="num text-muted">#{visible.length - i}</span>
            <Pill tone={tone(s.status)}>{t(`c.status.${s.status}` as const)}</Pill>
          </li>
        ))}
      </ul>
    </Card>
  );
}
