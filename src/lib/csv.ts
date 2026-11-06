// CSV for Excel and Google Sheets: UTF-8 BOM so Arabic shows, and a guard against formulas.
export function csvCell(v: unknown) {
  let s = v == null ? "" : String(v);
  if (/^[=@\t\r]/.test(s) || /^[+-]\D/.test(s)) s = "'" + s;
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function downloadCsv(name: string, head: string[], rows: unknown[][]) {
  const lines = [head.map(csvCell).join(","), ...rows.map((r) => r.map(csvCell).join(","))];
  const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** +20 1012345678: international, with a space so spreadsheets keep it as text. */
export function intlPhone(waDigits: string) {
  return waDigits.startsWith("20") ? `+20 ${waDigits.slice(2)}` : `+${waDigits}`;
}
