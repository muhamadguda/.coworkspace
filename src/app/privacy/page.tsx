import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/ui";
import { VENUE } from "@/landing/config";

export const metadata: Metadata = {
  title: "Privacy",
  description: "What dots keeps about you, why, and how to have it removed.",
  alternates: { canonical: "https://www.dotswork.space/privacy" },
};

const sections: { ar: [string, string[]]; en: [string, string[]] }[] = [
  {
    ar: ["بنحتفظ بإيه", ["رقم موبايلك واسمك لو كتبته، وكود العميل بتاعك.", "طلباتك وفواتيرك وحجوزاتك وتسجيلك في الإيفنتات ونقاط الزيارات.", "لو وافقت على الإشعارات: عنوان الإشعارات اللي المتصفح بيدّيهولنا، عشان نبعتلك حالة طلبك أو الإيفنتات الجديدة."]],
    en: ["What we keep", ["Your phone number, your name if you give it, and your customer code.", "Your orders, bills, bookings, event sign-ups and visit rewards.", "If you allow notifications: the push address your browser gives us, to tell you about your order or new events."]],
  },
  {
    ar: ["ليه", ["عشان نوصّل طلبك للترابيزة الصح، ونحسب فاتورتك، ونأكد حجزك، ونديك مكافآت الزيارات.", "عروض واتساب بتوصلك بس لو وافقت عليها، وتقدر تقفلها من صفحة الفاتورة."]],
    en: ["Why", ["To bring your order to the right table, work out your bill, confirm your booking and give you visit rewards.", "WhatsApp offers only reach you if you opted in, and you can turn them off on your bill page."]],
  },
  {
    ar: ["مين بيشوفها", ["فريق dots بس. مش بنبيع بياناتك ولا بنديها لحد.", "البيانات متخزنة عند Supabase (فرانكفورت) والموقع شغال على Vercel. بنستخدم Vercel Analytics لعدّ الزيارات من غير كوكيز ومن غير ما نعرف إنت مين."]],
    en: ["Who sees it", ["Only the dots team. We don't sell or share your data.", "Data is stored with Supabase (Frankfurt) and the site runs on Vercel. Vercel Analytics counts visits without cookies and without knowing who you are."]],
  },
  {
    ar: ["عايز تمسح بياناتك؟", [`كلمنا أو ابعتلنا على ${VENUE.phoneDisplay} أو اطلب من الكاونتر، وهنمسحها. الفواتير المدفوعة ممكن نحتفظ بيها للحسابات.`]],
    en: ["Want it removed?", [`Call or message us on ${VENUE.phoneDisplay}, or ask at the counter, and we'll delete it. Paid bills may be kept for our accounts.`]],
  },
];

export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-10 space-y-10">
      <Link href="/" aria-label="dots"><Logo className="h-8" /></Link>
      <article className="space-y-6" dir="rtl" lang="ar">
        <h1 className="font-display text-3xl text-strong">الخصوصية</h1>
        {sections.map(({ ar: [h, ps] }) => (
          <section key={h} className="space-y-2">
            <h2 className="font-display text-xl text-strong">{h}</h2>
            {ps.map((p) => <p key={p} className="text-ink/90 leading-relaxed">{p}</p>)}
          </section>
        ))}
      </article>
      <hr className="border-line" />
      <article className="space-y-6" dir="ltr" lang="en">
        <h1 className="font-display text-3xl text-strong">Privacy</h1>
        {sections.map(({ en: [h, ps] }) => (
          <section key={h} className="space-y-2">
            <h2 className="font-display text-xl text-strong">{h}</h2>
            {ps.map((p) => <p key={p} className="text-ink/90 leading-relaxed">{p}</p>)}
          </section>
        ))}
      </article>
      <p className="text-sm text-muted">Updated November 2026 · آخر تحديث نوفمبر ٢٠٢٦</p>
    </main>
  );
}
