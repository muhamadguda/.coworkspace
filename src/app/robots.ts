import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: ["/", "/menu"], disallow: ["/staff", "/setup", "/api/"] },
    sitemap: "https://dotswork.space/sitemap.xml",
    host: "https://dotswork.space",
  };
}
