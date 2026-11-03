"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { rpc } from "@/lib/supabase";
import { rateFor } from "@/lib/pricing";
import type { Catalog } from "@/lib/types";
import { LangSwitch, Logo, StatusDot, cx } from "@/components/ui";
import { VENUE } from "./config";

// Brand colors are fixed here (not theme tokens): the teal bands look the same in light and dark.
const TEAL = "#173a39";
const DEEP = "#0f2a29";
const SAGE = "#eaf0ea";
const MUSTARD = "#d9a21b";

export function Landing() {
  const { t } = useI18n();
  const [catalog, setCatalog] = useState<Catalog | null>(null);

  useEffect(() => {
    // Old QR links (/?t=…) and notification links (/?tab=…) belong to the menu.
    const q = new URLSearchParams(location.search);
    if (q.has("t") || q.has("tab")) {
      location.replace(`/menu${location.search}`);
      return;
    }
    rpc<Catalog>("public_catalog").then(setCatalog).catch(() => {});
  }, []);

  useReveal();

  return (
    <div className="min-h-dvh bg-bg text-ink">
      <Hero />
      <Marquee />
      <Activities />
      <Rooms catalog={catalog} />
      <HowItWorks />
      <Cafe catalog={catalog} />
      <Visit />
      <footer className="border-t-2 border-line">
        <div className="mx-auto max-w-6xl py-6 flex flex-wrap items-center justify-between gap-3 text-sm text-muted" style={{ paddingInline: "max(16px, env(safe-area-inset-left, 0px))", paddingBottom: "max(24px, env(safe-area-inset-bottom, 0px))" }}>
          <span className="flex items-center gap-3"><Logo className="h-6" /> <span>dotcowork.space</span></span>
          <a href="/staff" className="underline">{t("l.staff")}</a>
        </div>
      </footer>
    </div>
  );
}

const gutter = { paddingInline: "max(16px, env(safe-area-inset-left, 0px))" } as const;

