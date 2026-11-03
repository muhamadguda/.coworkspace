"use client";

// Prints 80mm thermal receipts through a hidden iframe.
// On the counter PC, start Chrome with --kiosk-printing so it prints straight to the default printer.

import { formatMoney } from "./i18n";
import type { Lang } from "./types";

export type ReceiptLine = { label: string; sub?: string; qty?: number; amount: number };
export type ReceiptData = {
  lang: Lang;
  title: string; // "Receipt" / "Pre-bill" / "Day report"
  venue: { name: string; address: string; whatsapp: string; footer: string };
  meta: { label: string; value: string }[];
  lines: ReceiptLine[];
  totals: { label: string; value: number; strong?: boolean }[];
  payments?: { label: string; value: number }[];
  note?: string;
};

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

const LOGO = `<svg viewBox="-4 -4 282 158" width="120" height="68" xmlns="http://www.w3.org/2000/svg"><path fill="#000" fill-rule="evenodd" d="M0,100a50,50 0 1,0 100,0a50,50 0 1,0 -100,0zM20,100a30,30 0 1,1 60,0a30,30 0 1,1 -60,0z"/><path fill="#000" d="M80,150V10a10,10 0 0,1 20,0V150z"/><path fill="#000" d="M232,150V28a10,10 0 0,1 20,0V150z"/><rect fill="#000" x="212" y="52" width="60" height="20"/><circle cx="162" cy="100" r="44" fill="#000"/></svg>`;

export function receiptHtml(d: ReceiptData): string {
  const dir = d.lang === "ar" ? "rtl" : "ltr";
  const row = (l: string, v: string, cls = "") => `<div class="row ${cls}"><span>${l}</span><span class="n">${v}</span></div>`;
  return `<!doctype html><html lang="${d.lang}" dir="${dir}"><head><meta charset="utf-8"><title>${esc(d.title)}</title>
<style>
@page { size: 80mm auto; margin: 0; }
* { box-sizing: border-box; }
body { margin: 0; padding: 4mm 4mm 8mm; width: 80mm; font-family: "IBM Plex Sans Arabic", "Segoe UI", Tahoma, Arial, sans-serif; font-size: 12px; color: #000; }
.c { text-align: center; }
h1 { font-size: 15px; margin: 4px 0 2px; }
.small { font-size: 10.5px; }
hr { border: 0; border-top: 1px dashed #000; margin: 6px 0; }
.row { display: flex; justify-content: space-between; gap: 6px; padding: 1px 0; }
.row span:first-child { flex: 1; min-width: 0; }
.n { font-family: "IBM Plex Mono", Consolas, monospace; direction: ltr; unicode-bidi: isolate; white-space: nowrap; }
.sub { font-size: 10.5px; color: #333; padding-inline-start: 10px; }
.strong { font-weight: 700; font-size: 14px; }
</style></head><body>
<div class="c">${LOGO}<div class="small">${esc(d.venue.address)}</div>${d.venue.whatsapp ? `<div class="small n">WhatsApp ${esc(d.venue.whatsapp)}</div>` : ""}<h1>${esc(d.title)}</h1></div>
${d.meta.map((m) => row(esc(m.label), esc(m.value))).join("")}
<hr>
${d.lines
  .map((l) => row(`${l.qty ? `${l.qty}× ` : ""}${esc(l.label)}`, formatMoney(l.amount)) + (l.sub ? `<div class="sub">${esc(l.sub)}</div>` : ""))
  .join("")}
<hr>
${d.totals.map((t) => row(esc(t.label), formatMoney(t.value), t.strong ? "strong" : "")).join("")}
${d.payments?.length ? `<hr>${d.payments.map((p) => row(esc(p.label), formatMoney(p.value))).join("")}` : ""}
${d.note ? `<hr><div class="small">${esc(d.note)}</div>` : ""}
<hr><div class="c small">${esc(d.venue.footer)}</div><div class="c small">dotcowork.space</div>
</body></html>`;
}

export function printHtml(html: string) {
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden";
  document.body.appendChild(frame);
  const doc = frame.contentDocument!;
  doc.open();
  doc.write(html);
  doc.close();
  const go = () => {
    try {
      frame.contentWindow?.focus();
      frame.contentWindow?.print();
    } finally {
      setTimeout(() => frame.remove(), 2000);
    }
  };
  if (frame.contentDocument?.readyState === "complete") setTimeout(go, 50);
  else frame.onload = () => setTimeout(go, 50);
}
