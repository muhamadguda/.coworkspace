import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/ui";

export const metadata: Metadata = { title: "Not found", robots: { index: false } };

// Both languages at once: the language choice lives in the browser, and this page must read right before it loads.
export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-6 px-4 text-center">
      <Logo className="h-10" />
      <div className="space-y-2">
        <h1 className="font-display text-2xl text-strong">الصفحة دي مش موجودة</h1>
        <p className="text-muted" dir="ltr" lang="en">This page doesn&apos;t exist.</p>
      </div>
      <p className="text-sm text-muted">لو جيت من كود QR، اطلب من الكاونتر كود جديد · <span dir="ltr" lang="en">Came from a QR code? Ask the counter for a new one.</span></p>
      <nav className="flex flex-wrap justify-center gap-3">
        <Link href="/menu" className="rounded-[var(--radius-tile)] bg-accent px-4 py-2 font-semibold text-accent-ink">المنيو · Menu</Link>
        <Link href="/" className="rounded-[var(--radius-tile)] border border-line px-4 py-2">الرئيسية · Home</Link>
      </nav>
    </main>
  );
}
