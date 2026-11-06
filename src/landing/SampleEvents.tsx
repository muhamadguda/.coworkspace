"use client";

import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { EventsNotify } from "@/components/EventsNotify";

// The kind of nights dot hosts. Photos are free-licensed from Wikimedia Commons; each card
// credits its photographer and license (CC BY / BY-SA need it; public domain gets it anyway).
const W = "https://upload.wikimedia.org/wikipedia/commons/thumb";
const C = "https://commons.wikimedia.org/wiki/File:";
const NIGHTS = [
  { ar: "ليلة باربكيو", en: "Barbecue night", whenAr: "كل جمعة · 7 م", whenEn: "Fridays · 7 PM", img: `${W}/a/af/02015_Grillen_auf_offenem_Feuer.jpg/960px-02015_Grillen_auf_offenem_Feuer.jpg`, by: "Silar", lic: "CC BY-SA 4.0", page: `${C}02015_Grillen_auf_offenem_Feuer.jpg` },
  { ar: "جام سيشن", en: "Jam session", whenAr: "كل أربع · 9 م", whenEn: "Wednesdays · 9 PM", img: `${W}/1/16/Jazz_jam_session_at_Jazz_Up_Music_Camp_2021%2C_27_September_2021.jpg/960px-Jazz_jam_session_at_Jazz_Up_Music_Camp_2021%2C_27_September_2021.jpg`, by: "FingerWiki", lic: "CC BY 4.0", page: `${C}Jazz_jam_session_at_Jazz_Up_Music_Camp_2021,_27_September_2021.jpg` },
  { ar: "معرض فني", en: "Art exhibit", whenAr: "افتتاح كل شهر", whenEn: "A new opening every month", img: `${W}/9/90/Dani_Dodge_Exhibition_at_Black_Rock_Art_Gallery_%2854378560175%29.jpg/960px-Dani_Dodge_Exhibition_at_Black_Rock_Art_Gallery_%2854378560175%29.jpg`, by: "Joshua Tree National Park", lic: "Public domain", page: `${C}Dani_Dodge_Exhibition_at_Black_Rock_Art_Gallery_(54378560175).jpg` },
  { ar: "ليلة ألعاب بورد", en: "Board game night", whenAr: "كل تلات · 8 م", whenEn: "Tuesdays · 8 PM", img: `${W}/e/ee/Family_playing_a_board_game.jpg/960px-Family_playing_a_board_game.jpg`, by: "Bill Branson", lic: "Public domain", page: `${C}Family_playing_a_board_game.jpg` },
  { ar: "بطولة بلايستيشن", en: "PlayStation tournament", whenAr: "آخر خميس في الشهر", whenEn: "Last Thursday of the month", img: `${W}/9/96/InclusiveGameLab_Person-with-PS5-Controller_02_CC-BY-SA.jpg/960px-InclusiveGameLab_Person-with-PS5-Controller_02_CC-BY-SA.jpg`, by: "InclusiveGameLab", lic: "CC BY-SA 4.0", page: `${C}InclusiveGameLab_Person-with-PS5-Controller_02_CC-BY-SA.jpg` },
  { ar: "نادي الشطرنج", en: "Chess club", whenAr: "كل سبت · 6 م", whenEn: "Saturdays · 6 PM", img: `${W}/5/57/Paris_-_Playing_chess_at_the_Jardins_du_Luxembourg_-_2966.jpg/960px-Paris_-_Playing_chess_at_the_Jardins_du_Luxembourg_-_2966.jpg`, by: "Jorge Royan", lic: "CC BY-SA 3.0", page: `${C}Paris_-_Playing_chess_at_the_Jardins_du_Luxembourg_-_2966.jpg` },
  { ar: "ليلة مسابقات", en: "Quiz night", whenAr: "كل حد · 8 م", whenEn: "Sundays · 8 PM", img: `${W}/3/37/Pub_Quiz_Night.jpg/960px-Pub_Quiz_Night.jpg`, by: "Hilary Murugu", lic: "CC BY-SA 4.0", page: `${C}Pub_Quiz_Night.jpg` },
  { ar: "ورشة لاتيه آرت", en: "Latte art workshop", whenAr: "مرتين في الشهر", whenEn: "Twice a month", img: `${W}/1/1f/Matcha_tea_latte_with_rosetta_latte_art.jpg/960px-Matcha_tea_latte_with_rosetta_latte_art.jpg`, by: "Irvan Ary Maulana", lic: "CC BY-SA 4.0", page: `${C}Matcha_tea_latte_with_rosetta_latte_art.jpg` },
];

const NIGHT = "#081716";
const SAGE = "#eaf0ea";
const MUSTARD = "#d9a21b";
const TEAL = "#173a39";

