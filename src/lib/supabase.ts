"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// The publishable key is safe to ship to browsers; row-level security and
// security-definer functions decide what each caller can do.
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://avqsypqflrjcylmneycj.supabase.co";
const KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "sb_publishable_fZ8Wgd44dppdKFonV3WjIg_i1DArY9q";

let client: SupabaseClient | null = null;

export function supabase(): SupabaseClient {
  if (!client) {
    client = createClient(URL, KEY, {
      auth: { persistSession: true, autoRefreshToken: true, storageKey: "dot.auth", detectSessionInUrl: false },
      realtime: { params: { eventsPerSecond: 5 } },
    });
  }
  return client;
}

export const STAFF_EMAIL_DOMAIN = "staff.dotcowork.space";
export const staffEmail = (phone: string) => `s${phone}@${STAFF_EMAIL_DOMAIN}`;

/** Extract our server error code (e.g. "debt_limit") from a Postgres exception message. */
export function errorCode(err: unknown): string {
  const msg =
    typeof err === "string"
      ? err
      : err && typeof err === "object" && "message" in err
        ? String((err as { message: unknown }).message)
        : "unknown";
  const m = msg.match(/^([a-z_]+)(?::|$)/);
  return m ? m[1] : msg;
}

/** True when the failure was the network, not the server saying no. */
export function isNetworkError(err: unknown): boolean {
  if (typeof navigator !== "undefined" && !navigator.onLine) return true;
  const msg = err && typeof err === "object" && "message" in err ? String((err as { message: unknown }).message) : String(err);
  return /Failed to fetch|NetworkError|Load failed|network|fetch failed|timeout|ERR_INTERNET|ECONN/i.test(msg);
}

export async function rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase().rpc(fn, args ?? {});
  if (error) throw error;
  if (data && typeof data === "object" && !Array.isArray(data) && "error" in data && typeof (data as { error: unknown }).error === "string") {
    throw new Error((data as { error: string }).error);
  }
  return data as T;
}
