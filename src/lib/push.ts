"use client";

// Web Push helpers. iPhone/iPad only support push for sites added to the Home Screen (iOS 16.4+).

const VAPID = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || "BMmxYtgi-hpaIXJHlwOkfmJZOvkqKSqC_BCjBekp8sfrwCGU3RpDrcohduql-DMyxidGkReXE2X65f_6a1GtF_E";

export type PushSupport = "ok" | "unsupported" | "ios-needs-install" | "denied";

export function pushSupport(): PushSupport {
  if (typeof window === "undefined") return "unsupported";
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent);
  const standalone = window.matchMedia?.("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone;
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return ios && !standalone ? "ios-needs-install" : "unsupported";
  if (Notification.permission === "denied") return "denied";
  return "ok";
}

function keyBytes(base64: string) {
  const pad = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

/** Ask permission (must be called from a tap) and return the browser's push subscription. */
export async function getPushSubscription(): Promise<PushSubscriptionJSON | null> {
  if (pushSupport() !== "ok") return null;
  const perm = await Notification.requestPermission();
  if (perm !== "granted") return null;
  const reg = (await navigator.serviceWorker.getRegistration()) ?? (await navigator.serviceWorker.register("/sw.js"));
  await navigator.serviceWorker.ready;
  const existing = await reg.pushManager.getSubscription();
  const sub = existing ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(VAPID) }));
  return sub.toJSON();
}

export async function currentSubscription(): Promise<PushSubscriptionJSON | null> {
  if (pushSupport() !== "ok" || Notification.permission !== "granted") return null;
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  return sub ? sub.toJSON() : null;
}
