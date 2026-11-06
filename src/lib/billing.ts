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

/** Happy hour: % off the hourly fee, on these weekdays (0 = Sunday, the day the window starts), Cairo time. */
export type HappyHour = {
  id: string;
  name_ar: string;
  name_en: string;
  days: number[];
  start_time: string; // "HH:MM"; an end earlier than the start runs past midnight
  end_time: string;
  percent_off: number;
  applies_to: "all" | "room" | "area";
  mode_id: string | null;
  active?: boolean;
};

/** amount is after any happy-hour discount; off is what the happy hour took away. */
export type FeeLine = { mode_id: string; rate: number; minutes: number; amount: number; off?: number };

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
  happyOff: number; // total taken off by happy hours (already out of fee)
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
  /** Happy hours, and the kind of place (they can apply to rooms only or shared areas only). */
  happy?: { hours: HappyHour[]; placeKind: "room" | "area" | "table" };
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

  const windows = input.happy && segs.length ? happyWindows(input.happy.hours, input.happy.placeKind, startMs, Math.max(effectiveEnd, startMs)) : [];

  const lines: FeeLine[] = segs.map((s, i) => {
    const sStart = Date.parse(s.started_at);
    const nextStart = i + 1 < segs.length ? Date.parse(segs[i + 1].started_at) : Infinity;
    const sEnd = Math.min(s.ended_at ? Date.parse(s.ended_at) : Infinity, nextStart, effectiveEnd);
    const minutes = Math.max(0, (sEnd - sStart) / MIN);
    const gross = (minutes * s.rate) / 60;
    const off = windows.length && minutes > 0 ? (discountedMinutes(windows, s.mode_id, sStart, sEnd) * s.rate) / 60 : 0;
    return { mode_id: s.mode_id, rate: s.rate, minutes, amount: gross - off, off };
  });

  const actual = Math.round(lines.reduce((a, l) => a + l.minutes, 0) * 1000) / 1000;
  const step = Math.max(1, settings.billing_step_minutes);
  const rounded = actual <= 0 ? 0 : Math.ceil(actual / step - 1e-9) * step;
  const billedMinutes = segs.length ? Math.max(settings.min_session_minutes, rounded) : 0;
  const extraMinutes = Math.max(0, billedMinutes - actual);
  const last = segs[segs.length - 1];
  const extraRate = segs.length ? last.rate : 0;
  // Minimum / rounding minutes are billed as if they came right at the end, at the price then.
  const extraPct = windows.length && extraMinutes > 0 ? percentAt(windows, last.mode_id, Math.max(startMs, Math.min(effectiveEnd, endMs) - 1)) : 0;
  const extraGross = (extraMinutes * extraRate) / 60;
  const extraOff = (extraGross * extraPct) / 100;
  const extraAmount = extraGross - extraOff;
  const fee = round2(lines.reduce((a, l) => a + l.amount, 0) + extraAmount);
  const happyOff = round2(lines.reduce((a, l) => a + (l.off ?? 0), 0) + extraOff);

  return {
    actualMinutes: actual,
    elapsedMinutes: Math.max(0, (endMs - startMs) / MIN),
    billedMinutes,
    lines: lines.map((l) => ({ ...l, amount: round2(l.amount), off: round2(l.off ?? 0) })),
    extraMinutes,
    extraRate,
    extraAmount: round2(extraAmount),
    fee,
    overstayMinutes,
    overstayBeyondGrace,
    overstayCharged,
    happyOff,
  };
}

// ---------------------------------------------------------------------------
// Happy hours: Cairo wall-clock windows turned into real instants (DST-aware via Intl).
// ---------------------------------------------------------------------------
type Window = { start: number; end: number; pct: number; mode: string | null };

const cairoParts = new Intl.DateTimeFormat("en-US", {
  timeZone: "Africa/Cairo",
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  weekday: "short",
});
const WD: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

function cairoNow(ms: number) {
  const parts = cairoParts.formatToParts(new Date(ms));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "0";
  return { y: +get("year"), m: +get("month"), d: +get("day"), h: +get("hour"), mi: +get("minute"), wd: WD[get("weekday")] ?? 0 };
}