function Hero() {
  const { t, dir } = useI18n();
  const mosaic = useRef<MosaicHandle>(null);
  const verbs = [t("l.v1"), t("l.v2"), t("l.v3"), t("l.v4"), t("l.v5")];
  const [vi, setVi] = useState(0);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const id = setInterval(() => setVi((i) => (i + 1) % 5), 2200);
    return () => clearInterval(id);
  }, []);
  // Fade toward the text side so the headline always stays readable.
  const fade = `linear-gradient(${dir === "rtl" ? "270deg" : "90deg"}, ${TEAL} 0%, ${TEAL}f0 34%, ${TEAL}8c 60%, ${TEAL}1a 100%)`;
  return (
    <header
      className="relative overflow-hidden select-none"
      style={{ background: TEAL, color: SAGE }}
      onPointerMove={(e) => mosaic.current?.hover(e.clientX, e.clientY)}
      onPointerDown={(e) => mosaic.current?.tap(e.clientX, e.clientY)}
    >
      <Mosaic ref={mosaic} />
      <div aria-hidden className="absolute inset-0 pointer-events-none" style={{ background: fade }} />
      <nav className="relative mx-auto max-w-6xl flex items-center justify-between gap-3 py-4" style={{ ...gutter, paddingTop: "max(16px, env(safe-area-inset-top, 0px))" }}>
        <Logo light className="h-9" />
        <div className="flex items-center gap-2">
          <a href={`tel:${VENUE.phone}`} className="hidden sm:inline-flex h-9 px-3 items-center rounded-[2px] border-2 text-sm font-semibold num" style={{ borderColor: `${SAGE}55` }}>
            {VENUE.phoneDisplay}
          </a>
          <LangSwitch className="!bg-transparent !text-[#eaf0ea] !border-[#eaf0ea]/60" />
        </div>
      </nav>

      <div className="relative mx-auto max-w-6xl pt-10 pb-20 sm:pt-16 sm:pb-28 grid gap-8 pointer-events-none [&_a]:pointer-events-auto [&_button]:pointer-events-auto" style={gutter}>
        <span className="inline-flex items-center gap-2 justify-self-start rounded-[2px] px-3 py-1 text-sm font-semibold" style={{ background: `${SAGE}14`, border: `1px solid ${SAGE}33` }}>
          <span className="size-2 rounded-full" style={{ background: MUSTARD }} />
          {t("l.eyebrow")} · {t("l.openLate")}
        </span>
        <h1 className="font-display font-bold leading-[0.95] tracking-tight text-[clamp(64px,13vw,168px)] grid">
          <span className="landing-rise" style={{ animationDelay: "0ms" }}>{t("l.title1")}</span>
          <span className="landing-rise" style={{ animationDelay: "120ms" }}>{t("l.title2")}</span>
          <span className="landing-rise" style={{ animationDelay: "240ms", color: MUSTARD }} aria-live="off">
            <span key={vi} className="word-in">{verbs[vi]}</span>
          </span>
        </h1>
        <p className="max-w-[46ch] text-lg sm:text-xl leading-relaxed" style={{ color: `${SAGE}d9` }}>{t("l.lede")}</p>
        <div className="flex flex-wrap gap-3">
          <a href="/menu" className="h-14 px-6 inline-flex items-center rounded-[2px] font-bold text-lg border-2" style={{ background: MUSTARD, color: TEAL, borderColor: MUSTARD }}>
            {t("l.menu")}
          </a>
          <a href="/menu?tab=book" className="h-14 px-6 inline-flex items-center rounded-[2px] font-bold text-lg border-2" style={{ borderColor: SAGE, color: SAGE }}>
            {t("l.book")}
          </a>
        </div>
        <div className="flex flex-wrap gap-x-6 gap-y-2 text-[15px] font-semibold">
          <a href={`tel:${VENUE.phone}`} className="inline-flex items-center gap-2 underline underline-offset-4 decoration-2" style={{ textDecorationColor: MUSTARD }}>
            <PhoneIcon /> {t("l.call")} <span className="num">{VENUE.phoneDisplay}</span>
          </a>
          <a href={VENUE.mapUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 underline underline-offset-4 decoration-2" style={{ textDecorationColor: MUSTARD }}>
            <PinIcon /> {t("l.directions")}
          </a>
        </div>
      </div>
      <span aria-hidden className="absolute bottom-5 end-5 text-xs font-semibold tracking-widest uppercase pointer-events-none hidden sm:block" style={{ color: `${SAGE}80` }}>
        {t("l.tapHint")} ↗
      </span>
      <div aria-hidden className="tile-stripe relative" />
    </header>
  );
}

type MosaicHandle = { hover: (x: number, y: number) => void; tap: (x: number, y: number) => void };

