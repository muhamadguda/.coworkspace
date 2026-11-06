"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useErrorText, useI18n } from "@/lib/i18n";
import { errorCode, isNetworkError, rpc } from "@/lib/supabase";
import { isValidPhone, normalizePhone } from "@/lib/phone";
import type { PublicEvent } from "@/lib/types";
import { Button, Card, Empty, Field, Input, LangSwitch, Logo, Pill, Sheet, Textarea, Toggle, useToast } from "@/components/ui";
import { getIdentity, setIdentity } from "./local";
import { EventsNotify } from "@/components/EventsNotify";

const SIGNED = "dot.events.signed";
const readSigned = (): Record<string, number> => {
  try {
    return JSON.parse(localStorage.getItem(SIGNED) || "{}");
  } catch {
    return {};
  }
};

export function EventsApp() {
  const { t } = useI18n();
  const [events, setEvents] = useState<PublicEvent[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [signing, setSigning] = useState<PublicEvent | null>(null);
  const [cancelling, setCancelling] = useState<PublicEvent | null>(null);
  const [signed, setSigned] = useState<Record<string, number>>(readSigned);

  const fetchEvents = useCallback(() => rpc<PublicEvent[]>("public_events").then((x) => { setEvents(x); setFailed(false); }).catch(() => setFailed(true)), []);
  const load = () => {
    setFailed(false);
    void fetchEvents();
  };
  useEffect(() => {
    void fetchEvents();
  }, [fetchEvents]);
  // A shared link (/events#<id>) opens straight on that event.
  useEffect(() => {
    if (!events) return;
    const id = location.hash.slice(1);
    if (id) document.getElementById(`ev-${id}`)?.scrollIntoView({ block: "start" });
  }, [events]);

  return (
    <div className="min-h-dvh flex flex-col">
      <header className="tile-stripe sticky top-0 z-30 bg-bg/95 backdrop-blur border-b-2 border-line" style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}>
        <div className="mx-auto max-w-3xl flex items-center justify-between gap-3 py-3" style={{ paddingInline: "max(16px, env(safe-area-inset-left, 0px))" }}>
          <div className="flex items-center gap-3 min-w-0">
            <Link href="/" aria-label="dot"><Logo className="h-8" /></Link>
            <span className="font-display text-xl font-bold">{t("ev.title")}</span>
          </div>
          <div className="flex items-center gap-3">
            <Link href="/menu" className="text-sm font-semibold underline underline-offset-4">{t("ev.menu")}</Link>
            <LangSwitch />
          </div>
        </div>
      </header>
      <main className="flex-1 mx-auto w-full max-w-3xl py-6 grid gap-4 content-start" style={{ paddingInline: "max(16px, env(safe-area-inset-left, 0px))", paddingBottom: "max(24px, env(safe-area-inset-bottom, 0px))" }}>
        <p className="text-muted">{t("ev.lead")}</p>
        <EventsNotify />
        {failed && !events ? (
          <div className="grid gap-3 place-items-center py-16 text-center">
            <p className="text-muted">{t("err.network")}</p>
            <button type="button" className="underline font-semibold" onClick={load}>{t("common.retry")}</button>
          </div>
        ) : !events ? (
          [0, 1].map((i) => <div key={i} className="h-48 bg-surface-2 rounded-[2px] animate-pulse" />)
        ) : events.length ? (
          events.map((e) => <EventCard key={e.id} e={e} going={signed[e.id]} onSignUp={() => setSigning(e)} onCancel={() => setCancelling(e)} />)
        ) : (
          <Empty>{t("ev.none")}</Empty>
        )}
      </main>
      {cancelling ? (
        <CancelSheet
          e={cancelling}
          onClose={() => setCancelling(null)}
          onDone={() => {
            const next = { ...readSigned() };
            delete next[cancelling.id];
            try {
              localStorage.setItem(SIGNED, JSON.stringify(next));
            } catch {}
            setSigned(next);
            setCancelling(null);
            load();
          }}
        />
      ) : null}
      {signing ? (
        <SignUpSheet
          e={signing}
          onClose={() => setSigning(null)}
          onDone={(seats) => {
            const next = { ...readSigned(), [signing.id]: seats };
            try {
              localStorage.setItem(SIGNED, JSON.stringify(next));
            } catch {}
            setSigned(next);
            setSigning(null);
            load();
          }}
        />
      ) : null}
    </div>
  );
}

