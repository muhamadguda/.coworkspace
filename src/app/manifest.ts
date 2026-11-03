import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "dot · co-working & café",
    short_name: "dot",
    description: "Order, check your bill, and book a room at dot.",
    start_url: "/",
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
  };
}
