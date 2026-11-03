import type { MetadataRoute } from "next";

const BASE = "https://dotcowork.space";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: BASE, changeFrequency: "weekly", priority: 1 },
    { url: `${BASE}/menu`, changeFrequency: "daily", priority: 0.8 },
  ];
}