export function EventWhen({ e }: { e: Pick<PublicEvent, "starts_at" | "ends_at"> }) {
  const { lang, time } = useI18n();
  const day = new Intl.DateTimeFormat(lang === "ar" ? "ar-EG-u-nu-latn" : "en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "Africa/Cairo" }).format(new Date(e.starts_at));
  return <span>{day} · <span className="num" dir="ltr">{time(e.starts_at)}{e.ends_at ? `–${time(e.ends_at)}` : ""}</span></span>;
}

function EventCard({ e, going, onSignUp, onCancel }: { e: PublicEvent; going?: number; onSignUp: () => void; onCancel: () => void }) {
  const { t, money, lang } = useI18n();
  const full = e.seats_left === 0;
  const desc = lang === "ar" ? e.desc_ar || e.desc_en : e.desc_en || e.desc_ar;
  const toast = useToast();
  async function share() {
    const url = `${location.origin}/events#${e.id}`;
    const title = lang === "ar" ? e.title_ar : e.title_en;
    try {
      if (navigator.share) await navigator.share({ title, url });
      else {
        await navigator.clipboard.writeText(url);
        toast(t("ev.linkCopied"));
      }
    } catch {}
  }
  return (
    <Card id={`ev-${e.id}`} className="overflow-hidden grid scroll-mt-24">
      {e.image_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={e.image_url} alt="" loading="lazy" className="w-full aspect-[16/9] object-cover border-b-2 border-line" />
      ) : null}
      <div className="p-4 grid gap-3">
        <div className="grid gap-1">
          <h2 className="font-display text-2xl font-bold">{lang === "ar" ? e.title_ar : e.title_en}</h2>
          <span className="text-sm font-semibold"><EventWhen e={e} />{e.place ? ` · ${lang === "ar" ? e.place.name_ar : e.place.name_en}` : ""}</span>
        </div>
        {desc ? <p className="text-sm leading-relaxed whitespace-pre-line">{desc}</p> : null}
        <div className="flex flex-wrap items-center gap-2">
          <Pill tone="accent">{e.price > 0 ? money(e.price) : t("ev.free")}</Pill>
          {e.seats_left != null ? <Pill tone={full ? "busy" : e.seats_left <= 5 ? "warn" : "free"}>{full ? t("ev.full") : t("ev.seatsLeft", { n: e.seats_left })}</Pill> : null}
          {going ? <Pill tone="free">{t("ev.youreIn", { n: going })}</Pill> : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="accent" size="lg" disabled={full && !going} onClick={onSignUp}>{going ? t("ev.change") : full ? t("ev.full") : t("ev.signUp")}</Button>
          {going ? <Button variant="ghost" onClick={onCancel}>{t("ev.cancelSeat")}</Button> : null}
          <Button variant="ghost" onClick={share}>{t("ev.share")}</Button>
        </div>
      </div>
    </Card>
  );
}

/** Give the seat back: phone + customer code (remembered on this phone when there is one). */
function CancelSheet({ e, onClose, onDone }: { e: PublicEvent; onClose: () => void; onDone: () => void }) {
  const { t, lang } = useI18n();
  const errText = useErrorText();
  const toast = useToast();
  const me = getIdentity();
  const [phone, setPhone] = useState(me.phone);
  const [code, setCode] = useState(me.code);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await rpc("customer_event_cancel", { p_event: e.id, p_phone: normalizePhone(phone), p_code: code.trim() });
      toast(t("ev.cancelled"));
      onDone();
    } catch (err) {
      setError(errText(isNetworkError(err) ? "network" : errorCode(err)));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Sheet open onClose={onClose} title={`${t("ev.cancelSeat")} · ${lang === "ar" ? e.title_ar : e.title_en}`} footer={<Button variant="danger" size="lg" busy={busy} disabled={!isValidPhone(phone) || code.trim().length < 4} onClick={submit}>{t("ev.cancelSeat")}</Button>}>
      <Field label={t("common.phone")}><Input id="evc-phone" type="tel" value={phone} onChange={(x) => setPhone(x.target.value)} autoComplete="tel" /></Field>
      <Field label={t("common.code")} hint={t("ev.codeHint")}><Input id="evc-code" numeric inputMode="numeric" maxLength={6} value={code} onChange={(x) => setCode(x.target.value.replace(/\D/g, ""))} /></Field>
      {error ? <p className="text-busy font-semibold text-sm">{error}</p> : null}
    </Sheet>
  );
}

