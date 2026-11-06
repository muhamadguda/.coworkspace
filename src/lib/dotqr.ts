// dot-style QR codes: every module is a dot, the three corner eyes are rounded rings with a
// solid dot inside, and the brand's mustard dot sits in the middle. Error correction is "Q"
// (25%), so the centre mark costs nothing in scanning.
import QRCode from "qrcode";

export type DotQrOptions = {
  fg?: string; // dot colour (keep it dark: scanners read dark on light)
  bg?: string; // background ("transparent" allowed, but print on light paper)
  accent?: string; // the centre mark
  margin?: number; // quiet zone, in modules
  mark?: boolean; // draw the centre mark
  label?: string; // accessible name
};

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export function dotQrSvg(text: string, o: DotQrOptions = {}): string {
  const fg = o.fg ?? "#173a39";
  const bg = o.bg ?? "#ffffff";
  const accent = o.accent ?? "#d9a21b";
  const m = o.margin ?? 3;
  const qr = QRCode.create(text, { errorCorrectionLevel: "Q" });
  const n = qr.modules.size;
  const at = (r: number, c: number) => qr.modules.get(r, c) === 1 || (qr.modules.get(r, c) as unknown) === true;
  const inEye = (r: number, c: number) => (r < 7 && c < 7) || (r < 7 && c >= n - 7) || (r >= n - 7 && c < 7);

  // Centre mark: clear a round patch about 5 modules wide (well under the 25% Q can repair).
  const mid = (n - 1) / 2;
  const markR = o.mark === false ? 0 : Math.max(1.8, Math.round(n * 0.07 * 10) / 10);
  const inMark = (r: number, c: number) => markR > 0 && Math.hypot(r - mid, c - mid) < markR + 0.4;

  const dots: string[] = [];
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (!at(r, c) || inEye(r, c) || inMark(r, c)) continue;
      dots.push(`M${c + m + 0.5 - 0.47} ${r + m + 0.5}a.47 .47 0 1 0 .94 0a.47 .47 0 1 0-.94 0`);
    }
  }
  const eye = (r: number, c: number) => {
    const x = c + m, y = r + m;
    return `<rect x="${x + 0.5}" y="${y + 0.5}" width="6" height="6" rx="2.1" fill="none" stroke="${fg}" stroke-width="1"/><circle cx="${x + 3.5}" cy="${y + 3.5}" r="1.55" fill="${fg}"/>`;
  };
  const size = n + m * 2;
  const cx = mid + m + 0.5;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="geometricPrecision" role="img" aria-label="${esc(o.label ?? "QR code")}">`,
    bg === "transparent" ? "" : `<rect width="${size}" height="${size}" rx="${m * 0.8}" fill="${bg}"/>`,
    `<path fill="${fg}" d="${dots.join("")}"/>`,
    eye(0, 0),
    eye(0, n - 7),
    eye(n - 7, 0),
    markR > 0 ? `<circle cx="${cx}" cy="${cx}" r="${markR * 0.62}" fill="${accent}"/>` : "",
    `</svg>`,
  ].join("");
}

/** The text a phone camera turns into "Join this Wi-Fi". */
export function wifiQrText(ssid: string, password: string): string {
  const e = (s: string) => s.replace(/([\\;,:"])/g, "\\$1");
  return password ? `WIFI:T:WPA;S:${e(ssid)};P:${e(password)};;` : `WIFI:T:nopass;S:${e(ssid)};;`;
}
