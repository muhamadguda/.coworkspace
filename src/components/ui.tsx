"use client";

import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { useI18n } from "@/lib/i18n";
import { westernDigits } from "@/lib/phone";

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

type BtnVariant = "primary" | "accent" | "outline" | "ghost" | "danger" | "free";
const btnBase =
  "inline-flex items-center justify-center gap-2 font-semibold rounded-[2px] border-2 transition-colors disabled:opacity-45 disabled:cursor-not-allowed select-none whitespace-nowrap";
const btnVariants: Record<BtnVariant, string> = {
  primary: "bg-strong text-bg border-strong hover:opacity-90",
  accent: "bg-accent text-accent-ink border-strong hover:brightness-105",
  outline: "bg-surface text-ink border-strong hover:bg-surface-2",
  ghost: "bg-transparent text-ink border-transparent hover:bg-surface-2",
  danger: "bg-busy text-white border-busy hover:opacity-90",
  free: "bg-free text-white border-free hover:opacity-90",
};
const btnSizes = { sm: "h-9 px-3 text-sm", md: "h-11 px-4 text-[15px]", lg: "h-14 px-6 text-lg" };

export function Button({
  variant = "outline",
  size = "md",
  className,
  busy,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; size?: keyof typeof btnSizes; busy?: boolean }) {
  return (
    <button type="button" {...rest} disabled={rest.disabled || busy} className={cx(btnBase, btnVariants[variant], btnSizes[size], className)}>
      {busy ? <Spinner /> : null}
      {children}
    </button>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <span aria-hidden className={cx("inline-block size-4 rounded-full border-2 border-current border-t-transparent animate-spin", className)} />;
}

export function Field({ label, hint, error, children, className }: { label?: ReactNode; hint?: ReactNode; error?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={cx("grid gap-1.5 min-w-0", className)}>
      {label ? <span className="text-sm font-semibold text-ink">{label}</span> : null}
      {children}
      {hint ? <span className="text-xs text-muted">{hint}</span> : null}
      {error ? <span className="text-sm text-busy font-medium">{error}</span> : null}
    </label>
  );
}

const inputCls =
  "h-11 w-full min-w-0 rounded-[2px] border-2 border-line bg-surface px-3 text-[16px] text-ink placeholder:text-muted/70 focus:border-strong focus:outline-none";

export function Input({ className, numeric, onChange, ...rest }: InputHTMLAttributes<HTMLInputElement> & { numeric?: boolean }) {
  return (
    <input
      {...rest}
      inputMode={numeric ? (rest.inputMode ?? "decimal") : rest.inputMode}
      dir={numeric || rest.type === "tel" ? "ltr" : rest.dir}
      onChange={(e) => {
        if (numeric || rest.type === "tel") e.target.value = westernDigits(e.target.value);
        onChange?.(e);
      }}
      className={cx(inputCls, (numeric || rest.type === "tel") && "num text-start", className)}
    />
  );
}

export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...rest} className={cx(inputCls, "h-auto min-h-20 py-2", className)} />;
}

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...rest} className={cx(inputCls, "pe-8", className)}>
      {children}
    </select>
  );
}