/** "Nights at dot": cards that swipe by themselves, stop when touched, and wait while off screen. */
export function SampleEvents() {
  const { t, lang } = useI18n();
  const track = useRef<HTMLUListElement>(null);
  const [active, setActive] = useState(0);
  const paused = useRef(false);
  const visible = useRef(false);

  // Which card is in view (drives the dots).
  useEffect(() => {
    const el = track.current;
    if (!el) return;
    const onScroll = () => {
      const card = el.firstElementChild as HTMLElement | null;
      if (!card) return;
      const step = card.offsetWidth + 16;
      setActive(Math.min(NIGHTS.length - 1, Math.round(Math.abs(el.scrollLeft) / step)));
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  // Auto-advance every 3.5 s while on screen; a touch, hover or keyboard focus pauses it.
  useEffect(() => {
    const el = track.current;
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const io = new IntersectionObserver(([e]) => (visible.current = e.isIntersecting), { threshold: 0.4 });
    io.observe(el);
    let resume: ReturnType<typeof setTimeout> | undefined;
    const hold = () => {
      paused.current = true;
      clearTimeout(resume);
      resume = setTimeout(() => (paused.current = false), 8000);
    };
    const events = ["pointerdown", "wheel", "touchstart", "focusin", "mouseenter"] as const;
    events.forEach((e) => el.addEventListener(e, hold, { passive: true }));
    const tick = setInterval(() => {
      if (paused.current || !visible.current || document.hidden) return;
      const card = el.firstElementChild as HTMLElement | null;
      if (!card) return;
      const dir = getComputedStyle(el).direction === "rtl" ? -1 : 1;
      const atEnd = Math.abs(el.scrollLeft) + el.clientWidth >= el.scrollWidth - 8;
      if (atEnd) el.scrollTo({ left: 0, behavior: "smooth" });
      else el.scrollBy({ left: dir * (card.offsetWidth + 16), behavior: "smooth" });
    }, 3500);
    return () => {
      io.disconnect();
      clearInterval(tick);
      clearTimeout(resume);
      events.forEach((e) => el.removeEventListener(e, hold));
    };
  }, []);

  function go(i: number) {
    const el = track.current;
    const card = el?.children[i] as HTMLElement | undefined;
    if (!el || !card) return;
    paused.current = true;
    setTimeout(() => (paused.current = false), 8000);
    const dir = getComputedStyle(el).direction === "rtl" ? -1 : 1;
    el.scrollTo({ left: dir * i * (card.offsetWidth + 16), behavior: "smooth" });
  }

  return (
    <section style={{ background: NIGHT, color: SAGE }} aria-roledescription="carousel" aria-label={t("l.nightsTitle")}>
      <div className="mx-auto max-w-7xl py-20 sm:py-28 grid gap-8" style={{ paddingInline: "max(20px, env(safe-area-inset-left, 0px))" }}>
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div className="grid gap-3">
            <span className="text-xs uppercase tracking-[0.3em] opacity-60">{t("l.nightsKicker")}</span>
            <h2 className="font-display font-bold text-[clamp(48px,8vw,112px)] leading-[0.88]">{t("l.nightsTitle")}</h2>
          </div>
          <p className="max-w-[36ch] opacity-75">{t("l.nightsLede")}</p>
        </div>

        <ul ref={track} className="no-scrollbar -mx-5 px-5 flex gap-4 overflow-x-auto snap-x snap-mandatory scroll-smooth pb-2" style={{ scrollPaddingInline: 20 }}>
          {NIGHTS.map((x, i) => (
            <li key={x.en} className="snap-start shrink-0 w-[82vw] sm:w-[420px]" aria-roledescription="slide" aria-label={`${i + 1} / ${NIGHTS.length}`}>
              <figure className="relative aspect-[4/3] overflow-hidden rounded-[4px] border-2 group" style={{ borderColor: `${SAGE}22`, background: TEAL }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={x.img}
                  alt={lang === "ar" ? x.ar : x.en}
                  loading={i < 2 ? "eager" : "lazy"}
                  decoding="async"
                  width={960}
                  height={640}
                  referrerPolicy="no-referrer"
                  onError={(e) => (e.currentTarget.style.display = "none")}
                  className="absolute inset-0 size-full object-cover saturate-[0.85] transition-transform duration-700 group-hover:scale-[1.04]"
                />
                {/* Brand wash: teal from the bottom, so the type always reads. */}
                <div aria-hidden className="absolute inset-0" style={{ background: `linear-gradient(to top, ${NIGHT}f0 0%, ${TEAL}99 38%, transparent 70%)` }} />
                <figcaption className="absolute inset-x-0 bottom-0 p-5 grid gap-2">
                  <span className="justify-self-start px-2.5 py-1 rounded-full text-xs font-bold" style={{ background: MUSTARD, color: TEAL }}>{lang === "ar" ? x.whenAr : x.whenEn}</span>
                  <span className="font-display text-3xl font-bold leading-tight">{lang === "ar" ? x.ar : x.en}</span>
                  <a href={x.page} target="_blank" rel="noreferrer" className="text-[10px] opacity-60 hover:opacity-100 underline-offset-2 hover:underline" dir="ltr">
                    Photo: {x.by} · {x.lic}
                  </a>
                </figcaption>
              </figure>
            </li>
          ))}
        </ul>

        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex gap-2" role="tablist" aria-label={t("l.nightsTitle")}>
            {NIGHTS.map((x, i) => (
              <button
                key={x.en}
                type="button"
                role="tab"
                aria-selected={active === i}
                aria-label={lang === "ar" ? x.ar : x.en}
                onClick={() => go(i)}
                className="size-3 rounded-full transition-all duration-300"
                style={{ background: active === i ? MUSTARD : `${SAGE}40`, transform: active === i ? "scale(1.25)" : "scale(1)" }}
              />
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <EventsNotify />
            <a href="/events" className="h-12 px-6 inline-flex items-center rounded-full font-bold transition-transform hover:scale-[1.04]" style={{ background: MUSTARD, color: TEAL }}>
              {t("l.allEvents")} {lang === "ar" ? "←" : "→"}
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
