// Billing math shared by the customer page and the staff counter.
// The server stores what the counter computes here, so this is the single source of truth
// for room fees. Item totals, discounts and checkout totals are re-checked by the server.

export type FeeSettings = {
  min_session_minutes: number;
  billing_step_minutes: number;
  grace_minutes: number;
};

export type FeeSegment = {
  mode_id: string;
  rate: number; // EGP per hour
  started_at: string;
  ended_at: string | null;
};

export type FeeLine = { mode_id: string; rate: number; minutes: number; amount: number };

export type RoomFee = {
  actualMinutes: number; // billable elapsed minutes (after fixed-session cap)
  elapsedMinutes: number; // wall-clock minutes from start to end
  billedMinutes: number; // after minimum + rounding step
  lines: FeeLine[]; // per segment
  extraMinutes: number; // added by minimum / rounding, billed at the last mode's rate
  extraRate: number;
  extraAmount: number;
  fee: number;
  overstayMinutes: number; // minutes past planned end (fixed sessions)
  overstayBeyondGrace: boolean;
  overstayCharged: boolean;
};

export const round2 = (x: number) => Math.round((x + Number.EPSILON) * 100) / 100;

const MIN = 60_000;

export function computeRoomFee(input: {
  segments: FeeSegment[];
  kind: "open" | "fixed";
  plannedEnd: string | null;
  end: Date | string;
  settings: FeeSettings;
  /** For fixed sessions that overstayed past the grace period: charge the extra time? Defaults to true. */
  chargeOverstay?: boolean;
}): RoomFee {
  const { settings } = input;
  const segs = [...input.segments].sort((a, b) => Date.parse(a.started_at) - Date.parse(b.started_at));
  const endMs = typeof input.end === "string" ? Date.parse(input.end) : input.end.getTime();
  const startMs = segs.length ? Date.parse(segs[0].started_at) : endMs;

  let effectiveEnd = endMs;
  let overstayMinutes = 0;
  let overstayBeyondGrace = false;
  let overstayCharged = false;
  if (input.kind === "fixed" && input.plannedEnd) {
    const planned = Date.parse(input.plannedEnd);
    overstayMinutes = Math.max(0, (endMs - planned) / MIN);
    overstayBeyondGrace = overstayMinutes > settings.grace_minutes;
    if (overstayBeyondGrace && (input.chargeOverstay ?? true)) {
      effectiveEnd = endMs;
      overstayCharged = true;
    } else {
      effectiveEnd = Math.min(endMs, planned);
    }
  }

  const lines: FeeLine[] = segs.map((s, i) => {
    const sStart = Date.parse(s.started_at);
    const nextStart = i + 1 < segs.length ? Date.parse(segs[i + 1].started_at) : Infinity;
    const sEnd = Math.min(s.ended_at ? Date.parse(s.ended_at) : Infinity, nextStart, effectiveEnd);
    const minutes = Math.max(0, (sEnd - sStart) / MIN);
    return { mode_id: s.mode_id, rate: s.rate, minutes, amount: (minutes * s.rate) / 60 };
  });

  const actual = Math.round(lines.reduce((a, l) => a + l.minutes, 0) * 1000) / 1000;
  const step = Math.max(1, settings.billing_step_minutes);
  const rounded = actual <= 0 ? 0 : Math.ceil(actual / step - 1e-9) * step;
  const billedMinutes = segs.length ? Math.max(settings.min_session_minutes, rounded) : 0;
  const extraMinutes = Math.max(0, billedMinutes - actual);
  const extraRate = segs.length ? segs[segs.length - 1].rate : 0;
  const extraAmount = (extraMinutes * extraRate) / 60;
  const fee = round2(lines.reduce((a, l) => a + l.amount, 0) + extraAmount);

  return {
    actualMinutes: actual,
    elapsedMinutes: Math.max(0, (endMs - startMs) / MIN),
    billedMinutes,
    lines: lines.map((l) => ({ ...l, amount: round2(l.amount) })),
    extraMinutes,
    extraRate,
    extraAmount: round2(extraAmount),
    fee,
    overstayMinutes,
    overstayBeyondGrace,
    overstayCharged,
  };
}

/** Equal split in piastres; the remainder goes to the first bill (the booker). */
export function splitEqual(fee: number, billIds: string[]): { bill_id: string; amount: number }[] {
  if (!billIds.length) return [];
  const cents = Math.round(fee * 100);
  const base = Math.floor(cents / billIds.length);
  const rem = cents - base * billIds.length;
  return billIds.map((id, i) => ({ bill_id: id, amount: (base + (i === 0 ? rem : 0)) / 100 }));
}

/**
 * Hour bundle against a room fee: covers billed minutes (segment by segment, then the
 * minimum/rounding minutes at the last mode) up to the balance. A bundle tied to a mode
 * only covers minutes in that mode. Returns the minutes used and their value.
 */
export function bundleCredit(fee: Pick<RoomFee, "lines" | "extraMinutes" | "extraRate" | "fee">, balanceMinutes: number, modeId: string | null) {
  let left = Math.max(0, balanceMinutes);
  let minutes = 0;
  let amount = 0;
  const parts = [...fee.lines.map((l) => ({ mode_id: l.mode_id, minutes: l.minutes, rate: l.rate }))];
  if (fee.extraMinutes > 0 && fee.lines.length) parts.push({ mode_id: fee.lines[fee.lines.length - 1].mode_id, minutes: fee.extraMinutes, rate: fee.extraRate });
  for (const p of parts) {
    if (left <= 0) break;
    if (modeId && p.mode_id !== modeId) continue;
    const take = Math.min(left, p.minutes);
    left -= take;
    minutes += take;
    amount += (take * p.rate) / 60;
  }
  minutes = Math.round(minutes * 100) / 100;
  return { minutes, amount: Math.min(round2(amount), fee.fee) };
}

export type DiscountInput ={ kind: "amount" | "percent" | null; value: number };

/** Mirrors the server's checkout math exactly. */
export function billTotals(itemsTotal: number, roomFeeShare: number, discount: DiscountInput) {
  const subtotal = round2(round2(itemsTotal) + round2(roomFeeShare));
  let discountAmount = 0;
  if (discount.kind === "amount") discountAmount = Math.min(round2(Math.max(0, discount.value || 0)), subtotal);
  else if (discount.kind === "percent") discountAmount = round2((subtotal * Math.min(100, Math.max(0, discount.value || 0))) / 100);
  const total = round2(subtotal - discountAmount);
  const percent = subtotal > 0 ? (discountAmount * 100) / subtotal : 0;
  return { subtotal, discountAmount, total, percent };
}

export function discountWithinCap(
  t: { discountAmount: number; percent: number },
  caps: { staff_discount_max_amount: number; staff_discount_max_percent: number },
) {
  return t.discountAmount <= caps.staff_discount_max_amount + 1e-9 && t.percent <= caps.staff_discount_max_percent + 0.001;
}

/** Business day in Cairo: the calendar date of (time − rollover hours). Mirrors public.business_day(). */
export function businessDay(at: Date | string, rolloverHour: number): string {
  const ms = (typeof at === "string" ? Date.parse(at) : at.getTime()) - rolloverHour * 3_600_000;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Cairo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(ms));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}
