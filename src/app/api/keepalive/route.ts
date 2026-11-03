import { createClient } from "@supabase/supabase-js";

// Vercel Cron calls this every few days: adds and removes a row so the free
// Supabase project never counts as inactive (free projects pause after 7 idle days).
export async function GET(request: Request) {
  const cron = process.env.CRON_SECRET;
  if (cron && request.headers.get("authorization") !== `Bearer ${cron}`) return new Response("forbidden", { status: 403 });
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, { auth: { persistSession: false } });
  const { data, error } = await sb.rpc("keepalive", { p_source: "vercel-cron" });
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
  return Response.json(data);
}
