"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useI18n } from "@/lib/i18n";
import { rpc } from "@/lib/supabase";
import { rateFor } from "@/lib/pricing";
import type { Catalog } from "@/lib/types";
import type { DictKey } from "@/lib/dict";
import { LangSwitch, Logo, cx } from "@/components/ui";
import type { DioramaInput } from "./Diorama";
import { VENUE } from "./config";

// three.js loads after the page is interactive; the story reads fine before it arrives.
const Diorama = dynamic(() => import("./Diorama").then((m) => m.Diorama), { ssr: false });

// The page is one day at dot. Scrolling (or dragging along the timeline) moves the clock
// from morning to 3 AM: the sun crosses a 3D model of the place, shadows move, the rooms
// light up at night, and the word on screen changes with the hour.
const TEAL = "#173a39";
const NIGHT = "#081716";
const SAGE = "#eaf0ea";
const MUSTARD = "#d9a21b";
const SCENES = [1, 2, 3, 4, 5, 6] as const;

export function Landing() {
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

  return (
    <div style={{ background: NIGHT, color: SAGE, overflowX: "clip" }}>
      <Day catalog={catalog} />
      <Doors />
      <Floor catalog={catalog} />
      <Board catalog={catalog} />
      <Call />
    </div>
  );
}

const gutter = { paddingInline: "max(20px, env(safe-area-inset-left, 0px))" } as const;

