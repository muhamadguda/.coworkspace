"use client";

import { useCallback, useEffect, useState } from "react";
import { useErrorText, useI18n } from "@/lib/i18n";
import { errorCode, rpc, supabase } from "@/lib/supabase";
import { round2 } from "@/lib/billing";
import { Button, Card, Field, Input, LangSwitch, Logo, Pill, Sheet, cx, useToast } from "@/components/ui";
import { AlertBar, useAlerts } from "./alerts";
import { audioReady, keepAwake, unlockAudio } from "./alarm";
import { currentBusinessDay } from "./derive";
import { clearLocal, dismissFailed, dispatch, getState, stopStore, useStaff } from "./store";
import { useIsOwner, useNow, useSnap } from "./hooks";
import { Board, type StartPreset } from "./views/Board";
import { OrdersView } from "./views/Orders";
import { BillsView } from "./views/Bills";
import { BookingsView } from "./views/Bookings";
import { CustomersView } from "./views/Customers";
import { DayView } from "./views/Day";
import { MenuAdmin } from "./owner/MenuAdmin";
import { SettingsAdmin } from "./owner/SettingsAdmin";
import { TeamAdmin } from "./owner/TeamAdmin";
import { Reports } from "./owner/Reports";

type Tab = "board" | "orders" | "bills" | "bookings" | "customers" | "day" | "menu" | "settings" | "team" | "reports";
const OWNER_TABS: Tab[] = ["menu", "settings", "team", "reports"];

export function Shell() {
  const { t } = useI18n();
  const snap = useSnap();
  const isOwner = useIsOwner();
  const [tab, setTab] = useState<Tab>(() => (location.hash.slice(1) as Tab) || "board");
  const [focus, setFocus] = useState<string | undefined>();
  const [boardKey, setBoardKey] = useState(0);
  const [shiftStarted, setShiftStarted] = useState(audioReady);
  const [preset, setPreset] = useState<StartPreset | null>(null);

  const goto = useCallback((x: string, f?: string) => {
    setTab(x as Tab);
    setFocus(f);
    if (f) setBoardKey((k) => k + 1);
    history.replaceState(null, "", `#${x}`);
    window.scrollTo({ top: 0 });
  }, []);

  useEffect(() => {
    const onStart = (e: Event) => {
      setPreset((e as CustomEvent<StartPreset>).detail);
      goto("board");
    };
    window.addEventListener("dot:start-session", onStart);
    return () => window.removeEventListener("dot:start-session", onStart);
  }, [goto]);

  const { alerts, muted, mute, unmute } = useAlerts(goto);
  const day = currentBusinessDay(snap, useNow(30000));
  const dayOpen = snap.cash_day?.business_day === day;

  if (!shiftStarted || !dayOpen) return <ShiftGate dayOpen={dayOpen} onStarted={() => setShiftStarted(true)} />;

  const newCount = snap.orders.filter((o) => o.status === "new").length;
  const pendingBookings = snap.bookings.filter((b) => b.status === "pending").length;
  const tabs: { id: Tab; label: string; badge?: number }[] = [
    { id: "board", label: t("s.nav.board") },
    { id: "orders", label: t("s.nav.orders"), badge: newCount },
    { id: "bills", label: t("s.nav.bills") },
    { id: "bookings", label: t("s.nav.bookings"), badge: pendingBookings },
    { id: "customers", label: t("s.nav.customers") },
    { id: "day", label: t("s.nav.day") },
    ...(isOwner
      ? ([
          { id: "menu", label: t("s.nav.menu") },
          { id: "settings", label: t("s.nav.settings") },
          { id: "team", label: t("s.nav.team") },
          { id: "reports", label: t("s.nav.reports") },
        ] as { id: Tab; label: string }[])
      : []),
  ];
  const active = !isOwner && OWNER_TABS.includes(tab) ? "board" : tab;

  return (
    <div className="min-h-dvh flex flex-col">
      <header className="tile-stripe sticky top-0 z-30 bg-bg border-b-2 border-line" style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}>
        <div className="flex items-center justify-between gap-3 py-2" style={{ paddingInline: "max(16px, env(safe-area-inset-left, 0px))" }}>
          <div className="flex items-center gap-3 min-w-0">
            <Logo className="h-7" />
            <span className="text-sm text-muted hidden md:inline num">{day}</span>
          </div>
          <div className="flex items-center gap-2">
            <SyncPill />
            <LangSwitch />
            <UserMenu />
          </div>
        </div>
        <nav className="flex gap-1 overflow-x-auto" style={{ paddingInline: "max(16px, env(safe-area-inset-left, 0px))" }}>
          {tabs.map((x) => (
            <button
              key={x.id}
              type="button"
              onClick={() => goto(x.id)}
              aria-current={active === x.id ? "page" : undefined}
              className={cx("h-11 px-3 shrink-0 text-[15px] font-semibold border-b-4 -mb-[2px] inline-flex items-center gap-2", active === x.id ? "border-accent" : "border-transparent text-muted hover:text-ink")}
            >
              {x.label}
              {x.badge ? <span className="num min-w-6 h-6 px-1.5 grid place-items-center rounded-full bg-busy text-white text-xs">{x.badge}</span> : null}
            </button>
          ))}
        </nav>
      </header>

      <main className="flex-1 grid gap-4 py-4 content-start" style={{ paddingInline: "max(16px, env(safe-area-inset-left, 0px))", paddingBottom: "max(24px, env(safe-area-inset-bottom, 0px))" }}>
        <FailedOps />
        <AlertBar alerts={alerts} muted={muted} onMute={mute} onUnmute={unmute} />
        {active === "board" && <Board key={boardKey} focus={focus} preset={preset} onPresetHandled={() => setPreset(null)} />}
        {active === "orders" && <OrdersView />}
        {active === "bills" && <BillsView />}
        {active === "bookings" && <BookingsView />}
        {active === "customers" && <CustomersView />}
        {active === "day" && <DayView />}
        {active === "menu" && <MenuAdmin />}
        {active === "settings" && <SettingsAdmin />}
        {active === "team" && <TeamAdmin />}
        {active === "reports" && <Reports />}
      </main>
    </div>
  );
}

