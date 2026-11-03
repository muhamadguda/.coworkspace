"use client";

import { useCallback, useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { rpc } from "@/lib/supabase";
import type { Catalog } from "@/lib/types";
import { LangSwitch, Logo, cx } from "@/components/ui";
import { getQrPlace, setQrPlace, type QrPlace } from "./local";
import { MenuView } from "./MenuView";
import { BillView } from "./BillView";
import { BookView } from "./BookView";

type Tab = "menu" | "bill" | "book";

export function CustomerApp() {
  const { t, n } = useI18n();
  const [tab, setTab] = useState<Tab>("menu");
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [place, setPlace] = useState<QrPlace | null>(null);

  const load = useCallback(async () => {
    try {
      const c = await rpc<Catalog>("public_catalog");
      setCatalog(c);
      setLoadError(false);
    } catch {
      setLoadError(true);
    }
  }, []);

  useEffect(() => {
    void load();
    const id = setInterval(load, 45_000);
    return () => clearInterval(id);
  }, [load]);

  // QR codes open /?t=<token>. Resolve it, remember it, and clean the URL.
  useEffect(() => {
    const url = new URL(window.location.href);
    const token = url.searchParams.get("t");
    const tabParam = url.searchParams.get("tab");
    if (tabParam === "bill" || tabParam === "book") setTab(tabParam);
    if (!token) {
      setPlace(getQrPlace());
      return;
    }
    rpc<{ id: string; kind: "room" | "table"; name_ar: string; name_en: string } | null>("place_by_token", { p_token: token })
      .then((p) => {
        if (p) {
          const qp: QrPlace = { token, ...p, at: Date.now() };
          setQrPlace(qp);
          setPlace(qp);
        } else setPlace(getQrPlace());
      })
      .catch(() => setPlace(getQrPlace()))
      .finally(() => {
        url.searchParams.delete("t");
        window.history.replaceState(null, "", url.pathname + (url.search ? url.search : ""));
      });
  }, []);

  const tabs: { id: Tab; label: string }[] = [
    { id: "menu", label: t("c.nav.menu") },
    { id: "bill", label: t("c.nav.bill") },
    { id: "book", label: t("c.nav.book") },
  ];

  return (
    <div className="min-h-dvh flex flex-col">
      <header className="tile-stripe sticky top-0 z-30 bg-bg/95 backdrop-blur border-b-2 border-line" style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}>
        <div className="mx-auto max-w-3xl flex items-center justify-between gap-3 py-3" style={{ paddingInline: "max(16px, env(safe-area-inset-left, 0px))" }}>
          <div className="flex items-center gap-3 min-w-0">
            <Logo className="h-8" />
            <span className="text-sm text-muted truncate hidden sm:inline">{t("app.tagline")}</span>
          </div>
          <LangSwitch />
        </div>
        <nav className="mx-auto max-w-3xl flex gap-1" style={{ paddingInline: "max(16px, env(safe-area-inset-left, 0px))" }} aria-label="Sections">
          {tabs.map((x) => (
            <button
              key={x.id}
              type="button"
              onClick={() => setTab(x.id)}
              aria-current={tab === x.id ? "page" : undefined}
              className={cx(
                "flex-1 sm:flex-none h-11 px-4 text-[15px] font-semibold border-b-4 -mb-[2px]",
                tab === x.id ? "border-accent text-ink" : "border-transparent text-muted hover:text-ink",
              )}
            >
              {x.label}
            </button>
          ))}
        </nav>
      </header>

      {place && tab === "menu" ? (
        <div className="bg-strong text-bg">
          <div className="mx-auto max-w-3xl py-2 text-sm font-semibold flex items-center justify-between gap-3" style={{ paddingInline: "max(16px, env(safe-area-inset-left, 0px))" }}>
            <span>{t("c.orderingFrom", { place: n(place) })}</span>
          </div>
        </div>
      ) : null}

      <main className="flex-1 mx-auto w-full max-w-3xl py-5" style={{ paddingInline: "max(16px, env(safe-area-inset-left, 0px))" }}>
        {loadError && !catalog ? (
          <div className="grid gap-3 place-items-center py-16 text-center">
            <p className="text-muted">{t("err.network")}</p>
            <button type="button" className="underline font-semibold" onClick={load}>
              {t("common.retry")}
            </button>
          </div>
        ) : !catalog ? (
          <MenuSkeleton />
        ) : tab === "menu" ? (
          <MenuView catalog={catalog} place={place} onRefresh={load} />
        ) : tab === "bill" ? (
          <BillView />
        ) : (
          <BookView catalog={catalog} />
        )}
      </main>

      <footer className="border-t-2 border-line">
        <div className="mx-auto max-w-3xl py-5 text-sm text-muted flex flex-wrap gap-x-6 gap-y-1 justify-between" style={{ paddingInline: "max(16px, env(safe-area-inset-left, 0px))", paddingBottom: "max(20px, env(safe-area-inset-bottom, 0px))" }}>
          <span>{catalog?.settings.venue_address || t("app.tagline")}</span>
          {catalog?.settings.venue_whatsapp ? (
            <a className="num underline" href={`https://wa.me/${catalog.settings.venue_whatsapp.replace(/\D/g, "").replace(/^0/, "20")}`} target="_blank" rel="noreferrer">
              {t("c.footer.whatsapp")} {catalog.settings.venue_whatsapp}
            </a>
          ) : null}
        </div>
      </footer>
    </div>
  );
}

function MenuSkeleton() {
  return (
    <div className="grid gap-3" aria-busy="true">
      <div className="h-10 w-2/3 bg-surface-2 rounded-[2px] animate-pulse" />
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="h-24 bg-surface-2 rounded-[2px] animate-pulse" />
      ))}
    </div>
  );
}
