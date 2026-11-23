import type { Metadata } from "next";
import { CustomerApp } from "@/customer/CustomerApp";
import { publicMenu } from "@/lib/catalog.server";

export const metadata: Metadata = {
  title: "Menu",
  description: "Order from your table, see your bill, and book a room at dots.",
  alternates: { canonical: "https://www.dotswork.space/menu" },
};

// The menu itself renders in the browser, so search engines get it as schema.org Menu data,
// refreshed from the database about once an hour.
async function MenuJsonLd() {
  const m = await publicMenu();
  if (!m || !m.items.length) return null;
  const sections = m.categories
    .filter((c) => c.active !== false)
    .map((c) => ({
      "@type": "MenuSection",
      name: c.name_en || c.name_ar,
      alternateName: c.name_ar,
      hasMenuItem: m.items
        .filter((i) => i.category_id === c.id && i.available !== false)
        .map((i) => ({
          "@type": "MenuItem",
          name: i.name_en || i.name_ar,
          alternateName: i.name_ar,
          ...(i.desc_en || i.desc_ar ? { description: i.desc_en || i.desc_ar } : {}),
          ...(i.image_url ? { image: i.image_url } : {}),
          offers: { "@type": "Offer", price: Number(i.price).toFixed(2), priceCurrency: "EGP" },
        })),
    }))
    .filter((s) => s.hasMenuItem.length);
  const data = { "@context": "https://schema.org", "@type": "Menu", name: "dots menu", url: "https://www.dotswork.space/menu", inLanguage: ["ar", "en"], hasMenuSection: sections };
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, "\\u003c") }} />;
}

export default function MenuPage() {
  return (
    <>
      <MenuJsonLd />
      <CustomerApp />
    </>
  );
}
