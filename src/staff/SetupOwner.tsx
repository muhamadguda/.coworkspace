"use client";

import { useState } from "react";
import { useErrorText, useI18n } from "@/lib/i18n";
import { errorCode, isNetworkError, rpc } from "@/lib/supabase";
import { isValidPhone, normalizePhone } from "@/lib/phone";
import { Button, Card, Field, Input, LangSwitch, Logo } from "@/components/ui";

export function SetupOwner() {
  const { t } = useI18n();
  const errText = useErrorText();
  const [code, setCode] = useState("");
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await rpc("claim_owner", { p_setup_code: code.trim().toUpperCase(), p_phone: normalizePhone(phone), p_name: name.trim(), p_password: password });
      setDone(true);
    } catch (err) {
      setError(errText(isNetworkError(err) ? "network" : errorCode(err)));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-dvh grid place-items-center p-4">
      <Card className="w-full max-w-sm p-6 grid gap-5 tile-stripe">
        <div className="flex items-center justify-between">
          <Logo className="h-9" />
          <LangSwitch />
        </div>
        <div className="grid gap-1">
          <h1 className="font-display text-2xl font-bold">{t("su.title")}</h1>
          <p className="text-sm text-muted">{t("su.hint")}</p>
        </div>
        {done ? (
          <div className="grid gap-3">
            <p className="font-semibold text-free">{t("su.done")}</p>
            <a href="/staff" className="h-11 grid place-items-center bg-strong text-bg font-semibold rounded-[2px]">{t("s.login.submit")}</a>
          </div>
        ) : (
          <form onSubmit={submit} className="grid gap-4">
            <Field label={t("su.code")}>
              <Input id="setup-code" value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off" className="num uppercase" dir="ltr" />
            </Field>
            <Field label={t("common.name")}>
              <Input id="setup-name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
            </Field>
            <Field label={t("common.phone")}>
              <Input id="setup-phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" />
            </Field>
            <Field label={t("s.login.password")} hint={t("err.password_too_short")}>
              <Input id="setup-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
            </Field>
            {error ? <p className="text-busy font-semibold text-sm">{error}</p> : null}
            <Button type="submit" variant="primary" busy={busy} disabled={!code || !isValidPhone(phone) || password.length < 6}>
              {t("su.submit")}
            </Button>
          </form>
        )}
      </Card>
    </div>
  );
}
