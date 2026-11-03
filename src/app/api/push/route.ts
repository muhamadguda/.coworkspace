import webpush from "web-push";
import { createClient } from "@supabase/supabase-js";

// Delivers Web Push messages handed over by the database (public.push_send via pg_net).
type Message = { endpoint: string; p256dh: string; auth: string; title: string; body: string; url?: string; tag?: string };

export async function POST(request: Request) {
  const secret = process.env.PUSH_SECRET;
  if (!secret || request.headers.get("x-push-secret") !== secret) return new Response("forbidden", { status: 403 });
  const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) return new Response("push not configured", { status: 500 });
  webpush.setVapidDetails("mailto:hello@dotcowork.space", pub, priv);

  const { messages } = (await request.json().catch(() => ({ messages: [] }))) as { messages: Message[] };
  const gone: string[] = [];
  let sent = 0;
  await Promise.all(
    (messages ?? []).slice(0, 500).map(async (m) => {
      try {
        await webpush.sendNotification(
          { endpoint: m.endpoint, keys: { p256dh: m.p256dh, auth: m.auth } },
          JSON.stringify({ title: m.title, body: m.body, url: m.url ?? "/", tag: m.tag }),
          { TTL: 60 * 60 * 6, urgency: "high" },
        );
        sent++;
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) gone.push(m.endpoint);
      }
    }),
  );
  if (gone.length) {
    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, { auth: { persistSession: false } });
    await sb.rpc("push_prune", { p_secret: secret, p_endpoints: gone });
  }
  return Response.json({ sent, gone: gone.length });
}
