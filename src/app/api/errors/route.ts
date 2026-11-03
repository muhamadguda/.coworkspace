import webpush from "web-push";
import { createClient } from "@supabase/supabase-js";

// Browsers report crashes and failed counter syncs here; new ones are pushed to owner devices.
export async function POST(request: Request) {
  const secret = process.env.PUSH_SECRET;
  if (!secret) return new Response(null, { status: 204 });
  const body = (await request.json().catch(() => null)) as { source?: string; message?: string; detail?: string; url?: string; user?: string } | null;
  if (!body?.message) return new Response(null, { status: 204 });
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, { auth: { persistSession: false } });
  const { data } = await sb.rpc("log_app_error", {
    p_secret: secret,
    p_source: String(body.source ?? "web").slice(0, 20),
    p_message: String(body.message).slice(0, 500),
    p_detail: body.detail ? String(body.detail).slice(0, 4000) : null,
    p_url: body.url ? String(body.url).slice(0, 500) : null,
    p_ua: (request.headers.get("user-agent") ?? "").slice(0, 300),
    p_user: body.user && /^[0-9a-f-]{36}$/.test(body.user) ? body.user : null,
  });
  const messages = (Array.isArray(data) ? data : []) as { endpoint: string; p256dh: string; auth: string; title: string; body: string; url: string; tag: string }[];
  const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  if (messages.length && pub && priv) {
    webpush.setVapidDetails("mailto:hello@dotcowork.space", pub, priv);
    await Promise.all(
      messages.map((m) =>
        webpush
          .sendNotification({ endpoint: m.endpoint, keys: { p256dh: m.p256dh, auth: m.auth } }, JSON.stringify({ title: m.title, body: m.body, url: m.url, tag: m.tag }), { TTL: 86400 })
          .catch(() => {}),
      ),
    );
  }
  return new Response(null, { status: 204 });
}
