import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const alt = "dot · co-working space and café";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Link preview for WhatsApp, Facebook, X, iMessage: the wordmark on the cement-tile floor.
export default async function Image() {
  const svg = await readFile(join(process.cwd(), "public/logo-wordmark-light.svg"), "utf8");
  const logo = `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
  const tiles = Array.from({ length: 8 * 5 });
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", position: "relative", background: "#0e1f1e", fontFamily: "sans-serif" }}>
        <div style={{ position: "absolute", left: 0, top: 0, width: 1200, height: 630, display: "flex", flexDirection: "row", flexWrap: "wrap", alignContent: "flex-start" }}>
          {tiles.map((_, i) => (
            <div key={i} style={{ width: 150, height: 126, display: "flex", alignItems: "center", justifyContent: "center", border: "3px solid #0e1f1e", background: (i + Math.floor(i / 8)) % 2 ? "#173a39" : "#1d4645" }}>
              <div style={{ width: 34, height: 34, borderRadius: 34, background: i === 21 ? "#d9a21b" : "#24514f" }} />
            </div>
          ))}
        </div>
        <div style={{ position: "absolute", left: 80, top: 120, right: 80, bottom: 90, display: "flex", flexDirection: "column", justifyContent: "space-between", background: "rgba(14,31,30,0.9)", border: "4px solid #eaf0ea", borderTop: "16px solid #d9a21b", padding: "48px 56px" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={logo} width={282} height={158} alt="" />
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ color: "#eaf0ea", fontSize: 64, fontWeight: 700, letterSpacing: -1 }}>Focus. Work. Play.</div>
            <div style={{ color: "#b9c8c0", fontSize: 30 }}>Co-working · café · rooms by the hour · dotcowork.space</div>
          </div>
        </div>
      </div>
    ),
    size,
  );
}
