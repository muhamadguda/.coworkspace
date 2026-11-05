"use client";

import { useEffect, type ReactNode } from "react";
import { I18nProvider } from "@/lib/i18n";
import { ToastProvider } from "./ui";
import { reportError } from "@/lib/report";
import { InstallPrompt } from "./InstallPrompt";

export function Providers({ children }: { children: ReactNode }) {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
    const onError = (e: ErrorEvent) => reportError("browser", e.message || "Script error", e.error?.stack);
    const onRejection = (e: PromiseRejectionEvent) => {
      const r = e.reason as { message?: string; stack?: string } | string | undefined;
      const message = typeof r === "string" ? r : r?.message;
      // Network blips are expected (offline counter); only report real failures.
      if (!message || /Failed to fetch|NetworkError|Load failed|AbortError/i.test(message)) return;
      reportError("browser", message, typeof r === "object" ? r?.stack : undefined);
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);
  return (
    <I18nProvider>
      <ToastProvider>
        {children}
        <InstallPrompt />
      </ToastProvider>
    </I18nProvider>
  );
}