/** A living cement-tile floor: tiles light up on their own, under the pointer, and ripple on tap. */
const Mosaic = function Mosaic({ ref }: { ref: React.Ref<MosaicHandle> }) {
  const COLS = 12;
  const ROWS = 16; // enough rows to cover the tallest hero; extra rows are clipped
  const total = COLS * ROWS;
  const box = useRef<HTMLDivElement>(null);
  const [lit, setLit] = useState<Set<number>>(() => new Set([5, 18, 30, 41, 55, 66, 79, 88]));
  const [hot, setHot] = useState<Record<number, number>>({});
  const [ripples, setRipples] = useState<{ id: number; x: number; y: number }[]>([]);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const id = setInterval(() => {
      setLit((prev) => {
        const next = new Set(prev);
        const arr = [...next];
        if (arr.length > 9) next.delete(arr[Math.floor(Math.random() * arr.length)]);
        next.add(Math.floor(Math.random() * total));
        return next;
      });
      const now = Date.now();
      setHot((h) => Object.fromEntries(Object.entries(h).filter(([, until]) => until > now)));
    }, 900);
    return () => clearInterval(id);
  }, [total]);

  const indexAt = useCallback(
    (x: number, y: number) => {
      const r = box.current?.getBoundingClientRect();
      if (!r || x < r.left || x > r.right || y < r.top || y > r.bottom) return null;
      const cw = r.width / COLS;
      const col = Math.floor((x - r.left) / cw);
      const row = Math.floor((y - r.top) / cw);
      if (row < 0 || row >= ROWS) return null;
      return { i: row * COLS + col, col, row, lx: x - r.left, ly: y - r.top };
    },
    [],
  );

  const frame = useRef(0);
  const handle = useMemo<MosaicHandle>(
    () => ({
      hover: (x, y) => {
        if (frame.current) return;
        frame.current = requestAnimationFrame(() => {
          frame.current = 0;
          const hit = indexAt(x, y);
          if (!hit) return;
          setHot((h) => ({ ...h, [hit.i]: Date.now() + 1400 }));
        });
      },
      tap: (x, y) => {
        const hit = indexAt(x, y);
        if (!hit) return;
        const until = Date.now() + 1800;
        const ring: Record<number, number> = {};
        for (let dr = -1; dr <= 1; dr++)
          for (let dc = -1; dc <= 1; dc++) {
            const c = hit.col + dc, r = hit.row + dr;
            if (c >= 0 && c < COLS && r >= 0 && r < ROWS) ring[r * COLS + c] = until;
          }
        setHot((h) => ({ ...h, ...ring }));
        const id = Date.now() + Math.random();
        setRipples((rs) => [...rs.slice(-4), { id, x: hit.lx, y: hit.ly }]);
        setTimeout(() => setRipples((rs) => rs.filter((r) => r.id !== id)), 950);
      },
    }),
    [indexAt],
  );
  useEffect(() => {
    if (typeof ref === "function") ref(handle);
    else if (ref) (ref as React.MutableRefObject<MosaicHandle | null>).current = handle;
  }, [ref, handle]);

  return (
    <div ref={box} aria-hidden className="absolute inset-y-0 end-0 w-full sm:w-[72%] grid content-start opacity-95" style={{ gridTemplateColumns: `repeat(${COLS}, minmax(0, 1fr))` }}>
      {Array.from({ length: total }, (_, i) => {
        const on = lit.has(i) || hot[i] !== undefined;
        const isHot = hot[i] !== undefined;
        return (
          <span
            key={i}
            className="relative aspect-square transition-colors duration-700"
            style={{
              background: on ? DEEP : TEAL,
              backgroundImage: `radial-gradient(circle at 0 0, ${SAGE}${isHot ? "40" : "22"} 0 24%, transparent 24.5%), radial-gradient(circle at 100% 0, ${SAGE}${isHot ? "40" : "22"} 0 24%, transparent 24.5%), radial-gradient(circle at 0 100%, ${SAGE}${isHot ? "40" : "22"} 0 24%, transparent 24.5%), radial-gradient(circle at 100% 100%, ${SAGE}${isHot ? "40" : "22"} 0 24%, transparent 24.5%)`,
            }}
          >
            <span
              className="absolute inset-[34%] rounded-full transition-all duration-700"
              style={{
                background: on ? MUSTARD : `${SAGE}14`,
                transform: isHot ? "scale(1.25)" : on ? "scale(1)" : "scale(0.55)",
                boxShadow: on ? `0 0 ${isHot ? 40 : 26}px ${MUSTARD}${isHot ? "99" : "55"}` : "none",
              }}
            />
          </span>
        );
      })}
      {ripples.map((r) => (
        <span key={r.id} className="ripple absolute size-16 -ms-8 -mt-8 rounded-full pointer-events-none" style={{ left: r.x, top: r.y, border: `2px solid ${MUSTARD}` }} />
      ))}
    </div>
  );
};

function Marquee() {
  const { t } = useI18n();
  const words = [t("l.study"), t("l.meet"), t("l.work"), t("l.movie"), t("l.ps"), t("l.art")];
  const row = (
    <span className="flex items-center gap-8 pe-8 shrink-0">
      {words.map((w, i) => (
        <span key={i} className="flex items-center gap-8 whitespace-nowrap">
          <span className="font-display text-2xl sm:text-3xl font-bold">{w}</span>
          <span aria-hidden className="size-3 rounded-full" style={{ background: i % 2 ? SAGE : TEAL }} />
        </span>
      ))}
    </span>
  );
  return (
    <div aria-hidden className="overflow-hidden py-4 border-b-2 border-strong" style={{ background: MUSTARD, color: TEAL }}>
      <div className="marquee flex w-max" dir="ltr">
        {row}
        {row}
      </div>
    </div>
  );
}

