"use client";

// Printable dot-style QR cards: one card on its own page (big), or many on A4 (two per row).
import { dotQrSvg, wifiQrText } from "./dotqr";
import { printHtml } from "./print";
import type { Lang } from "./types";

export type QrCard = {
  value: string; // what the code opens
  titleAr: string;
  titleEn: string;
  ctaAr: string;
  ctaEn: string;
  lines?: { label: string; value: string }[]; // printed under the code, e.g. the Wi-Fi password
};

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export function printQrCards(cards: QrCard[], lang: Lang) {
  if (!cards.length) return;
  const single = cards.length === 1;
  const body = cards
    .map((c) => {
      const svg = dotQrSvg(c.value, { label: c.titleEn });
      const lines = (c.lines ?? []).map((l) => `<div class="line"><span>${esc(l.label)}</span><b dir="ltr">${esc(l.value)}</b></div>`).join("");
      return `<div class="card"><div class="ar">${esc(c.titleAr)}</div><div class="en">${esc(c.titleEn)}</div><div class="qr">${svg}</div>${lines}<div class="cta">${esc(c.ctaAr)} · ${esc(c.ctaEn)}</div><div class="brand">dot</div></div>`;
    })
    .join("");
  printHtml(`<!doctype html><html lang="${lang}" dir="${lang === "ar" ? "rtl" : "ltr"}"><head><meta charset="utf-8"><title>QR</title><style>
    @page { size: ${single ? "A5" : "A4"}; margin: 10mm; }
    body { margin: 0; font-family: "IBM Plex Sans Arabic", "Segoe UI", Tahoma, sans-serif; color: #173a39; }
    .grid { display: grid; grid-template-columns: ${single ? "1fr" : "repeat(2, 1fr)"}; gap: 8mm; }
    .card { border: 2px solid #173a39; border-top: ${single ? 12 : 8}px solid #d9a21b; padding: ${single ? "10mm 8mm" : "6mm"}; text-align: center; break-inside: avoid; display: grid; gap: 2mm; justify-items: center; }
    .ar { font-size: ${single ? 30 : 20}px; font-weight: 700; } .en { font-size: ${single ? 20 : 14}px; font-weight: 600; opacity: .8; }
    .qr svg { width: ${single ? 105 : 60}mm; height: ${single ? 105 : 60}mm; }
    .line { font-size: ${single ? 18 : 13}px; display: flex; gap: 3mm; justify-content: center; } .line span { opacity: .7; }
    .cta { font-size: ${single ? 18 : 14}px; font-weight: 700; margin-top: 1mm; } .brand { font-size: 12px; letter-spacing: .3em; }
  </style></head><body><div class="grid">${body}</div></body></html>`);
}

export const placeCard = (p: { name_ar: string; name_en: string; qr_token: string }, origin: string): QrCard => ({
  value: `${origin}/menu?t=${p.qr_token}`,
  titleAr: p.name_ar,
  titleEn: p.name_en,
  ctaAr: "امسح واطلب",
  ctaEn: "Scan to order",
});

export const wifiCard = (ssid: string, password: string): QrCard => ({
  value: wifiQrText(ssid, password),
  titleAr: "الواي فاي",
  titleEn: "Wi-Fi",
  ctaAr: "وجّه الكاميرا واتصل",
  ctaEn: "Point your camera to join",
  lines: [{ label: "Network · الشبكة", value: ssid }, ...(password ? [{ label: "Password · الباسورد", value: password }] : [])],
});
