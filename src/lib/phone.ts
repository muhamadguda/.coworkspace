// Mirrors public.normalize_phone(): digits only, +20 / 0020 become a leading 0.
export function normalizePhone(input: string): string {
  const d = (input || "").replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x660)).replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 0x6f0)).replace(/\D/g, "");
  if (d.startsWith("0020")) return "0" + d.slice(4);
  if (d.startsWith("20") && d.length === 12) return "0" + d.slice(2);
  return d;
}

export const isValidPhone = (p: string) => /^[0-9]{8,15}$/.test(normalizePhone(p));

/** Converts Arabic-Indic digits typed on Arabic keyboards to Western digits. */
export function westernDigits(s: string): string {
  return s.replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x660)).replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 0x6f0)).replace(/٫/g, ".");
}

export function maskPhone(p: string): string {
  if (p.length < 7) return p;
  return p.slice(0, 3) + "•••" + p.slice(-4);
}
