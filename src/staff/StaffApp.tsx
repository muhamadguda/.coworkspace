"use client";

import { useEffect, useState } from "react";
import type { Session as AuthSession } from "@supabase/supabase-js";
import { useErrorText, useI18n } from "@/lib/i18n";
import { errorCode, isNetworkError, rpc, staffEmail, supabase } from "@/lib/supabase";
import { isValidPhone, normalizePhone } from "@/lib/phone";
import { Button, Card, Field, Input, LangSwitch, Logo, Spinner } from "@/components/ui";
import { cachedUserId, clearLocal, resumeAfterSignIn, startStore, stopStore, useStaff } from "./store";
import { Shell } from "./Shell";

export function StaffApp() {
  const [auth, setAuth] = useState<AuthSession | null | undefined>(undefined);
  const view = useStaff((s) => s.view);
  const loaded = useStaff((s) => s.loaded);
  const needsAuth = useStaff((s) => s.needsAuth && s.online);
  const pending = useStaff((s) => s.queue.filter((q) => q.state === "pending").length);
  const [offlineUser, setOfflineUser] = useState<string | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);

  useEffect(() => {
    const sb = supabase();
    sb.auth
      .getSession()
      .then(async ({ data }) => {
        // No usable login while offline: keep the counter working from this device's cache.
        if (!data.session && !navigator.onLine) setOfflineUser(await cachedUserId());
        setAuth(data.session ?? null);
      })
      .catch(async () => {
        setOfflineUser(await cachedUserId());
        setAuth(null);
      });
    const { data: sub } = sb.auth.onAuthStateChange((_e, s) => setAuth(s ?? null));
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    const id = auth?.user.id ?? offlineUser;
    if (!id) return;
    startStore(id).catch((e) => setFatal(errorCode(e)));
    if (auth) resumeAfterSignIn();
  }, [auth, offlineUser]);

  if (auth === undefined) return <Splash />;
  if (!auth && !offlineUser) return <Login />;
  if (fatal) return <Fatal code={fatal} />;
  if (!loaded || !view) return <Splash />;
  return (
    <>
      <Shell />
      {needsAuth && !auth ? <ReLogin pending={pending} /> : null}
    </>
  );
}

/** Shown when work is queued but the login expired: sign in again to sync it. */
function ReLogin({ pending }: { pending: number }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <div className="fixed bottom-4 inset-x-4 z-40 flex justify-center">
      <div className="bg-warn-bg border-2 border-warn rounded-[2px] px-4 py-3 flex flex-wrap items-center gap-3 max-w-xl">
        <span className="font-semibold">{t("s.signInToSync", { n: pending })}</span>
        <Button size="sm" variant="primary" onClick={() => setOpen(true)}>{t("s.login.submit")}</Button>
      </div>
      {open ? <div className="fixed inset-0 z-50 bg-black/45 grid place-items-center p-4"><Login onDone={() => setOpen(false)} /></div> : null}
    </div>
  );
}

function Splash() {
  const { t } = useI18n();
  return (
    <div className="min-h-dvh grid place-items-center">
      <div className="grid gap-4 place-items-center">
        <Logo className="h-12" />
        <span className="inline-flex items-center gap-2 text-muted">
          <Spinner /> {t("common.loading")}
        </span>
      </div>
    </div>
  );
}

function Fatal({ code }: { code: string }) {
  const errText = useErrorText();
  const { t } = useI18n();
  return (
    <div className="min-h-dvh grid place-items-center p-4">
      <Card className="p-6 grid gap-4 max-w-sm">
        <p className="font-semibold">{errText(code)}</p>
        <Button variant="primary" onClick={async () => { await stopStore(); await clearLocal(); await supabase().auth.signOut(); location.reload(); }}>
          {t("s.logout")}
        </Button>
      </Card>
    </div>
  );
}

function Login({ onDone }: { onDone?: () => void }) {
  const { t } = useI18n();
  const errText = useErrorText();
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [claimed, setClaimed] = useState(true);

  useEffect(() => {
    rpc<{ claimed: boolean }>("setup_status").then((r) => setClaimed(r.claimed)).catch(() => {});
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error: err } = await supabase().auth.signInWithPassword({ email: staffEmail(normalizePhone(phone)), password });
    setBusy(false);
    if (err) setError(errText(isNetworkError(err) ? "network" : "invalid_credentials"));
    else {
      resumeAfterSignIn();
      onDone?.();
    }
  }

  return (
    <div className={onDone ? "w-full grid place-items-center" : "min-h-dvh grid place-items-center p-4"}>
      <Card className="w-full max-w-sm p-6 grid gap-5 tile-stripe">
        <div className="flex items-center justify-between">
          <Logo className="h-9" />
          <LangSwitch />
        </div>
        <h1 className="font-display text-2xl font-bold">{t("s.login.title")}</h1>
        <form onSubmit={submit} className="grid gap-4">
          <Field label={t("common.phone")}>
            <Input id="login-phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="username" />
          </Field>
          <Field label={t("s.login.password")}>
            <Input id="login-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
          </Field>
          {error ? <p className="text-busy font-semibold text-sm">{error}</p> : null}
          <Button type="submit" variant="primary" size="lg" busy={busy} disabled={!isValidPhone(phone) || !password}>
            {t("s.login.submit")}
          </Button>
        </form>
        {!claimed ? (
          <a href="/setup" className="text-sm font-semibold underline">
            {t("s.login.firstTime")}
          </a>
        ) : null}
      </Card>
    </div>
  );
}