/** The instant when Cairo's clock reads y-m-d h:mi. */
export function cairoInstant(y: number, m: number, d: number, h: number, mi: number): number {
  const naive = Date.UTC(y, m - 1, d, h, mi);
  let guess = naive - 2 * 3_600_000; // Cairo is UTC+2 or +3
  for (let i = 0; i < 3; i++) {
    const c = cairoNow(guess);
    const diff = naive - Date.UTC(c.y, c.m - 1, c.d, c.h, c.mi);
    if (diff === 0) break;
    guess += diff;
  }
  return guess;
}

const hm = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  return { h: h || 0, m: m || 0 };
};

export function happyWindows(hours: HappyHour[], placeKind: string, fromMs: number, toMs: number): Window[] {
  const list = hours.filter((x) => x.active !== false && x.percent_off > 0 && (x.applies_to === "all" || x.applies_to === placeKind));
  if (!list.length || toMs <= fromMs) return [];
  const out: Window[] = [];
  // Every Cairo calendar day from the one before the start (overnight windows) to the end.
  const first = cairoNow(fromMs - 24 * 3_600_000);
  let day = Date.UTC(first.y, first.m - 1, first.d);
  const lastDay = (() => { const c = cairoNow(toMs); return Date.UTC(c.y, c.m - 1, c.d); })();
  for (; day <= lastDay; day += 24 * 3_600_000) {
    const dt = new Date(day);
    const y = dt.getUTCFullYear(), m = dt.getUTCMonth() + 1, d = dt.getUTCDate(), wd = dt.getUTCDay();
    for (const x of list) {
      if (!x.days.includes(wd)) continue;
      const a = hm(x.start_time), b = hm(x.end_time);
      const start = cairoInstant(y, m, d, a.h, a.m);
      const overnight = b.h * 60 + b.m <= a.h * 60 + a.m;
      const endDay = overnight ? new Date(day + 24 * 3_600_000) : dt;
      const end = cairoInstant(endDay.getUTCFullYear(), endDay.getUTCMonth() + 1, endDay.getUTCDate(), b.h, b.m);
      if (end > fromMs && start < toMs) out.push({ start, end, pct: Math.min(100, x.percent_off), mode: x.mode_id });
    }
  }
  return out;
}

function percentAt(ws: Window[], mode: string, at: number) {
  let p = 0;
  for (const w of ws) if (w.start <= at && at < w.end && (!w.mode || w.mode === mode)) p = Math.max(p, w.pct);
  return p;
}

/** Minutes of [a, b) weighted by the best happy-hour % at each moment (e.g. 30 min at 50% → 15). */
function discountedMinutes(ws: Window[], mode: string, a: number, b: number) {
  const cuts = new Set<number>([a, b]);
  for (const w of ws) {
    if (w.mode && w.mode !== mode) continue;
    if (w.start > a && w.start < b) cuts.add(w.start);
    if (w.end > a && w.end < b) cuts.add(w.end);
  }
  const pts = [...cuts].sort((x, y) => x - y);
  let sum = 0;
  for (let i = 0; i + 1 < pts.length; i++) {
    const pct = percentAt(ws, mode, pts[i]);
    if (pct > 0) sum += ((pts[i + 1] - pts[i]) / MIN) * (pct / 100);
  }
  return sum;
}

/** Happy hours running at this moment (for "happy hour now" badges). */
export function happyNow(hours: HappyHour[], placeKind: string, at: number): HappyHour[] {
  return hours.filter((x) => happyWindows([x], placeKind, at, at + 1).some((w) => w.start <= at && at < w.end));
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
export function bundleCredit(fee: Pick<RoomFee, "lines" | "extraMinutes" | "extraRate" | "extraAmount" | "fee">, balanceMinutes: number, modeId: string | null) {
  let left = Math.max(0, balanceMinutes);
  let minutes = 0;
  let amount = 0;
  // Net rates: an hour bundle covers what the minutes actually cost, happy hour included.
  const net = (amount: number, minutes: number, rate: number) => (minutes > 0 ? (amount * 60) / minutes : rate);
  const parts = [...fee.lines.map((l) => ({ mode_id: l.mode_id, minutes: l.minutes, rate: net(l.amount, l.minutes, l.rate) }))];
  if (fee.extraMinutes > 0 && fee.lines.length) parts.push({ mode_id: fee.lines[fee.lines.length - 1].mode_id, minutes: fee.extraMinutes, rate: net(fee.extraAmount, fee.extraMinutes, fee.extraRate) });
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
