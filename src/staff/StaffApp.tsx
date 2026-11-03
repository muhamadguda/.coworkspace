"use client";

import { useEffect, useState } from "react";
import type { Session as AuthSession } from "@supabase/supabase-js";
import { useErrorText, useI18n } from "@/lib/i18n";
import { errorCode, isNetworkError, rpc, staffEmail, supabase } from "@/lib/supabase";
import { isValidPhone, normalizePhone } from "@/lib/phone";
import { Button, Card, Field, Input, LangSwitch, Logo, Spinner } from "@/components/ui";
import { clearLocal, refresh, startStore, stopStore, useStaff } from "./store";
import { Shell } from "./Shell";

export function StaffApp() {
  const [auth, setAuth] = useState<AuthSession | null | undefined>(undefined);
  const view = useStaff((s) => s.view);
  const loaded = useStaff((s) => s.loaded);
  const [fatal, setFatal] = useState<string | null>(null);

  useEffect(() => {
    const sb = supabase();
    sb.auth.getSession().then(({ data }) => setAuth(data.session ?? null)).catch(() => setAuth(null));
    const { data: sub } = sb.auth.onAuthStateChange((_e, s) => setAuth(s ?? null));
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!auth) return;
    startStore(auth.user.id).catch((e) => setFatal(errorCode(e)));
  }, [auth]);

  if (auth === undefined) return <Splash />;
  if (!auth) return <Login />;
  if (fatal) return <Fatal code={fatal} />;
  if (!loaded || !view) return <Splash />;
  return <Shell />;
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

function Login() {
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
    else void refresh();
  }

  return (
    <div className="min-h-dvh grid place-items-center p-4">
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