// ---------------------------------------------------------------- the day (scroll story over the 3D model)
function Day({ catalog }: { catalog: Catalog | null }) {
  const { t, dir } = useI18n();
  const section = useRef<HTMLElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const input = useRef<DioramaInput>({ progress: 0, busy: [] });
  const [p, setP] = useState(0);
  const dragging = useRef(false);

  useEffect(() => {
    input.current.busy = (catalog?.places ?? []).filter((x) => x.kind === "room").map((x) => !!x.busy);
  }, [catalog]);

  useEffect(() => {
    let raf = 0;
    const read = () => {
      raf = 0;
      const el = section.current;
      if (!el) return;
      const span = el.offsetHeight - window.innerHeight;
      const q = Math.min(1, Math.max(0, -el.getBoundingClientRect().top / Math.max(1, span)));
      input.current.progress = q;
      setP(q);
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(read);
    };
    read();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      cancelAnimationFrame(raf);
    };
  }, []);

  const scrollTo = useCallback((q: number, smooth = false) => {
    const el = section.current;
    if (!el) return;
    const top = el.getBoundingClientRect().top + window.scrollY;
    window.scrollTo({ top: top + Math.min(1, Math.max(0, q)) * (el.offsetHeight - window.innerHeight), behavior: smooth ? "smooth" : "auto" });
  }, []);

  const scrub = (clientX: number) => {
    const r = track.current?.getBoundingClientRect();
    if (!r) return;
    let q = (clientX - r.left) / r.width;
    if (dir === "rtl") q = 1 - q;
    scrollTo(q);
  };

  const scene = Math.min(5, Math.floor(p * 6));
  const n = SCENES[scene];
  const dark = p > 0.52;
  const fg = dark ? SAGE : TEAL;
  const minutes = Math.round((9 + p * 18) * 60); // 09:00 → 03:00
  const clock = `${String(Math.floor(minutes / 60) % 24).padStart(2, "0")}:${String(Math.floor((minutes % 60) / 15) * 15).padStart(2, "0")}`;

  return (
    <section ref={section} className="relative h-[560vh]" aria-label={t("l.dayTitle")}>
      <div className="sticky top-0 h-dvh overflow-hidden select-none" style={{ background: dark ? NIGHT : "#dfe9e1" }}>
        <Diorama input={input} className="absolute inset-0" />

        {/* top bar */}
        <div className="absolute inset-x-0 top-0 flex items-center justify-between gap-3 py-4 pointer-events-none" style={{ ...gutter, paddingTop: "max(16px, env(safe-area-inset-top, 0px))", color: fg }}>
          <Logo light={dark} className="h-9" />
          <div className="flex items-center gap-2 pointer-events-auto">
            <a href="/menu" className="h-9 px-4 inline-flex items-center rounded-full border-2 text-sm font-semibold border-current">{t("c.nav.menu")}</a>
            <LangSwitch className="!bg-transparent !text-current !border-current !rounded-full" />
          </div>
        </div>

        {/* the word + the clock, over the sky */}
        <div className="absolute inset-x-0 top-[12%] flex flex-wrap items-start justify-between gap-6 pointer-events-none" style={{ ...gutter, color: fg }}>
          <div className="grid gap-2 max-w-[min(92vw,900px)]">
            <span className="text-xs sm:text-sm font-semibold uppercase tracking-[0.3em] opacity-70">{t("l.dayTitle")}</span>
            <h1 className="font-display font-bold leading-[0.82] tracking-tight text-[clamp(84px,17vw,260px)]">
              <span key={n} className="word-in">{t(`l.s${n}` as DictKey)}</span>
            </h1>
            <p key={`b${n}`} className="word-in max-w-[32ch] text-lg sm:text-2xl leading-snug font-medium" style={{ animationDelay: "90ms", textShadow: dark ? "0 1px 12px rgba(0,0,0,.6)" : "0 1px 12px rgba(255,255,255,.5)" }}>
              {t(`l.s${n}b` as DictKey)}
            </p>
          </div>
          <div className="text-end hidden sm:block">
            <div className="num font-semibold leading-none tracking-tight text-[clamp(40px,7vw,104px)]">{clock}</div>
            <div className="text-xs font-semibold uppercase tracking-[0.3em] opacity-70">{t(`l.t${n}` as DictKey)}</div>
          </div>
        </div>

        {/* timeline scrubber, over the floor */}
        <div className="absolute inset-x-0 bottom-0 pt-10 pb-[max(18px,env(safe-area-inset-bottom,0px))]" style={{ ...gutter, background: `linear-gradient(to top, ${NIGHT}e6, transparent)`, color: SAGE }}>
          <div className="flex items-center justify-between gap-4 mb-3">
            <span className="num text-2xl font-semibold sm:hidden">{clock}</span>
            <span className="text-xs font-semibold uppercase tracking-[0.25em] opacity-70">{p < 0.02 ? `↓ ${t("l.dragHint")}` : t(`l.t${n}` as DictKey)}</span>
          </div>
          <div
            ref={track}
            role="slider"
            tabIndex={0}
            aria-label={t("l.dayTitle")}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(p * 100)}
            aria-valuetext={clock}
            className="relative h-10 cursor-grab active:cursor-grabbing touch-none"
            onPointerDown={(e) => {
              dragging.current = true;
              (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
              scrub(e.clientX);
            }}
            onPointerMove={(e) => dragging.current && scrub(e.clientX)}
            onPointerUp={() => (dragging.current = false)}
            onKeyDown={(e) => {
              if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
              e.preventDefault();
              const fwd = (e.key === "ArrowRight") !== (dir === "rtl");
              scrollTo(Math.min(1, Math.max(0, (scene + (fwd ? 1 : -1)) / 6 + 0.02)), true);
            }}
          >
            <span className="absolute inset-x-0 top-1/2 h-[3px] -translate-y-1/2 rounded-full" style={{ background: `${SAGE}33` }} />
            <span className="absolute top-1/2 h-[3px] -translate-y-1/2 rounded-full start-0" style={{ width: `${p * 100}%`, background: MUSTARD }} />
            {SCENES.map((k, i) => (
              <span key={k} className="absolute top-1/2 size-2 -translate-y-1/2 rounded-full" style={{ insetInlineStart: `calc(${(i / 6) * 100}% - 4px)`, background: i <= scene ? MUSTARD : `${SAGE}55` }} />
            ))}
            <span
              className="absolute top-1/2 size-7 -translate-y-1/2 rounded-full shadow-[0_0_24px_rgba(217,162,27,0.8)]"
              style={{ insetInlineStart: `calc(${p * 100}% - 14px)`, background: MUSTARD }}
            />
          </div>
          <div className="grid grid-cols-6 text-[11px] sm:text-xs font-semibold">
            {SCENES.map((k, i) => (
              <button key={k} type="button" onClick={() => scrollTo(i / 6 + 0.02, true)} className={cx("text-start py-1 transition-opacity", i === scene ? "opacity-100" : "opacity-45 hover:opacity-80")}>
                {t(`l.t${k}` as DictKey)}
              </button>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- two doors in
function Doors() {
  const { t } = useI18n();
  const doors = [
    { href: "/menu", label: t("l.menu"), sub: t("l.scanLede"), fill: MUSTARD },
    { href: "/menu?tab=book", label: t("l.book"), sub: t("l.roomsLede"), fill: SAGE },
  ];
  return (
    <section style={{ background: NIGHT }}>
      {doors.map((d) => (
        <a key={d.href} href={d.href} className="group relative block overflow-hidden border-t border-white/10" style={gutter}>
          <span aria-hidden className="absolute inset-0 origin-bottom scale-y-0 transition-transform duration-500 ease-out group-hover:scale-y-100 group-focus-visible:scale-y-100" style={{ background: d.fill }} />
          <span className="relative mx-auto max-w-7xl flex flex-wrap items-end justify-between gap-x-10 gap-y-3 py-10 sm:py-16 transition-colors duration-500 group-hover:text-[#173a39] group-focus-visible:text-[#173a39]">
            <span className="font-display font-bold leading-none text-[clamp(44px,9vw,136px)]">
              {d.label}
              <span aria-hidden className="inline-block ms-4 transition-transform duration-500 group-hover:translate-x-3 rtl:group-hover:-translate-x-3 rtl:-scale-x-100">→</span>
            </span>
            <span className="max-w-[34ch] text-base sm:text-lg opacity-75 pb-2">{d.sub}</span>
          </span>
        </a>
      ))}
    </section>
  );
}

// ---------------------------------------------------------------- the floor (live rooms + prices)
function Floor({ catalog }: { catalog: Catalog | null }) {
  const { t, n, money } = useI18n();
  const rooms = useMemo(() => catalog?.places.filter((p) => p.kind === "room") ?? [], [catalog]);
  const tables = useMemo(() => catalog?.places.filter((p) => p.kind === "table") ?? [], [catalog]);
  const [sel, setSel] = useState<string | null>(null);
  const room = rooms.find((r) => r.id === sel) ?? rooms[0];
  const pattern = `radial-gradient(circle at 0 0, ${SAGE}12 0 20%, transparent 20.5%), radial-gradient(circle at 100% 0, ${SAGE}12 0 20%, transparent 20.5%), radial-gradient(circle at 0 100%, ${SAGE}12 0 20%, transparent 20.5%), radial-gradient(circle at 100% 100%, ${SAGE}12 0 20%, transparent 20.5%)`;

  return (
    <section style={{ background: TEAL, color: SAGE }}>
      <div className="mx-auto max-w-7xl py-20 sm:py-28 grid gap-10 lg:grid-cols-[1.4fr_1fr] items-start" style={gutter}>
        <div className="grid gap-6">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <h2 className="font-display font-bold text-[clamp(52px,9vw,128px)] leading-[0.85]">{t("l.floorTitle")}</h2>
            <p className="max-w-[34ch] opacity-75">{t("l.floorLede")}</p>
          </div>
          <div className="grid gap-[6px] p-[6px] rounded-[2px]" style={{ gridTemplateColumns: `repeat(${Math.max(rooms.length, 3)}, minmax(0, 1fr))`, background: "#0f2a29", backgroundImage: pattern, backgroundSize: "40px 40px" }}>
            {(rooms.length ? rooms : [null, null, null]).map((r, i) =>
              r ? (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => setSel(r.id)}
                  aria-pressed={room?.id === r.id}
                  className={cx("aspect-[4/5] sm:aspect-[5/4] rounded-[2px] border-2 p-3 text-start grid content-between transition-all duration-300", room?.id === r.id ? "scale-[1.03] shadow-[0_0_0_4px_rgba(217,162,27,0.25)]" : "hover:scale-[1.015]")}
                  style={{ borderColor: room?.id === r.id ? MUSTARD : r.busy ? "#f0756c" : "#4cc38a", background: r.busy ? "rgba(240,117,108,0.14)" : "rgba(76,195,138,0.12)" }}
                >
                  <span className="font-display text-xl sm:text-3xl font-bold">{n(r)}</span>
                  <span className="flex items-center gap-2 text-xs sm:text-sm font-semibold">
                    <span className="live-pulse size-2.5 rounded-full" style={{ background: r.busy ? "#f0756c" : "#4cc38a" }} />
                    {r.busy ? t("common.inUse") : t("common.free")}
                  </span>
                </button>
              ) : (
                <span key={i} className="aspect-[4/5] sm:aspect-[5/4] rounded-[2px] bg-white/5 animate-pulse" />
              ),
            )}
            <div className="col-span-full grid grid-cols-6 gap-2 py-7 px-2">
              {(tables.length ? tables : Array.from({ length: 6 }, () => null)).slice(0, 12).map((tb, i) => (
                <span key={tb?.id ?? i} className="grid place-items-center">
                  <span className="size-8 sm:size-10 rounded-full border-2" style={{ borderColor: tb?.busy ? "#f0756c" : `${SAGE}55`, background: tb?.busy ? "rgba(240,117,108,0.25)" : "transparent" }} />
                </span>
              ))}
              <span className="col-span-full text-center text-[11px] uppercase tracking-[0.3em] opacity-50">{t("l.tablesZone")}</span>
            </div>
            <div className="col-span-full h-10 rounded-[2px] grid place-items-center text-[11px] uppercase tracking-[0.3em] font-semibold" style={{ background: MUSTARD, color: TEAL }}>{t("l.counterZone")}</div>
          </div>
        </div>

        <div className="lg:sticky lg:top-10 grid gap-5 border-t-2 lg:border-t-0 lg:border-s-2 pt-6 lg:pt-0 lg:ps-10" style={{ borderColor: `${SAGE}33` }}>
          <span className="text-xs uppercase tracking-[0.3em] opacity-60">{t("l.pickRoom")}</span>
          <h3 key={room?.id} className="word-in font-display font-bold text-6xl">{room ? n(room) : "…"}</h3>
          <ul className="grid">
            {(catalog?.modes ?? []).map((m) => (
              <li key={m.id} className="flex items-baseline gap-3 py-3 border-b" style={{ borderColor: `${SAGE}22` }}>
                <span className="font-semibold">{n(m)}</span>
                <span aria-hidden className="flex-1 border-b-2 border-dotted -translate-y-1" style={{ borderColor: `${SAGE}40` }} />
                <span className="num font-bold text-xl whitespace-nowrap">
                  {catalog ? money(rateFor(catalog.modes, catalog.mode_prices, room?.id, m.id)) : ""}
                  <span className="text-sm font-medium opacity-60">{t("common.perHour")}</span>
                </span>
              </li>
            ))}
          </ul>
          <a href="/menu?tab=book" className="justify-self-start h-14 px-7 inline-flex items-center rounded-full font-bold text-lg transition-transform hover:scale-[1.04]" style={{ background: MUSTARD, color: TEAL }}>
            {t("l.bookThis")}
          </a>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- the menu board
function Board({ catalog }: { catalog: Catalog | null }) {
  const { t, n, money } = useI18n();
  const items = (catalog?.items ?? []).filter((i) => i.available).slice(0, 10);
  return (
    <section style={{ background: SAGE, color: TEAL }}>
      <div className="mx-auto max-w-7xl py-20 sm:py-28 grid gap-12 lg:grid-cols-[1fr_1.2fr] items-start" style={gutter}>
        <div className="grid content-start gap-6">
          <h2 className="font-display font-bold text-[clamp(52px,8.5vw,120px)] leading-[0.88]">{t("l.scanTitle")}</h2>
          <p className="text-lg max-w-[38ch] opacity-80">{t("l.scanLede")}</p>
          <ScanTile />
        </div>
        <div className="rounded-[4px] p-6 sm:p-10 -rotate-[0.6deg] shadow-[0_30px_60px_-30px_rgba(8,23,22,0.6)]" style={{ background: TEAL, color: SAGE }}>
          <div className="flex items-baseline justify-between gap-4 mb-6">
            <h3 className="font-display text-3xl font-bold">{t("l.boardTitle")}</h3>
            <a href="/menu" className="text-sm font-semibold underline underline-offset-4" style={{ textDecorationColor: MUSTARD }}>{t("l.fullMenu")}</a>
          </div>
          <ul className="grid">
            {(items.length ? items : Array.from({ length: 8 }, () => null)).map((it, i) =>
              it ? (
                <li key={it.id} className="flex items-baseline gap-3 py-3">
                  <span className="text-lg font-semibold">{n(it)}</span>
                  <span aria-hidden className="flex-1 border-b-2 border-dotted -translate-y-1" style={{ borderColor: `${SAGE}35` }} />
                  <span className="num text-lg font-bold" style={{ color: MUSTARD }}>{money(it.price)}</span>
                </li>
              ) : (
                <li key={i} className="h-11 my-1 rounded-[2px] bg-white/5 animate-pulse" />
              ),
            )}
          </ul>
        </div>
      </div>
    </section>
  );
}

/** The code on every table, made of dots; it reshuffles when you touch it. */
function ScanTile() {
  const [seed, setSeed] = useState(7);
  const cells = useMemo(
    () =>
      Array.from({ length: 49 }, (_, i) => {
        const r = Math.floor(i / 7), c = i % 7;
        const finder = (r < 2 && c < 2) || (r < 2 && c > 4) || (r > 4 && c < 2);
        const h = Math.sin((i + 1) * 12.9898 + seed * 78.233) * 43758.5453;
        return finder || h - Math.floor(h) > 0.48;
      }),
    [seed],
  );
  return (
    <button type="button" aria-hidden tabIndex={-1} onPointerEnter={() => setSeed((s) => s + 1)} onClick={() => setSeed((s) => s + 1)} className="justify-self-start grid grid-cols-7 gap-1.5 p-4 rounded-[4px] rotate-[1.5deg] transition-transform hover:rotate-0" style={{ background: TEAL }}>
      {cells.map((on, i) => (
        <span key={i} className="size-5 sm:size-7 rounded-full transition-all duration-300" style={{ background: on ? (i % 11 === 0 ? MUSTARD : SAGE) : "transparent", transform: on ? "scale(1)" : "scale(0.3)", transitionDelay: `${(i % 7) * 18}ms` }} />
      ))}
    </button>
  );
}

// ---------------------------------------------------------------- the ending
function Call() {
  const { t } = useI18n();
  return (
    <section style={{ background: NIGHT, color: SAGE }}>
      <div className="mx-auto max-w-7xl pt-24 pb-10 grid gap-8" style={gutter}>
        <span className="text-xs uppercase tracking-[0.3em] opacity-60">{t("l.visitTitle")} · {t("l.openLate")}</span>
        <a href={`tel:${VENUE.phone}`} className="group block num font-bold leading-none tracking-tight text-[clamp(40px,10.5vw,170px)] whitespace-nowrap" dir="ltr">
          <span className="inline-block transition-colors duration-300 group-hover:text-[#d9a21b]">{VENUE.phoneDisplay}</span>
        </a>
        <div className="flex flex-wrap gap-3">
          <a href={`tel:${VENUE.phone}`} className="h-14 px-7 inline-flex items-center rounded-full font-bold text-lg" style={{ background: MUSTARD, color: TEAL }}>{t("l.call")}</a>
          <a href={VENUE.mapUrl} target="_blank" rel="noreferrer" className="h-14 px-7 inline-flex items-center rounded-full font-bold text-lg border-2" style={{ borderColor: SAGE }}>{t("l.directions")} ↗</a>
        </div>
        <div className="mt-16 pt-6 border-t flex flex-wrap items-center justify-between gap-3 text-sm opacity-70" style={{ borderColor: `${SAGE}22`, paddingBottom: "env(safe-area-inset-bottom, 0px)" }}>
          <span className="flex items-center gap-3"><Logo light className="h-6" /> dotcowork.space</span>
          <a href="/staff" className="underline">{t("l.staff")}</a>
        </div>
      </div>
    </section>
  );
}
