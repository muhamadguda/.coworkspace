"use client";

import Link from "next/link";
import { useEffect } from "react";
import { reportError } from "@/lib/report";

// Shown when a page crashes. The crash is reported so it reaches the owner's System health panel.
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    reportError("browser", error.message || "page crashed", error.digest ?? error.stack);
  }, [error]);
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-6 px-4 text-center">
      <div className="space-y-2">
        <h1 className="font-display text-2xl text-strong">حصلت مشكلة</h1>
        <p className="text-muted" dir="ltr" lang="en">Something went wrong.</p>
      </div>
      <div className="flex flex-wrap justify-center gap-3">
        <button type="button" onClick={reset} className="rounded-[var(--radius-tile)] bg-accent px-4 py-2 font-semibold text-accent-ink">
          جرّب تاني · Try again
        </button>
        <Link href="/" className="rounded-[var(--radius-tile)] border border-line px-4 py-2">الرئيسية · Home</Link>
      </div>
    </main>
  );
}
