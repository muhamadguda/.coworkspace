import type { Metadata } from "next";
import { Landing } from "@/landing/Landing";
import { VENUE } from "@/landing/config";
import { dotQrSvg } from "@/lib/dotqr";

// Structured data so search engines and Maps can show the place, phone and map link.
const jsonLd = {
  "@context": "https://schema.org",
  "@type": "LocalBusiness",
  additionalType: ["https://schema.org/CafeOrCoffeeShop"],
  name: "dots",
  alternateName: "dots co-working space",
  description: "Co-working space and café, open 24/7: quiet tables to study and work, rooms by the hour for meetings, PlayStation and movie nights, and a corner to draw and paint.",
  url: "https://dotswork.space",
  image: "https://dotswork.space/opengraph-image",
  logo: "https://dotswork.space/icons/icon-512.png",
  telephone: VENUE.phone,
  hasMap: VENUE.mapUrl,
  priceRange: "EGP",
  currenciesAccepted: "EGP",
  address: { "@type": "PostalAddress", addressCountry: "EG" },
  potentialAction: { "@type": "OrderAction", target: "https://dotswork.space/menu" },
  // Open around the clock, every day.
  openingHoursSpecification: [{ "@type": "OpeningHoursSpecification", dayOfWeek: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"], opens: "00:00", closes: "23:59" }],
};

export const metadata: Metadata = {
  title: { absolute: "dots · Focus. Work. Play." },
  description: "Co-working space and café, open 24/7: quiet tables to study, rooms by the hour for meetings, PlayStation and movie nights, and a corner to draw and paint.",
  openGraph: { title: "dots · Focus. Work. Play.", description: "Co-working space and café, open 24/7. Study, meet, work, watch, play, paint.", url: "https://dotswork.space", siteName: "dots", type: "website" },
  alternates: { canonical: "https://dotswork.space" },
};

export default function Home() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
      <Landing menuQr={dotQrSvg("https://dotswork.space/menu", { fg: "#173a39", bg: "#eaf0ea", label: "Menu: dotswork.space/menu" })} />
    </>
  );
}