function SignUpSheet({ e, onClose, onDone }: { e: PublicEvent; onClose: () => void; onDone: (seats: number) => void }) {
  const { t, lang } = useI18n();
  const errText = useErrorText();
  const toast = useToast();
  const me = getIdentity();
  const [name, setName] = useState(me.name);
  const [phone, setPhone] = useState(me.phone);
  const [seats, setSeats] = useState(1);
  const [note, setNote] = useState("");
  const [offers, setOffers] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const max = Math.min(10, e.seats_left == null ? 10 : Math.max(1, e.seats_left));
  const valid = name.trim().length > 0 && isValidPhone(phone);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const r = await rpc<{ customer_code: string | null }>("customer_event_signup", { p_event: e.id, p_phone: normalizePhone(phone), p_name: name.trim(), p_seats: seats, p_note: note.trim(), p_offers: offers });
      const prev = getIdentity();
      const code = r.customer_code ?? (prev.phone === normalizePhone(phone) ? prev.code : "");
      setIdentity({ ...prev, phone: normalizePhone(phone), name: name.trim(), code });
      toast(r.customer_code ? t("ev.doneCode", { code: r.customer_code }) : t("ev.done"));
      onDone(seats);
    } catch (err) {
      setError(errText(isNetworkError(err) ? "network" : errorCode(err)));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open onClose={onClose} title={lang === "ar" ? e.title_ar : e.title_en} footer={<Button variant="accent" size="lg" busy={busy} disabled={!valid} onClick={submit}>{t("ev.confirm")}</Button>}>
      <p className="text-sm font-semibold"><EventWhen e={e} /></p>
      <Field label={t("common.name")}><Input id="ev-name" value={name} maxLength={80} onChange={(x) => setName(x.target.value)} autoComplete="name" /></Field>
      <Field label={t("common.phone")}><Input id="ev-phone" type="tel" value={phone} onChange={(x) => setPhone(x.target.value)} autoComplete="tel" placeholder="01xxxxxxxxx" /></Field>
      <Field group label={t("ev.seats")}>
        <div className="flex items-center gap-2">
          <Button size="sm" disabled={seats <= 1} onClick={() => setSeats(seats - 1)} aria-label="−">−</Button>
          <span className="num text-xl font-bold w-8 text-center" aria-live="polite">{seats}</span>
          <Button size="sm" disabled={seats >= max} onClick={() => setSeats(seats + 1)} aria-label="+">+</Button>
        </div>
      </Field>
      <Field label={t("common.noteOptional")}><Textarea id="ev-note" value={note} maxLength={300} onChange={(x) => setNote(x.target.value)} /></Field>
      <Toggle checked={offers} onChange={setOffers} label={t("of.label")} />
      {error ? <p className="text-busy font-semibold text-sm">{error}</p> : null}
    </Sheet>
  );
}
