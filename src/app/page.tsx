import type { Metadata } from "next";
import { Landing } from "@/landing/Landing";
import { VENUE } from "@/landing/config";

// Structured data so search engines and Maps can show the place, phone and map link.
const jsonLd = {
  "@context": "https://schema.org",
  "@type": "LocalBusiness",
  additionalType: ["https://schema.org/CafeOrCoffeeShop"],
  name: "dot",
  alternateName: "dot co-working space",
  description: "Co-working space and café: quiet tables to study and work, rooms by the hour for meetings, PlayStation and movie nights, and a corner to draw and paint.",
  url: "https://dotcowork.space",
  image: "https://dotcowork.space/opengraph-image",
  logo: "https://dotcowork.space/icons/icon-512.png",
  telephone: VENUE.phone,
  hasMap: VENUE.mapUrl,
  priceRange: "EGP",
  currenciesAccepted: "EGP",
  address: { "@type": "PostalAddress", addressCountry: "EG" },
  potentialAction: { "@type": "OrderAction", target: "https://dotcowork.space/menu" },
};

export const metadata: Metadata = {
  title: { absolute: "dot · Focus. Work. Play." },
  description: "Co-working space and café: quiet tables to study, rooms by the hour for meetings, PlayStation and movie nights, and a corner to draw and paint.",
  openGraph: { title: "dot · Focus. Work. Play.", description: "Co-working space and café. Study, meet, work, watch, play, paint.", url: "https://dotcowork.space", siteName: "dot", type: "website" },
  alternates: { canonical: "https://dotcowork.space" },
};

export default function Home() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
      <Landing />
    </>
  );
}