/** Sections below the first screen fade up as they scroll into view. */
function useReveal() {
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || !("IntersectionObserver" in window)) return;
    const els = [...document.querySelectorAll<HTMLElement>("[data-reveal]")];
    const io = new IntersectionObserver(
      (entries) => entries.forEach((e) => e.isIntersecting && ((e.target as HTMLElement).dataset.reveal = "shown", io.unobserve(e.target))),
      { rootMargin: "0px 0px -8% 0px" },
    );
    for (const el of els) {
      if (el.getBoundingClientRect().top > window.innerHeight) {
        el.dataset.reveal = "pending";
        io.observe(el);
      }
    }
    return () => io.disconnect();
  }, []);
}

/** 3D tilt that follows the pointer. */
function useTilt<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const onPointerMove = (e: React.PointerEvent) => {
    const el = ref.current;
    if (!el || e.pointerType === "touch") return;
    const r = el.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width - 0.5;
    const y = (e.clientY - r.top) / r.height - 0.5;
    el.style.transform = `perspective(700px) rotateX(${(-y * 8).toFixed(2)}deg) rotateY(${(x * 10).toFixed(2)}deg) translateY(-4px)`;
  };
  const onPointerLeave = () => {
    if (ref.current) ref.current.style.transform = "";
  };
  return { ref, onPointerMove, onPointerLeave };
}

const ACTS = [
  { k: "study", icon: "M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5zM4 20.5A2.5 2.5 0 0 1 6.5 18H20v3H6.5" },
  { k: "meet", icon: "M3 4h18M5 4v10h14V4M12 14v4M8 21l4-3 4 3" },
  { k: "work", icon: "M4 6h16v10H4zM2 19.5h20" },
  { k: "movie", icon: "M3 5h18v12H3zM10 8.5v5l4.5-2.5zM8 21h8" },
  { k: "ps", icon: "M7 8h10a4 4 0 0 1 4 4v1.5a2.5 2.5 0 0 1-4.6 1.4L15 13H9l-1.4 1.9A2.5 2.5 0 0 1 3 13.5V12a4 4 0 0 1 4-4zM7.5 10.5v3M6 12h3M15.5 11h.01M17.5 12.5h.01" },
  { k: "art", icon: "M12 3a9 9 0 1 0 0 18c1.1 0 1.6-.8 1.6-1.6 0-1.4-1.2-1.6-1.2-2.9 0-1 .8-1.5 1.8-1.5H17a4 4 0 0 0 4-4c0-4.4-4-8-9-8zM7.5 11h.01M10 7h.01M15 7.5h.01" },
] as const;

function Activities() {
  const { t } = useI18n();
  return (
    <section className="mx-auto max-w-6xl py-20 grid gap-10" style={gutter}>
      <h2 data-reveal className="font-display font-bold text-[clamp(36px,6vw,64px)] leading-tight text-balance">{t("l.doTitle")}</h2>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {ACTS.map((a, i) => (
          <ActivityCard key={a.k} index={i}>
            <span className="relative size-16 grid place-items-center rounded-[2px] tile-corners transition-transform duration-500 group-hover:rotate-90">
              <span className="absolute inset-0 grid place-items-center transition-transform duration-500 group-hover:-rotate-90">
                <svg viewBox="0 0 24 24" className="size-8" fill="none" stroke={MUSTARD} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d={a.icon} />
                </svg>
              </span>
            </span>
            <h3 className="font-display text-2xl font-bold">{t(`l.${a.k}` as "l.study")}</h3>
            <p className="text-muted leading-relaxed">{t(`l.${a.k}B` as "l.studyB")}</p>
          </ActivityCard>
        ))}
      </div>
    </section>
  );
}

