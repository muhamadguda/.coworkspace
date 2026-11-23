import { cacheLife } from "next/cache";

// Public menu read on the server (for search engines). Same publishable key the browser uses.
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://avqsypqflrjcylmneycj.supabase.co";
const KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "sb_publishable_fZ8Wgd44dppdKFonV3WjIg_i1DArY9q";

export type PublicMenu = {
  categories: { id: string; name_ar: string; name_en: string; active?: boolean; sort?: number }[];
  items: { id: string; name_ar: string; name_en: string; desc_ar?: string; desc_en?: string; price: number; available?: boolean; image_url?: string | null; category_id: string }[];
};

export async function publicMenu(): Promise<PublicMenu | null> {
  "use cache";
  cacheLife("hours");
  try {
    const res = await fetch(`${URL}/rest/v1/rpc/public_catalog2`, {
      method: "POST",
      headers: { apikey: KEY, authorization: `Bearer ${KEY}`, "content-type": "application/json" },
      body: "{}",
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const c = (await res.json()) as PublicMenu;
    return { categories: c.categories ?? [], items: c.items ?? [] };
  } catch {
    return null;
  }
}
