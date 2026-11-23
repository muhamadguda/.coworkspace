"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { cx } from "@/components/ui";

/**
 * Sticky jump links for long staff pages. Sits under the staff header (its height is in --staff-hdr,
 * set by Shell), highlights the section on screen, and never touches location.hash (that holds the tab).
 */
export type NavItem = { id: string; label: string };

const BAR_H = 52;
let ro: ResizeObserver | null = null;

/** Ref callback for the staff header: keeps --staff-hdr equal to its height. */
export function trackHeaderHeight(el: HTMLElement | null) {
  ro?.disconnect();
  ro = null;
  if (!el || typeof ResizeObserver === "undefined") return;
  const set = () => document.documentElement.style.setProperty("--staff-hdr", `${el.offsetHeight}px`);
  ro = new ResizeObserver(set);
  ro.observe(el);
  set();
}

const offset = () => (parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--staff-hdr")) || 0) + BAR_H + 8;

export function NavSection({ id, children, className }: { id: string; children: ReactNode; className?: string }) {
  return <section id={id} className={cx("min-w-0", className)}>{children}</section>;
}

export function SectionNav({ items, label }: { items: NavItem[]; label: string }) {
  const [active, setActive] = useState(items[0]?.id);
  const bar = useRef<HTMLDivElement>(null);
  const lock = useRef<string | null>(null);
  const ids = items.map((i) => i.id).join("|");

  // Scroll-spy: the last section whose top has passed under the bar. A tap pins its section until the user scrolls by hand.
  useEffect(() => {
    const list = ids.split("|");
    let raf = 0;
    const spy = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        if (lock.current) return setActive(lock.current);
        const top = offset();
        let cur = list[0];
        for (const id of list) {
          const el = document.getElementById(id);
          if (el && el.getBoundingClientRect().top - top <= 2) cur = id;
        }
        const doc = document.documentElement;
        if (window.scrollY > 0 && window.innerHeight + window.scrollY >= doc.scrollHeight - 2) cur = list[list.length - 1];
        setActive(cur);
      });
    };
    const release = () => {
      lock.current = null;
    };
    spy();
    window.addEventListener("scroll", spy, { passive: true });
    window.addEventListener("resize", spy);
    for (const e of ["wheel", "touchstart", "keydown"]) window.addEventListener(e, release, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", spy);
      window.removeEventListener("resize", spy);
      for (const e of ["wheel", "touchstart", "keydown"]) window.removeEventListener(e, release);
    };
  }, [ids]);

  // Keep the highlighted chip visible inside the bar (scrollBy works the same in RTL and LTR).
  useEffect(() => {
    const b = bar.current;
    const chip = b?.querySelector<HTMLElement>(`[data-id="${CSS.escape(active ?? "")}"]`);
    if (!b || !chip) return;
    const c = b.getBoundingClientRect();
    const r = chip.getBoundingClientRect();
    if (r.left < c.left) b.scrollBy({ left: r.left - c.left - 16 });
    else if (r.right > c.right) b.scrollBy({ left: r.right - c.right + 16 });
  }, [active]);

  if (items.length < 2) return null;

  const go = (id: string) => {
    const el = document.getElementById(id);
    if (!el) return;
    lock.current = id;
    setActive(id);
    const smooth = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - offset() + 2, behavior: smooth ? "smooth" : "auto" });
  };

  return (
    <nav
      aria-label={label}
      className="sticky z-20 bg-bg border-b-2 border-line print:hidden"
      style={{ top: "var(--staff-hdr, 0px)", marginInline: "calc(-1 * max(16px, env(safe-area-inset-left, 0px)))" }}
    >
      <div ref={bar} className="no-scrollbar flex gap-2 overflow-x-auto py-2 w-0 min-w-full" style={{ paddingInline: "max(16px, env(safe-area-inset-left, 0px))", height: BAR_H }}>
        {items.map((x) => (
          <button
            key={x.id}
            data-id={x.id}
            type="button"
            onClick={() => go(x.id)}
            aria-current={active === x.id ? "true" : undefined}
            className={cx(
              "h-9 shrink-0 px-3 inline-flex items-center rounded-full border-2 text-sm font-semibold whitespace-nowrap transition-colors",
              active === x.id ? "bg-strong text-bg border-strong" : "bg-surface border-line text-ink hover:border-strong",
            )}
          >
            {x.label}
          </button>
        ))}
      </div>
    </nav>
  );
}
