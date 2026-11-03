"use client";

// Sends app errors to /api/errors (stored for the owner's System health panel and pushed to owner phones).
const sent = new Set<string>();

export function reportError(source: "browser" | "sync", message: string, detail?: string, user?: string) {
  try {
    if (typeof window === "undefined" || !navigator.onLine) return;
    const key = `${source}:${message}`;
    if (sent.has(key) || sent.size > 20) return;
    sent.add(key);
    void fetch("/api/errors", {
      method: "POST",
      keepalive: true,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ source, message: message.slice(0, 500), detail: detail?.slice(0, 4000), url: location.pathname + location.hash, user }),
    }).catch(() => {});
  } catch {}
}
