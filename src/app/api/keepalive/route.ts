import { connection } from "next/server";
import { createClient } from "@supabase/supabase-js";

// Vercel Cron calls this every 3 days and adds a row, so the free Supabase project
// never counts as inactive (free projects pause after 7 idle days).
export async function GET(request: Request) {
  await connection(); // always run per request, never rendered at build time
  const cron = process.env.CRON_SECRET;
  if (cron && request.headers.get("authorization") !== `Bearer ${cron}`) return new Response("forbidden", { status: 403 });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return Response.json({ ok: false, error: "not_configured" }, { status: 500 });
  const sb = createClient(url, key, { auth: { persistSession: false } });
  const { data, error } = await sb.rpc("keepalive", { p_source: "vercel-cron" });
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
  return Response.json(data);
}
