"use client";

import { useMemo } from "react";
import { dotQrSvg, type DotQrOptions } from "@/lib/dotqr";

/** A dot-style QR code. Sized by its container (className), square. */
export function DotQR({ value, className, ...o }: { value: string; className?: string } & DotQrOptions) {
  const svg = useMemo(() => dotQrSvg(value, o), [value, o.fg, o.bg, o.accent, o.margin, o.mark, o.label]); // eslint-disable-line react-hooks/exhaustive-deps
  return <div className={className} style={{ aspectRatio: "1 / 1", lineHeight: 0 }} dangerouslySetInnerHTML={{ __html: svg.replace("<svg ", '<svg width="100%" height="100%" ') }} />;
}
