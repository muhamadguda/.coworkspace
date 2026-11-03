// Optimistic local application of counter operations. Mirrors staff_op() on the server
// closely enough for the UI to keep working offline. Every case is idempotent: applying
// an op whose effect is already in the snapshot changes nothing.
import { billTotals, businessDay, round2 } from "@/lib/billing";
import { rateFor } from "@/lib/pricing";
import type { Bill, ChosenOption, Order, OrderItem, Snapshot } from "@/lib/types";

export type OpType =
  | "open_day"
  | "cash_out"
  | "close_day"
  | "ensure_customer"
  | "rename_customer"
  | "open_bill"
  | "start_session"
  | "change_mode"
  | "update_session"
  | "ack_session_alert"
  | "add_member"
  | "end_session"
  | "staff_order"
  | "accept_order"
  | "reject_order"
  | "serve_order"
  | "cancel_order"
  | "move_bill"
  | "checkout"
  | "pay_debt"
  | "booking_decide"
  | "booking_create"
  | "set_item_available"
  | "edit_item"
  | "transfer_booker";

export type Op = {
  id: string;
  type: OpType;
  at: string;
  payload: Record<string, unknown>;
  by?: string; // user id that queued it
};

export type ItemInput = { id?: string; menu_item_id: string; qty: number; options: { group_id: string; choice_id: string }[]; note?: string };

type P = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const upsert = <T extends { id: string }>(arr: T[], row: T) => {
  const i = arr.findIndex((x) => x.id === row.id);
  if (i === -1) return [...arr, row];
  const copy = arr.slice();
  copy[i] = { ...copy[i], ...row };
  return copy;
};
const patch = <T extends { id: string }>(arr: T[], id: string, f: (x: T) => Partial<T>) => arr.map((x) => (x.id === id ? { ...x, ...f(x) } : x));

export const resolveCustomer = (s: Snapshot, id: string) => s.aliases?.[id] ?? id;

export function buildOrderItems(s: Snapshot, orderId: string, items: ItemInput[]): OrderItem[] {
  return items.flatMap((it, idx) => {
    const m = s.items.find((x) => x.id === it.menu_item_id);
    if (!m) return [];
    const options: ChosenOption[] = (it.options ?? []).flatMap((o) => {
      const g = m.options.find((x) => x.id === o.group_id);
      const c = g?.choices.find((x) => x.id === o.choice_id);
      return g && c ? [{ group_id: g.id, choice_id: c.id, group_ar: g.name_ar, group_en: g.name_en, choice_ar: c.name_ar, choice_en: c.name_en }] : [];
    });
    return [{ id: it.id ?? `${orderId}:${idx}`, order_id: orderId, menu_item_id: m.id, name_ar: m.name_ar, name_en: m.name_en, unit_price: m.price, qty: it.qty, options, note: it.note ?? "" }];
  });
}

export function itemsTotalFor(s: Snapshot, billId: string) {
  const live = new Set(s.orders.filter((o) => o.bill_id === billId && (o.status === "accepted" || o.status === "served")).map((o) => o.id));
  return round2(s.order_items.filter((i) => live.has(i.order_id) && !i.voided_at).reduce((a, i) => a + i.qty * i.unit_price, 0));
}

function openBillOf(s: Snapshot, customerId: string) {
  return s.bills.find((b) => b.customer_id === customerId && b.status === "open");
}

function newBill(id: string, customerId: string, placeId: string | null, sessionId: string | null, at: string): Bill {
  return {
    id, customer_id: customerId, place_id: placeId, session_id: sessionId, status: "open", opened_at: at, closed_at: null, business_day: null,
    room_fee_share: 0, items_total: null, subtotal: null, discount_kind: null, discount_value: null, discount_amount: 0, discount_reason: null, total: null, pay_later: 0,
  };
}