function ActivityCard({ index, children }: { index: number; children: React.ReactNode }) {
  const tilt = useTilt<HTMLElement>();
  return (
    <article
      {...tilt}
      data-reveal
      style={{ transitionDelay: `${(index % 3) * 90}ms` }}
      className="group relative bg-surface border-2 border-line hover:border-strong rounded-[2px] p-6 grid gap-4 transition-[transform,border-color] duration-200 will-change-transform"
    >
      {children}
    </article>
  );
}

function Rooms({ catalog }: { catalog: Catalog | null }) {
  const { t, n, money } = useI18n();
  const rooms = useMemo(() => catalog?.places.filter((p) => p.kind === "room") ?? [], [catalog]);
  const modes = useMemo(() => {
    if (!catalog) return [];
    return catalog.modes.map((m) => {
      const rates = rooms.length ? rooms.map((r) => rateFor(catalog.modes, catalog.mode_prices, r.id, m.id)) : [m.hourly_rate];
      return { m, from: Math.min(...rates) };
    });
  }, [catalog, rooms]);
  return (
    <section className="border-y-2 border-line bg-surface-2/60">
      <div className="mx-auto max-w-6xl py-20 grid gap-10 lg:grid-cols-[1fr_1.1fr] items-start" style={gutter}>
        <div data-reveal className="grid gap-4">
          <h2 className="font-display font-bold text-[clamp(36px,6vw,64px)] leading-tight">{t("l.roomsTitle")}</h2>
          <p className="text-lg text-muted max-w-[42ch]">{t("l.roomsLede")}</p>
          <a href="/menu?tab=book" className="justify-self-start h-12 px-5 inline-flex items-center rounded-[2px] font-bold border-2 border-strong bg-strong text-bg">{t("l.book")}</a>
        </div>
        <div data-reveal className="grid gap-4">
          <ul className="grid gap-2">
            {modes.length
              ? modes.map(({ m, from }) => (
                  <li key={m.id} className="flex items-baseline justify-between gap-4 border-b-2 border-line pb-3">
                    <span className="font-display text-2xl font-bold">{n(m)}</span>
                    <span className="text-muted text-sm whitespace-nowrap">
                      {t("l.from")} <span className="num text-2xl font-bold text-ink">{money(from)}</span>{t("common.perHour")}
                    </span>
                  </li>
                ))
              : [0, 1, 2].map((i) => <li key={i} className="h-12 bg-surface rounded-[2px] animate-pulse" />)}
          </ul>
          {rooms.length ? (
            <div className="grid gap-2">
              <span className="text-sm font-semibold text-muted">{t("l.liveNow")}</span>
              <div className="flex flex-wrap gap-2">
                {rooms.map((r) => (
                  <span key={r.id} className={cx("inline-flex items-center gap-2 h-10 px-3 rounded-[2px] border-2 font-semibold text-sm", r.busy ? "border-busy bg-busy-bg text-busy" : "border-free bg-free-bg text-free")}>
                    <span className="live-pulse inline-flex"><StatusDot tone={r.busy ? "busy" : "free"} /></span> {n(r)} · {r.busy ? t("common.inUse") : t("common.free")}
                  </span>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function HowItWorks() {
  const { t } = useI18n();
  const steps = [t("l.how1"), t("l.how2"), t("l.how3")];
  return (
    <section className="mx-auto max-w-6xl py-20 grid gap-10" style={gutter}>
      <h2 data-reveal className="font-display font-bold text-[clamp(36px,6vw,64px)] leading-tight">{t("l.howTitle")}</h2>
      <ol className="grid gap-4 md:grid-cols-3">
        {steps.map((s, i) => (
          <li key={i} data-reveal style={{ transitionDelay: `${i * 140}ms` }} className="grid gap-4 content-start">
            <span className="size-14 grid place-items-center rounded-[2px] font-display text-3xl font-bold num" style={{ background: MUSTARD, color: TEAL }}>{i + 1}</span>
            <span className="text-xl font-semibold leading-snug max-w-[24ch]">{s}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

function Cafe({ catalog }: { catalog: Catalog | null }) {
  const { t, n, money } = useI18n();
  const items = (catalog?.items ?? []).filter((i) => i.available).slice(0, 6);
  if (catalog && !items.length) return null;
  return (
    <section className="border-t-2 border-line">
      <div className="mx-auto max-w-6xl py-20 grid gap-8" style={gutter}>
        <div data-reveal className="flex flex-wrap items-end justify-between gap-4">
          <h2 className="font-display font-bold text-[clamp(36px,6vw,64px)] leading-tight">{t("l.cafeTitle")}</h2>
          <a href="/menu" className="h-11 px-4 inline-flex items-center rounded-[2px] font-semibold border-2 border-strong">{t("l.fullMenu")}</a>
        </div>
        <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
          {(items.length ? items : Array.from({ length: 6 }, () => null)).map((it, i) =>
            it ? (
              <a key={it.id} href="/menu" data-reveal style={{ transitionDelay: `${(i % 3) * 80}ms` }} className="group flex items-center gap-4 bg-surface border-2 border-line hover:border-strong hover:-translate-y-1 transition-transform rounded-[2px] p-3">
                {it.image_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={it.image_url} alt="" className="size-16 object-cover rounded-[2px]" loading="lazy" />
                ) : (
                  <span aria-hidden className="size-16 shrink-0 rounded-[2px] tile-pattern" />
                )}
                <span className="grid min-w-0">
                  <span className="font-semibold truncate">{n(it)}</span>
                  <span className="num text-muted">{money(it.price)}</span>
                </span>
              </a>
            ) : (
              <span key={i} className="h-[88px] bg-surface-2 rounded-[2px] animate-pulse" />
            ),
          )}
        </div>
      </div>
    </section>
  );
}

function Visit() {
  const { t } = useI18n();
  return (
    <section style={{ background: TEAL, color: SAGE }}>
      <div className="tile-stripe" aria-hidden />
      <div className="mx-auto max-w-6xl py-20 grid gap-8 lg:grid-cols-2 items-center" style={gutter}>
        <div data-reveal className="grid gap-4">
          <h2 className="font-display font-bold text-[clamp(40px,7vw,80px)] leading-[1]">{t("l.visitTitle")}</h2>
          <p className="text-lg max-w-[40ch]" style={{ color: `${SAGE}cc` }}>{t("l.visitLede")}</p>
          <p className="font-semibold" style={{ color: MUSTARD }}>{t("l.openLate")}</p>
        </div>
        <div className="grid gap-3">
          <a href={`tel:${VENUE.phone}`} className="flex items-center justify-between gap-4 rounded-[2px] border-2 p-5 hover:bg-white/5" style={{ borderColor: `${SAGE}55` }}>
            <span className="grid">
              <span className="text-sm" style={{ color: `${SAGE}aa` }}>{t("l.call")}</span>
              <span className="num text-[clamp(20px,5.4vw,40px)] font-bold whitespace-nowrap">{VENUE.phoneDisplay}</span>
            </span>
            <span className="size-14 grid place-items-center rounded-full transition-transform hover:scale-110" style={{ background: MUSTARD, color: TEAL, boxShadow: `0 0 0 0 ${MUSTARD}` }}><span className="live-pulse inline-flex"><PhoneIcon big /></span></span>
          </a>
          <a href={VENUE.mapUrl} target="_blank" rel="noreferrer" className="flex items-center justify-between gap-4 rounded-[2px] border-2 p-5 hover:bg-white/5" style={{ borderColor: `${SAGE}55` }}>
            <span className="text-2xl font-bold">{t("l.directions")}</span>
            <span className="size-14 grid place-items-center rounded-full border-2" style={{ borderColor: SAGE }}><PinIcon big /></span>
          </a>
        </div>
      </div>
    </section>
  );
}

function PhoneIcon({ big }: { big?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className={big ? "size-7" : "size-5"} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.5c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.8 2.1z" />
    </svg>
  );
}

function PinIcon({ big }: { big?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className={big ? "size-7" : "size-5"} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 22s7-6.2 7-12a7 7 0 1 0-14 0c0 5.8 7 12 7 12z" />
      <circle cx="12" cy="10" r="2.5" />
    </svg>
  );
}