function ShiftGate({ dayOpen, onStarted }: { dayOpen: boolean; onStarted: () => void }) {
  const { t, money } = useI18n();
  const snap = useSnap();
  const [float, setFloat] = useState(() => (snap.last_cash_day?.closing_counted != null ? String(snap.last_cash_day.closing_counted) : ""));

  function start() {
    unlockAudio();
    void keepAwake();
    if (!dayOpen) dispatch("open_day", { opening_float: round2(Number(float) || 0) });
    onStarted();
  }

  return (
    <div className="min-h-dvh grid place-items-center p-4">
      <Card className="w-full max-w-md p-6 grid gap-5 tile-stripe">
        <div className="flex items-center justify-between">
          <Logo className="h-9" />
          <div className="flex items-center gap-2">
            <SyncPill />
            <LangSwitch />
          </div>
        </div>
        {!dayOpen ? (
          <>
            <div className="grid gap-1">
              <h1 className="font-display text-2xl font-bold">{t("s.startDay.title")}</h1>
              <p className="text-sm text-muted">{t("s.startDay.hint")}</p>
            </div>
            <Field label={t("s.startDay.float")} hint={snap.last_cash_day?.closing_counted != null ? t("s.startDay.lastClose", { amount: money(snap.last_cash_day.closing_counted) }) : undefined}>
              <Input id="opening-float" numeric value={float} onChange={(e) => setFloat(e.target.value)} placeholder="0" />
            </Field>
            <Button variant="accent" size="lg" onClick={start} disabled={float === "" || Number.isNaN(Number(float))}>
              {t("s.startDay.submit")}
            </Button>
          </>
        ) : (
          <>
            <div className="grid gap-1">
              <h1 className="font-display text-2xl font-bold">{t("s.startShift")}</h1>
              <p className="text-sm text-muted">{t("s.startShiftHint")}</p>
            </div>
            <Button variant="accent" size="lg" onClick={start}>
              {t("s.startShift")}
            </Button>
          </>
        )}
        <p className="text-xs text-muted">{snap.me.name} · <span className="num">{snap.me.phone}</span></p>
      </Card>
    </div>
  );
}

function SyncPill() {
  const { t } = useI18n();
  const online = useStaff((s) => s.online);
  const pending = useStaff((s) => s.queue.filter((q) => q.state === "pending").length);
  if (!online) return <Pill tone="busy">{t("s.offline")}{pending ? ` · ${t("s.pendingSync", { n: pending })}` : ""}</Pill>;
  if (pending) return <Pill tone="warn">{t("s.syncing", { n: pending })}</Pill>;
  return <Pill tone="free">{t("s.online")}</Pill>;
}

function FailedOps() {
  const { t } = useI18n();
  const errText = useErrorText();
  const failed = useStaff((s) => s.failed);
  if (!failed.length) return null;
  return (
    <div className="grid gap-2">
      {failed.map((f, i) => (
        <div key={i} className="flex flex-wrap items-center justify-between gap-2 border-2 border-busy bg-busy-bg rounded-[2px] px-3 py-2">
          <span className="text-sm font-semibold text-busy">
            {t("s.syncFailed")}: {errText(f.code)} <span className="num text-xs opacity-70">({f.op.type})</span>
          </span>
          <Button size="sm" onClick={() => dismissFailed(i)}>{t("s.dismiss")}</Button>
        </div>
      ))}
    </div>
  );
}

function UserMenu() {
  const { t } = useI18n();
  const errText = useErrorText();
  const toast = useToast();
  const snap = useSnap();
  const [open, setOpen] = useState(false);
  const [oldPw, setOldPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [busy, setBusy] = useState(false);

  async function changePw() {
    setBusy(true);
    try {
      await rpc("change_own_password", { p_old: oldPw, p_new: newPw });
      toast(t("common.saved"));
      setOldPw("");
      setNewPw("");
      setOpen(false);
    } catch (e) {
      toast(errText(errorCode(e)), "error");
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    await stopStore();
    if (!getState().queue.some((q) => q.state === "pending")) await clearLocal();
    await supabase().auth.signOut();
    location.reload();
  }

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)} className="max-w-36">
        <span className="truncate">{snap.me.name}</span>
      </Button>
      <Sheet open={open} onClose={() => setOpen(false)} title={snap.me.name} footer={<Button variant="danger" onClick={logout}>{t("s.logout")}</Button>}>
        <p className="text-sm text-muted num">{snap.me.phone} · {snap.me.role}</p>
        <div className="grid gap-3">
          <h4 className="font-semibold">{t("s.changePassword")}</h4>
          <Field label={t("s.currentPassword")}>
            <Input id="pw-old" type="password" value={oldPw} onChange={(e) => setOldPw(e.target.value)} autoComplete="current-password" />
          </Field>
          <Field label={t("s.newPassword")}>
            <Input id="pw-new" type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)} autoComplete="new-password" />
          </Field>
          <Button variant="primary" busy={busy} disabled={!oldPw || newPw.length < 6} onClick={changePw}>
            {t("common.save")}
          </Button>
        </div>
      </Sheet>
    </>
  );
}