export function Segmented<T extends string>({ value, onChange, options, className }: { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode }[]; className?: string }) {
  return (
    <div role="radiogroup" className={cx("flex flex-wrap gap-1.5", className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cx(
            "h-10 px-3 rounded-[2px] border-2 text-sm font-semibold",
            value === o.value ? "bg-strong text-bg border-strong" : "bg-surface text-ink border-line hover:border-strong",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Toggle({ checked, onChange, label, id }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; id?: string }) {
  const auto = useId();
  return (
    <label htmlFor={id ?? auto} className="inline-flex items-center gap-2 cursor-pointer select-none">
      <input id={id ?? auto} type="checkbox" className="size-5 accent-[var(--strong)]" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="text-sm font-medium">{label}</span>
    </label>
  );
}

export function Pill({ tone = "neutral", children, className }: { tone?: "neutral" | "free" | "busy" | "warn" | "accent"; children: ReactNode; className?: string }) {
  const tones = {
    neutral: "bg-surface-2 text-ink",
    free: "bg-free-bg text-free",
    busy: "bg-busy-bg text-busy",
    warn: "bg-warn-bg text-warn",
    accent: "bg-accent text-accent-ink",
  };
  return <span className={cx("inline-flex items-center gap-1.5 rounded-[2px] px-2 py-0.5 text-xs font-semibold", tones[tone], className)}>{children}</span>;
}

export function StatusDot({ tone }: { tone: "free" | "busy" | "warn" }) {
  const c = { free: "bg-free", busy: "bg-busy", warn: "bg-warn" }[tone];
  return <span aria-hidden className={cx("inline-block size-2.5 rounded-full", c)} />;
}

export function Card({ children, className, ...rest }: { children: ReactNode; className?: string } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div {...rest} className={cx("bg-surface border-2 border-line rounded-[2px] min-w-0", className)}>
      {children}
    </div>
  );
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 flex-wrap">
      <h2 className="font-display text-xl font-bold text-ink">{children}</h2>
      {action}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="border-2 border-dashed border-line rounded-[2px] p-6 text-center text-muted text-sm">{children}</div>;
}

/** Modal: centered dialog on wide screens, bottom sheet on phones. */
export function Sheet({ open, onClose, title, children, footer, wide }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const { t } = useI18n();
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    ref.current?.focus();
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/45" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        className={cx(
          "bg-bg w-full max-h-[92dvh] flex flex-col border-2 border-strong rounded-t-[6px] sm:rounded-[2px] outline-none",
          wide ? "sm:max-w-3xl" : "sm:max-w-lg",
        )}
        style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
      >
        <div className="tile-stripe flex items-center justify-between gap-3 px-4 py-3 border-b-2 border-line">
          <h3 className="font-display text-lg font-bold min-w-0 truncate">{title}</h3>
          <button type="button" onClick={onClose} className="size-9 grid place-items-center rounded-[2px] hover:bg-surface-2 text-xl" aria-label={t("common.close")}>
            ×
          </button>
        </div>
        <div className="overflow-y-auto px-4 py-4 grid gap-4">{children}</div>
        {footer ? <div className="border-t-2 border-line px-4 py-3 flex flex-wrap gap-2 justify-end">{footer}</div> : null}
      </div>
    </div>
  );
}

export function Logo({ className, light }: { className?: string; light?: boolean }) {
  const ink = light ? "var(--bg)" : "var(--strong)";
  return (
    <svg viewBox="-4 -4 282 158" className={cx("h-7 w-auto", className)} role="img" aria-label="dot">
      <path fill={ink} fillRule="evenodd" d="M0,100a50,50 0 1,0 100,0a50,50 0 1,0 -100,0zM20,100a30,30 0 1,1 60,0a30,30 0 1,1 -60,0z" />
      <path fill={ink} d="M80,150V10a10,10 0 0,1 20,0V150z" />
      <path fill={ink} d="M232,150V28a10,10 0 0,1 20,0V150z" />
      <rect fill={ink} x="212" y="52" width="60" height="20" />
      <circle cx="162" cy="100" r="44" fill="var(--accent)" />
    </svg>
  );
}

export function LangSwitch({ className }: { className?: string }) {
  const { t, toggleLang } = useI18n();
  return (
    <button type="button" onClick={toggleLang} className={cx("h-9 px-3 rounded-[2px] border-2 border-strong bg-surface text-sm font-semibold", className)}>
      {t("lang.switch")}
    </button>
  );
}

// ---------------- Toasts ----------------
type Toast = { id: number; text: string; tone: "ok" | "error" };
const ToastCtx = createContext<(text: string, tone?: "ok" | "error") => void>(() => {});
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const push = useCallback((text: string, tone: "ok" | "error" = "ok") => {
    const id = Date.now() + Math.random();
    setItems((x) => [...x, { id, text, tone }]);
    setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), tone === "error" ? 6000 : 3000);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="fixed z-[60] bottom-4 inset-x-0 flex flex-col items-center gap-2 pointer-events-none px-4" style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}>
        {items.map((i) => (
          <div key={i.id} role="status" className={cx("pointer-events-auto max-w-md w-full border-2 rounded-[2px] px-4 py-3 text-sm font-semibold shadow-lg", i.tone === "ok" ? "bg-strong text-bg border-strong" : "bg-busy text-white border-busy")}>
            {i.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);