export function applyOp(s: Snapshot, op: Op): Snapshot {
  const p = op.payload as P;
  const at = op.at;
  const rollover = s.settings.day_rollover_hour;
  switch (op.type) {
    case "open_day": {
      const day = businessDay(at, rollover);
      if (s.cash_day?.business_day === day) return s;
      return { ...s, cash_day: { business_day: day, opening_float: Number(p.opening_float) || 0, opened_at: at, closing_counted: null, expected_cash: null, closed_at: null, note: "" } };
    }
    case "cash_out":
      if (s.cash_outs.some((c) => c.id === p.id)) return s;
      return { ...s, cash_outs: [...s.cash_outs, { id: p.id, business_day: businessDay(at, rollover), amount: round2(Number(p.amount)), reason: p.reason, created_at: at }] };
    case "close_day":
      if (!s.cash_day || s.cash_day.business_day !== p.business_day) return s;
      return { ...s, cash_day: { ...s.cash_day, closing_counted: round2(Number(p.counted)), closed_at: at, note: p.note ?? "" } };
    case "ensure_customer": {
      if (s.customers.some((c) => c.id === p.id || c.phone === p.phone)) return s;
      return { ...s, customers: [...s.customers, { id: p.id, phone: p.phone, name: p.name ?? "", code: null, debt_limit: 0, outstanding: 0 }] };
    }
    case "rename_customer":
      return { ...s, customers: patch(s.customers, resolveCustomer(s, p.customer_id), () => ({ name: p.name })) };
    case "open_bill": {
      const cid = resolveCustomer(s, p.customer_id);
      if (s.bills.some((b) => b.id === p.id) || openBillOf(s, cid)) return s;
      return { ...s, bills: [...s.bills, newBill(p.id, cid, p.place_id ?? null, p.session_id ?? null, at)] };
    }
    case "start_session": {
      if (s.sessions.some((x) => x.id === p.id)) return s;
      const cid = resolveCustomer(s, p.customer_id);
      let bills = s.bills;
      const existing = openBillOf(s, cid);
      if (existing) bills = patch(bills, existing.id, () => ({ place_id: p.place_id, session_id: p.id }));
      else bills = [...bills, newBill(p.bill_id, cid, p.place_id, p.id, at)];
      return {
        ...s,
        sessions: [...s.sessions, {
          id: p.id, place_id: p.place_id, booker_customer_id: cid, booking_id: p.booking_id ?? null, kind: p.kind, planned_end: p.kind === "fixed" ? p.planned_end : null,
          group_size: p.group_size ?? null, status: "active", started_at: at, ended_at: null, alert_ack_for: null, billed_minutes: null, room_fee: null, overstay_charged: null, split_mode: null,
        }],
        segments: [...s.segments, { id: p.segment_id, session_id: p.id, mode_id: p.mode_id, rate: rateFor(s.modes, s.mode_prices, p.place_id, p.mode_id), started_at: at, ended_at: null }],
        bills,
        bookings: p.booking_id ? patch(s.bookings, p.booking_id, () => ({ status: "started" as const, session_id: p.id })) : s.bookings,
      };
    }
    case "change_mode": {
      if (s.segments.some((g) => g.id === p.segment_id)) return s;
      const placeId = s.sessions.find((x) => x.id === p.session_id)?.place_id;
      return {
        ...s,
        segments: [
          ...s.segments.map((g) => (g.session_id === p.session_id && !g.ended_at ? { ...g, ended_at: at } : g)),
          { id: p.segment_id, session_id: p.session_id, mode_id: p.mode_id, rate: rateFor(s.modes, s.mode_prices, placeId, p.mode_id), started_at: at, ended_at: null },
        ],
      };
    }
    case "update_session":
      return {
        ...s,
        sessions: patch(s.sessions, p.session_id, (x) => ({
          kind: p.kind ?? x.kind,
          planned_end: p.kind === "open" ? null : "planned_end" in p ? p.planned_end : x.planned_end,
          group_size: "group_size" in p ? (p.group_size ?? null) : x.group_size,
        })),
      };
    case "ack_session_alert":
      return { ...s, sessions: patch(s.sessions, p.session_id, () => ({ alert_ack_for: p.planned_end })) };
    case "add_member": {
      const cid = resolveCustomer(s, p.customer_id);
      const sess = s.sessions.find((x) => x.id === p.session_id);
      if (!sess) return s;
      const existing = openBillOf(s, cid);
      if (existing) return { ...s, bills: patch(s.bills, existing.id, () => ({ place_id: sess.place_id, session_id: sess.id })) };
      if (s.bills.some((b) => b.id === p.bill_id)) return s;
      return { ...s, bills: [...s.bills, newBill(p.bill_id, cid, sess.place_id, sess.id, at)] };
    }
    case "end_session": {
      const sess = s.sessions.find((x) => x.id === p.session_id);
      if (!sess || sess.status === "ended") return s;
      const shares = (p.shares ?? []) as { bill_id: string; amount: number }[];
      return {
        ...s,
        sessions: patch(s.sessions, sess.id, () => ({ status: "ended" as const, ended_at: at, billed_minutes: p.billed_minutes, room_fee: p.room_fee, overstay_charged: !!p.overstay_charged, split_mode: p.split_mode })),
        segments: s.segments.map((g) => (g.session_id === sess.id && !g.ended_at ? { ...g, ended_at: at } : g)),
        bills: s.bills.map((b) => {
          const sh = shares.find((x) => x.bill_id === b.id);
          return sh ? { ...b, room_fee_share: round2(sh.amount) } : b;
        }),
      };
    }
    case "staff_order": {
      if (s.orders.some((o) => o.id === p.order_id)) return s;
      const bill = s.bills.find((b) => b.id === p.bill_id);
      if (!bill) return s;
      const order: Order = { id: p.order_id, customer_id: bill.customer_id, place_id: bill.place_id, bill_id: bill.id, source: "staff", status: "accepted", note: p.note ?? "", created_at: at, accepted_at: at, served_at: null, cancel_reason: null };
      return { ...s, orders: [...s.orders, order], order_items: [...s.order_items, ...buildOrderItems(s, p.order_id, p.items ?? [])] };
    }
    case "accept_order": {
      const o = s.orders.find((x) => x.id === p.order_id);
      if (!o || o.status !== "new") return s;
      let bills = s.bills;
      let bill = openBillOf(s, o.customer_id);
      if (!bill) {
        const sess = o.place_id ? s.sessions.find((x) => x.place_id === o.place_id && x.status === "active") : undefined;
        bill = newBill(p.bill_id, o.customer_id, o.place_id, sess?.id ?? null, at);
        bills = [...bills, bill];
      }
      return { ...s, bills, orders: patch(s.orders, o.id, () => ({ status: "accepted" as const, bill_id: bill!.id, accepted_at: at })) };
    }
    case "reject_order":
      return { ...s, orders: s.orders.map((o) => (o.id === p.order_id && o.status === "new" ? { ...o, status: "rejected" as const, cancel_reason: p.reason ?? "" } : o)) };
    case "serve_order":
      return { ...s, orders: s.orders.map((o) => (o.id === p.order_id && o.status === "accepted" ? { ...o, status: "served" as const, served_at: at } : o)) };
    case "cancel_order":
      return { ...s, orders: s.orders.map((o) => (o.id === p.order_id && (o.status === "accepted" || o.status === "served") ? { ...o, status: "cancelled" as const, cancel_reason: p.reason } : o)) };
    case "move_bill": {
      const sess = p.place_id ? s.sessions.find((x) => x.place_id === p.place_id && x.status === "active") : undefined;
      return { ...s, bills: patch(s.bills, p.bill_id, () => ({ place_id: p.place_id ?? null, session_id: sess?.id ?? null })) };
    }
    case "checkout": {
      const bill = s.bills.find((b) => b.id === p.bill_id);
      if (!bill || bill.status !== "open") return s;
      const items = itemsTotalFor(s, bill.id);
      const tot = billTotals(items, bill.room_fee_share, { kind: p.discount_kind ?? null, value: Number(p.discount_value) || 0 });
      const day = businessDay(at, rollover);
      const pays = ((p.payments ?? []) as { id: string; method: "cash" | "instapay" | "vf_cash"; amount: number }[])
        .filter((x) => x.amount > 0)
        .map((x) => ({ id: x.id, bill_id: bill.id, method: x.method, amount: round2(x.amount), kind: "bill" as const, paid_at: at, business_day: day }));
      const payLater = round2(Number(p.pay_later) || 0);
      return {
        ...s,
        bills: patch(s.bills, bill.id, () => ({
          status: "closed" as const, closed_at: at, business_day: day, items_total: items, subtotal: tot.subtotal,
          discount_kind: tot.discountAmount > 0 ? p.discount_kind : null, discount_value: tot.discountAmount > 0 ? Number(p.discount_value) : null,
          discount_amount: tot.discountAmount, discount_reason: tot.discountAmount > 0 ? p.discount_reason : null, total: tot.total, pay_later: payLater,
        })),
        payments: [...s.payments.filter((x) => !pays.some((y) => y.id === x.id)), ...pays],
        customers: payLater > 0 ? patch(s.customers, bill.customer_id, (c) => ({ outstanding: round2(c.outstanding + payLater) })) : s.customers,
      };
    }
    case "pay_debt": {
      const cid = resolveCustomer(s, p.customer_id);
      if (s.payments.some((x) => x.id === op.id)) return s;
      const day = businessDay(at, rollover);
      return {
        ...s,
        customers: patch(s.customers, cid, (c) => ({ outstanding: round2(Math.max(0, c.outstanding - Number(p.amount))) })),
        payments: [...s.payments, { id: op.id, bill_id: "", method: p.method, amount: round2(Number(p.amount)), kind: "debt", paid_at: at, business_day: day }],
      };
    }
    case "booking_decide":
      return { ...s, bookings: patch(s.bookings, p.booking_id, () => ({ status: p.status })) };
    case "booking_create":
      if (s.bookings.some((b) => b.id === p.id)) return s;
      return {
        ...s,
        bookings: [...s.bookings, {
          id: p.id, customer_id: resolveCustomer(s, p.customer_id), place_id: p.place_id, mode_id: p.mode_id, starts_at: p.starts_at, duration_minutes: p.duration_minutes,
          group_size: p.group_size ?? null, note: p.note ?? "", status: "confirmed", source: "staff", session_id: null, created_at: at,
        }],
      };
    case "edit_item": {
      const q = Number(p.qty);
      return {
        ...s,
        order_items: s.order_items.map((i) =>
          i.id !== p.item_id || i.voided_at ? i : q === 0 ? { ...i, voided_at: at, void_reason: p.reason } : { ...i, qty: q },
        ),
      };
    }
    case "transfer_booker":
      return { ...s, sessions: patch(s.sessions, p.session_id, () => ({ booker_customer_id: resolveCustomer(s, p.customer_id) })) };
    case "set_item_available":
      return { ...s, items: patch(s.items, p.menu_item_id, () => ({ available: !!p.available })) };
    default:
      return s;
  }
}

export { upsert };
