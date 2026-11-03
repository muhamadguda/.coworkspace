"use client";

// Per-device conveniences for customers. Nothing here is trusted by the server.

export type Identity = { phone: string; code: string; name: string };
export type MyOrder = { id: string; at: number };
export type QrPlace = { token: string; id: string; kind: "room" | "table"; name_ar: string; name_en: string; at: number };

const read = <T,>(k: string, fallback: T): T => {
  try {
    const v = localStorage.getItem(k);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
};
const write = (k: string, v: unknown) => {
  try {
    if (v === null) localStorage.removeItem(k);
    else localStorage.setItem(k, JSON.stringify(v));
  } catch {}
};

export const getIdentity = () => read<Identity>("dot.me", { phone: "", code: "", name: "" });
export const setIdentity = (v: Identity | null) => write("dot.me", v);

export const getMyOrders = () => read<MyOrder[]>("dot.orders", []).filter((o) => Date.now() - o.at < 12 * 3600_000);
export const addMyOrder = (id: string) => write("dot.orders", [{ id, at: Date.now() }, ...getMyOrders()].slice(0, 20));

// The QR place is remembered for 6 hours so a refresh doesn't lose it.
export const getQrPlace = () => {
  const p = read<QrPlace | null>("dot.place", null);
  return p && Date.now() - p.at < 6 * 3600_000 ? p : null;
};
export const setQrPlace = (p: QrPlace | null) => write("dot.place", p);
