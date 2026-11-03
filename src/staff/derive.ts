import { businessDay, computeRoomFee, round2 } from "@/lib/billing";
import type { Bill, Booking, Customer, Order, OrderItem, Place, Session, Snapshot } from "@/lib/types";
import { itemsTotalFor } from "./reducer";

export const activeSessionAt = (s: Snapshot, placeId: string) => s.sessions.find((x) => x.place_id === placeId && x.status === "active");
export const segmentsOf = (s: Snapshot, sessionId: string) => s.segments.filter((g) => g.session_id === sessionId).sort((a, b) => a.started_at.localeCompare(b.started_at));
export const customerById = (s: Snapshot, id: string): Customer | undefined => s.customers.find((c) => c.id === (s.aliases?.[id] ?? id));
export const placeById = (s: Snapshot, id: string | null | undefined): Place | undefined => (id ? s.places.find((p) => p.id === id) : undefined);
export const openBills = (s: Snapshot) => s.bills.filter((b) => b.status === "open");
export const billsAtPlace = (s: Snapshot, placeId: string) => openBills(s).filter((b) => b.place_id === placeId);
export const billsInSession = (s: Snapshot, sessionId: string) => s.bills.filter((b) => b.session_id === sessionId && b.status === "open");
export const openBillOfCustomer = (s: Snapshot, customerId: string) => s.bills.find((b) => b.customer_id === (s.aliases?.[customerId] ?? customerId) && b.status === "open");
export const itemsOf = (s: Snapshot, orderId: string): OrderItem[] => s.order_items.filter((i) => i.order_id === orderId);
export const orderTotal = (s: Snapshot, orderId: string) => round2(itemsOf(s, orderId).filter((i) => !i.voided_at).reduce((a, i) => a + i.qty * i.unit_price, 0));
export const ordersOfBill = (s: Snapshot, billId: string): Order[] => s.orders.filter((o) => o.bill_id === billId).sort((a, b) => a.created_at.localeCompare(b.created_at));
export const billItemsTotal = itemsTotalFor;

export function liveRoomFee(s: Snapshot, session: Session, now: Date, chargeOverstay = true) {
  return computeRoomFee({
    segments: segmentsOf(s, session.id),
    kind: session.kind,
    plannedEnd: session.planned_end,
    end: session.status === "ended" && session.ended_at ? session.ended_at : now,
    settings: s.settings,
    chargeOverstay,
  });
}

/** Room share shown on a bill: final share once the session ended, otherwise a live estimate on the booker's bill. */
export function billRoomAmount(s: Snapshot, bill: Bill, now: Date): { amount: number; live: boolean } {
  if (!bill.session_id) return { amount: bill.room_fee_share, live: false };
  const sess = s.sessions.find((x) => x.id === bill.session_id);
  if (!sess || sess.status === "ended") return { amount: bill.room_fee_share, live: false };
  if (sess.booker_customer_id !== bill.customer_id) return { amount: 0, live: true };
  return { amount: liveRoomFee(s, sess, now).fee, live: true };
}

export function billRunningTotal(s: Snapshot, bill: Bill, now: Date) {
  return round2(billItemsTotal(s, bill.id) + billRoomAmount(s, bill, now).amount);
}

export const currentBusinessDay = (s: Snapshot, now = new Date()) => businessDay(now, s.settings.day_rollover_hour);

export function dayStats(s: Snapshot, day: string) {
  const pays = s.payments.filter((p) => p.business_day === day);
  const byMethod = { cash: 0, instapay: 0, vf_cash: 0 } as Record<"cash" | "instapay" | "vf_cash", number>;
  for (const p of pays) byMethod[p.method] = round2(byMethod[p.method] + p.amount);
  const outs = s.cash_outs.filter((c) => c.business_day === day);
  const cashOut = round2(outs.reduce((a, c) => a + c.amount, 0));
  const opening = s.cash_day?.business_day === day ? s.cash_day.opening_float : 0;
  return { byMethod, outs, cashOut, opening, expected: round2(opening + byMethod.cash - cashOut), total: round2(byMethod.cash + byMethod.instapay + byMethod.vf_cash) };
}

export function upcomingBookingFor(s: Snapshot, placeId: string, now: Date, withinMinutes: number): Booking | undefined {
  const limit = now.getTime() + withinMinutes * 60_000;
  return s.bookings
    .filter((b) => b.place_id === placeId && b.status === "confirmed" && Date.parse(b.starts_at) + b.duration_minutes * 60_000 > now.getTime() && Date.parse(b.starts_at) <= limit)
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at))[0];
}

export function searchCustomers(s: Snapshot, q: string, limit = 20): Customer[] {
  const query = q.trim().toLowerCase();
  if (!query) return [];
  const digits = query.replace(/\D/g, "");
  return s.customers
    .filter((c) => (digits && (c.phone.includes(digits) || c.code === digits)) || (c.name && c.name.toLowerCase().includes(query)))
    .slice(0, limit);
}

export const placeName = (p: Place | undefined, lang: "ar" | "en") => (p ? (lang === "ar" ? p.name_ar : p.name_en) : "");
