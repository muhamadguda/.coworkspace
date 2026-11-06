import type { Mode, ModePrice } from "./types";

/** Hourly rate for a mode in a specific room: the room's override, else the mode's default. */
export function rateFor(modes: Mode[] | Pick<Mode, "id" | "hourly_rate">[], prices: ModePrice[] | undefined, placeId: string | null | undefined, modeId: string): number {
  const o = placeId ? prices?.find((x) => x.place_id === placeId && x.mode_id === modeId) : undefined;
  if (o) return o.hourly_rate;
  return modes.find((m) => m.id === modeId)?.hourly_rate ?? 0;
}

/** Is this mode offered in this kind of place? Rooms get room modes, shared areas get seat modes. */
export function modeFits(m: Pick<Mode, "place_scope">, kind: string | undefined): boolean {
  const scope = m.place_scope ?? "all";
  return scope === "all" || scope === (kind === "area" ? "area" : "room");
}
