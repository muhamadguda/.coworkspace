"use client";

import { useState } from "react";
import { useErrorText, useI18n } from "@/lib/i18n";
import { errorCode, rpc } from "@/lib/supabase";
import { isValidPhone, normalizePhone } from "@/lib/phone";
import type { Role, StaffProfile } from "@/lib/types";
import { Button, Card, Field, Input, Pill, SectionTitle, Segmented, Sheet, cx, useToast } from "@/components/ui";
import { refresh } from "../store";
import { useOnline, useSnap } from "../hooks";

export function TeamAdmin() {
  const { t } = useI18n();
  const snap = useSnap();
  const online = useOnline();
  const errText = useErrorText();
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const [resetting, setResetting] = useState<StaffProfile | null>(null);

  async function update(s: StaffProfile, patch: Partial<StaffProfile>) {
    try {
      await rpc("owner_update_staff", { p_user_id: s.user_id, p_name: patch.name ?? s.name, p_role: patch.role ?? s.role, p_active: patch.active ?? s.active });
      await refresh();
      toast(t("common.saved"));
    } catch (e) {
      toast(errText(errorCode(e)), "error");
    }
  }

  return (
    <div className="grid gap-4">
      {!online ? <p className="text-busy font-semibold">{t("m.onlineOnly")}</p> : null}
      <SectionTitle action={<Button variant="accent" size="sm" disabled={!online} onClick={() => setAdding(true)}>{t("tm.add")}</Button>}>{t("tm.title")}</SectionTitle>
      <Card className="divide-y-2 divide-line">
        {snap.staff.map((s) => (
          <div key={s.user_id} className={cx("flex flex-wrap items-center justify-between gap-2 px-3 py-2", !s.active && "opacity-60")}>
            <span className="grid">
              <span className="font-semibold">{s.name} {s.user_id === snap.me.user_id ? <Pill tone="accent">{t("tm.you")}</Pill> : null}</span>
              <span className="num text-sm text-muted">{s.phone}</span>
            </span>
            <span className="flex flex-wrap items-center gap-2">
              <Pill tone={s.role === "owner" ? "accent" : "neutral"}>{s.role === "owner" ? t("tm.owner") : t("tm.staff")}</Pill>
              <Pill tone={s.active ? "free" : "busy"}>{s.active ? t("tm.active") : t("tm.disabled")}</Pill>
              {s.user_id !== snap.me.user_id ? (
                <>
                  <Button size="sm" disabled={!online} onClick={() => update(s, { role: s.role === "owner" ? "staff" : "owner" })}>{s.role === "owner" ? t("tm.staff") : t("tm.owner")}</Button>
                  <Button size="sm" disabled={!online} onClick={() => update(s, { active: !s.active })}>{s.active ? t("tm.disable") : t("tm.enable")}</Button>
                </>
              ) : null}
              <Button size="sm" disabled={!online} onClick={() => setResetting(s)}>{t("tm.resetPassword")}</Button>
            </span>
          </div>
        ))}
      </Card>
      {adding ? <AddStaff onClose={() => setAdding(false)} /> : null}
      {resetting ? <ResetPassword s={resetting} onClose={() => setResetting(null)} /> : null}
    </div>
  );
}

function AddStaff({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const errText = useErrorText();
  const toast = useToast();
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [pw, setPw] = useState("");
  const [role, setRole] = useState<Role>("staff");
  const [busy, setBusy] = useState(false);
  async function submit() {
    setBusy(true);
    try {
      await rpc("owner_create_staff", { p_phone: normalizePhone(phone), p_name: name.trim(), p_password: pw, p_role: role });
      await refresh();
      toast(t("common.saved"));
      onClose();
    } catch (e) {
      toast(errText(errorCode(e)), "error");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Sheet open onClose={onClose} title={t("tm.add")} footer={<Button variant="primary" busy={busy} disabled={!isValidPhone(phone) || !name.trim() || pw.length < 6} onClick={submit}>{t("common.save")}</Button>}>
      <Field label={t("common.name")}><Input id="tm-name" value={name} onChange={(e) => setName(e.target.value)} /></Field>
      <Field label={t("common.phone")}><Input id="tm-phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} /></Field>
      <Field label={t("s.login.password")} hint={t("err.password_too_short")}><Input id="tm-pw" type="text" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="off" /></Field>
      <Field group label={t("tm.role")}><Segmented value={role} onChange={setRole} options={[{ value: "staff", label: t("tm.staff") }, { value: "owner", label: t("tm.owner") }]} /></Field>
    </Sheet>
  );
}

function ResetPassword({ s, onClose }: { s: StaffProfile; onClose: () => void }) {
  const { t } = useI18n();
  const errText = useErrorText();
  const toast = useToast();
  const [pw, setPw] = useState("");
  return (
    <Sheet open onClose={onClose} title={`${t("tm.resetPassword")} · ${s.name}`} footer={<Button variant="primary" disabled={pw.length < 6} onClick={async () => {
      try {
        await rpc("owner_reset_password", { p_user_id: s.user_id, p_password: pw });
        toast(t("common.saved"));
        onClose();
      } catch (e) {
        toast(errText(errorCode(e)), "error");
      }
    }}>{t("common.save")}</Button>}>
      <Field label={t("s.newPassword")} hint={t("err.password_too_short")}><Input id="rp-pw" type="text" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="off" /></Field>
    </Sheet>
  );
}
