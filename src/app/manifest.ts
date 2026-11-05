import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "dot · co-working & café",
    short_name: "dot",
    description: "Order, check your bill, and book a room at dot.",
    id: "/menu",
    start_url: "/menu",
    scope: "/",
    display: "standalone",
    background_color: "#eaf0ea",
    theme_color: "#173a39",
    lang: "ar",
    dir: "rtl",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "المنيو · Menu", short_name: "Menu", url: "/menu", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "زيارتي · My visit", short_name: "My visit", url: "/menu?tab=bill", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "احجز أوضة · Book a room", short_name: "Book", url: "/menu?tab=book", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
    ],
  };
}
