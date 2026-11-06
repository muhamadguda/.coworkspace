import { test } from "node:test";
import assert from "node:assert/strict";
import { computeRoomFee, splitEqual, billTotals, discountWithinCap, businessDay, bundleCredit, cairoInstant, happyNow, type HappyHour } from "./billing.ts";

const S = { min_session_minutes: 60, billing_step_minutes: 15, grace_minutes: 10 };
const t0 = "2026-11-03T16:00:00.000Z";
const at = (min: number) => new Date(Date.parse(t0) + min * 60_000).toISOString();

test("minimum one hour applies to the whole session", () => {
  const r = computeRoomFee({ segments: [{ mode_id: "a", rate: 120, started_at: t0, ended_at: null }], kind: "open", plannedEnd: null, end: at(20), settings: S });
  assert.equal(r.billedMinutes, 60);
  assert.equal(r.fee, 120);
});

test("mode change bills each segment at its own rate, rounding at the last rate", () => {
  // 50 min @120 + 20 min @150 = 70 min -> 75 billed. 100 + 50 + 5 * 2.5 = 162.5
  const r = computeRoomFee({
    segments: [
      { mode_id: "a", rate: 120, started_at: t0, ended_at: at(50) },
      { mode_id: "b", rate: 150, started_at: at(50), ended_at: null },
    ],
    kind: "open", plannedEnd: null, end: at(70), settings: S,
  });
  assert.equal(r.billedMinutes, 75);
  assert.equal(r.fee, 162.5);
  assert.equal(r.lines[0].amount, 100);
  assert.equal(r.lines[1].amount, 50);
  assert.equal(r.extraAmount, 12.5);
});

test("short session with mode change still pays the minimum, extra at the last mode", () => {
  // 20 min single (40) + 10 min multi (25) = 30 min -> 60 billed, 30 extra @150 = 75 -> 140
  const r = computeRoomFee({
    segments: [
      { mode_id: "a", rate: 120, started_at: t0, ended_at: at(20) },
      { mode_id: "b", rate: 150, started_at: at(20), ended_at: null },
    ],
    kind: "open", plannedEnd: null, end: at(30), settings: S,
  });
  assert.equal(r.fee, 140);
});

test("exact step boundary does not round up", () => {
  const r = computeRoomFee({ segments: [{ mode_id: "a", rate: 120, started_at: t0, ended_at: null }], kind: "open", plannedEnd: null, end: at(90), settings: S });
  assert.equal(r.billedMinutes, 90);
  assert.equal(r.fee, 180);
});

test("fixed session: overstay within grace is free", () => {
  const r = computeRoomFee({ segments: [{ mode_id: "a", rate: 120, started_at: t0, ended_at: null }], kind: "fixed", plannedEnd: at(60), end: at(68), settings: S });
  assert.equal(r.overstayBeyondGrace, false);
  assert.equal(r.billedMinutes, 60);
  assert.equal(r.fee, 120);
});

test("fixed session: overstay beyond grace is charged by default, waivable", () => {
  const base = { segments: [{ mode_id: "a", rate: 120, started_at: t0, ended_at: null }], kind: "fixed" as const, plannedEnd: at(60), end: at(100), settings: S };
  const charged = computeRoomFee(base);
  assert.equal(charged.overstayBeyondGrace, true);
  assert.equal(charged.billedMinutes, 105);
  assert.equal(charged.fee, 210);
  const waived = computeRoomFee({ ...base, chargeOverstay: false });
  assert.equal(waived.billedMinutes, 60);
  assert.equal(waived.fee, 120);
});

test("fixed session left early bills actual time (with minimum)", () => {
  const r = computeRoomFee({ segments: [{ mode_id: "a", rate: 120, started_at: t0, ended_at: null }], kind: "fixed", plannedEnd: at(120), end: at(75), settings: S });
  assert.equal(r.billedMinutes, 75);
  assert.equal(r.fee, 150);
});

test("configurable settings: no minimum, 1-minute steps", () => {
  const r = computeRoomFee({ segments: [{ mode_id: "a", rate: 120, started_at: t0, ended_at: null }], kind: "open", plannedEnd: null, end: at(7), settings: { min_session_minutes: 0, billing_step_minutes: 1, grace_minutes: 0 } });
  assert.equal(r.billedMinutes, 7);
  assert.equal(r.fee, 14);
});

test("equal split keeps every piastre", () => {
  const s = splitEqual(100, ["booker", "b", "c"]);
  assert.deepEqual(s.map((x) => x.amount), [33.34, 33.33, 33.33]);
  assert.equal(s.reduce((a, x) => a + x.amount * 100, 0), 10000);
});

test("bill totals and discounts match server rules", () => {
  assert.deepEqual(billTotals(40, 162.5, { kind: "amount", value: 10 }).total, 192.5);
  assert.equal(billTotals(40, 0, { kind: "amount", value: 100 }).total, 0);
  const p = billTotals(80, 0, { kind: "percent", value: 12.5 });
  assert.equal(p.discountAmount, 10);
  assert.equal(p.total, 70);
  assert.equal(discountWithinCap(p, { staff_discount_max_amount: 50, staff_discount_max_percent: 20 }), true);
  const big = billTotals(80, 0, { kind: "percent", value: 50 });
  assert.equal(discountWithinCap(big, { staff_discount_max_amount: 50, staff_discount_max_percent: 20 }), false);
});

test("business day rolls over at 5am Cairo", () => {
  // Cairo is UTC+2 in November. 02:00 Cairo on Nov 4 = 00:00Z -> still Nov 3.
  assert.equal(businessDay("2026-11-04T00:00:00Z", 5), "2026-11-03");
  // 06:00 Cairo on Nov 4 = 04:00Z -> Nov 4
  assert.equal(businessDay("2026-11-04T04:00:00Z", 5), "2026-11-04");
});

test("bundle covers segments then rounding minutes, capped by balance", () => {
  const r = computeRoomFee({
    segments: [
      { mode_id: "a", rate: 120, started_at: t0, ended_at: at(50) },
      { mode_id: "b", rate: 150, started_at: at(50), ended_at: null },
    ],
    kind: "open", plannedEnd: null, end: at(70), settings: S,
  });
  // full balance: covers all 75 billed minutes = whole fee
  assert.deepEqual(bundleCredit(r, 600, null), { minutes: 75, amount: 162.5 });
  // 60 minutes left: 50 @120 + 10 @150 = 100 + 25
  assert.deepEqual(bundleCredit(r, 60, null), { minutes: 60, amount: 125 });
  // tied to mode b: 20 + 5 rounding minutes @150
  assert.deepEqual(bundleCredit(r, 600, "b"), { minutes: 25, amount: 62.5 });
  assert.deepEqual(bundleCredit(r, 0, null), { minutes: 0, amount: 0 });
});

// Happy hours. t0 = Tue 3 Nov 2026 18:00 Cairo (UTC+2 in November).
const hh = (o: Partial<HappyHour>): HappyHour => ({ id: "h", name_ar: "", name_en: "", days: [0, 1, 2, 3, 4, 5, 6], start_time: "18:30", end_time: "19:00", percent_off: 50, applies_to: "all", mode_id: null, ...o });
const one = (end: string) => ({ segments: [{ mode_id: "a", rate: 120, started_at: t0, ended_at: null }], kind: "open" as const, plannedEnd: null, end, settings: S });

test("happy hour takes its % off only the minutes inside the window", () => {
  const r = computeRoomFee({ ...one(at(90)), happy: { hours: [hh({})], placeKind: "room" } });
  assert.equal(r.fee, 150); // 180 − 30 min × 2 × 50%
  assert.equal(r.happyOff, 30);
  assert.equal(r.lines[0].off, 30);
});

test("overnight happy hour belongs to the day it starts", () => {
  const start = "2026-11-03T20:00:00.000Z"; // Tue 22:00 Cairo
  const base = { segments: [{ mode_id: "a", rate: 120, started_at: start, ended_at: null }], kind: "open" as const, plannedEnd: null, end: "2026-11-03T22:30:00.000Z", settings: S };
  const tue = computeRoomFee({ ...base, happy: { hours: [hh({ days: [2], start_time: "23:00", end_time: "01:00", percent_off: 100 })], placeKind: "room" } });
  assert.equal(tue.fee, 120); // 22:00–23:00 paid, 23:00–00:30 free
  const wed = computeRoomFee({ ...base, happy: { hours: [hh({ days: [3], start_time: "23:00", end_time: "01:00", percent_off: 100 })], placeKind: "room" } });
  assert.equal(wed.fee, 300);
});

test("minimum-time minutes are priced at the end time's happy hour", () => {
  const r = computeRoomFee({ ...one(at(20)), happy: { hours: [hh({ start_time: "18:00", end_time: "19:00" })], placeKind: "room" } });
  assert.equal(r.billedMinutes, 60);
  assert.equal(r.fee, 60);
});

test("happy hour for shared areas or another mode leaves a room alone", () => {
  assert.equal(computeRoomFee({ ...one(at(90)), happy: { hours: [hh({ applies_to: "area" })], placeKind: "room" } }).fee, 180);
  assert.equal(computeRoomFee({ ...one(at(90)), happy: { hours: [hh({ mode_id: "b" })], placeKind: "room" } }).fee, 180);
  assert.equal(computeRoomFee({ ...one(at(90)), happy: { hours: [hh({ applies_to: "area" })], placeKind: "area" } }).fee, 150);
});

test("overlapping happy hours: the bigger discount wins, never both", () => {
  const r = computeRoomFee({ ...one(at(90)), happy: { hours: [hh({ percent_off: 20 }), hh({ id: "x", percent_off: 50 })], placeKind: "room" } });
  assert.equal(r.fee, 150);
});

test("Cairo clock follows daylight saving", () => {
  assert.equal(new Date(cairoInstant(2026, 7, 1, 18, 0)).toISOString(), "2026-07-01T15:00:00.000Z");
  assert.equal(new Date(cairoInstant(2026, 11, 3, 18, 0)).toISOString(), "2026-11-03T16:00:00.000Z");
  assert.equal(happyNow([hh({})], "room", Date.parse(at(40))).length, 1);
  assert.equal(happyNow([hh({})], "room", Date.parse(at(10))).length, 0);
});

test("bundle credit covers what the minutes cost after the happy hour", () => {
  const r = computeRoomFee({ ...one(at(90)), happy: { hours: [hh({})], placeKind: "room" } });
  assert.deepEqual(bundleCredit(r, 600, null), { minutes: 90, amount: 150 });
});
