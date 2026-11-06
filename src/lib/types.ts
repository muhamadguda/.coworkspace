// Row shapes as returned by staff_snapshot() / public_catalog(). Numeric columns arrive as JSON numbers.

import type { HappyHour } from "./billing";
export type { HappyHour };

export type Lang = "ar" | "en";
export type Role = "owner" | "staff";
export type PayMethod = "cash" | "instapay" | "vf_cash";

export type Settings = {
  id: number;
  venue_name: string;
  venue_address: string;
  venue_whatsapp: string;
  receipt_footer_ar: string;
  receipt_footer_en: string;
  min_session_minutes: number;
  billing_step_minutes: number;
  grace_minutes: number;
  day_rollover_hour: number;
  booking_warning_minutes: number;
  staff_discount_max_percent: number;
  staff_discount_max_amount: number;
  google_review_url?: string;
  loyalty_every?: number;
  loyalty_reward_minutes?: number;
  wifi_ssid?: string;
  wifi_password?: string;
  instapay_link?: string;
  updated_at?: string;
};

export type Place = {
  id: string;
  kind: "room" | "table" | "area";
  name_ar: string;
  name_en: string;
  sort: number;
  active: boolean;
  capacity?: number | null; // shared areas: seats
  qr_token?: string;
  busy?: boolean;
};

export type Mode = { id: string; name_ar: string; name_en: string; hourly_rate: number; sort: number; active: boolean; place_scope?: "room" | "area" | "all" };

export type Category = { id: string; name_ar: string; name_en: string; sort: number; active: boolean };

export type OptionChoice = { id: string; name_ar: string; name_en: string };
export type OptionGroup = { id: string; name_ar: string; name_en: string; choices: OptionChoice[] };

export type MenuItem = {
  id: string;
  category_id: string;
  name_ar: string;
  name_en: string;
  desc_ar: string;
  desc_en: string;
  price: number;
  image_url: string | null;
  options: OptionGroup[];
  available: boolean;
  active: boolean;
  sort: number;
  track_stock?: boolean;
  stock_qty?: number;
  low_stock_at?: number;
  stock_auto_off?: boolean;
};

export type BundlePlan = { id: string; name_ar: string; name_en: string; hours: number; price: number; valid_days: number; mode_id: string | null; active?: boolean; sort?: number };
export type CustomerBundle = {
  id: string;
  customer_id: string;
  plan_id: string | null;
  name_ar: string;
  name_en: string;
  mode_id: string | null;
  minutes_total: number;
  minutes_used: number;
  price: number;
  order_item_id: string | null;
  expires_at: string;
  voided_at: string | null;
  created_at: string;
  source?: "purchase" | "loyalty";
};
export type BundleUse = { id: string; bundle_id: string; session_id: string; minutes: number; amount: number; at: string };
export type StockMove = { id: number; menu_item_id: string; delta: number; qty_after: number; reason: string; note: string; at: string; by: string | null };

export type Customer = {
  id: string;
  phone: string;
  name: string;
  code: string | null; // null while created offline and not yet synced
  debt_limit: number;
  outstanding: number;
  created_at?: string;
  offers_opt_in?: boolean;
};

export type Session = {
  id: string;
  place_id: string;
  booker_customer_id: string;
  booking_id: string | null;
  kind: "open" | "fixed";
  planned_end: string | null;
  group_size: number | null;
  status: "active" | "ended";
  started_at: string;
  ended_at: string | null;
  alert_ack_for: string | null;
  billed_minutes: number | null;
  room_fee: number | null;
  overstay_charged: boolean | null;
  split_mode: "booker" | "equal" | null;
};

export type Segment = { id: string; session_id: string; mode_id: string; rate: number; started_at: string; ended_at: string | null };

export type Bill = {
  id: string;
  customer_id: string;
  place_id: string | null;
  session_id: string | null;
  status: "open" | "closed";
  opened_at: string;
  closed_at: string | null;
  business_day: string | null;
  room_fee_share: number;
  items_total: number | null;
  subtotal: number | null;
  discount_kind: "amount" | "percent" | null;
  discount_value: number | null;
  discount_amount: number;
  discount_reason: string | null;
  total: number | null;
  pay_later: number;
};

export type OrderStatus = "new" | "accepted" | "served" | "rejected" | "cancelled";

export type Order = {
  id: string;
  customer_id: string;
  place_id: string | null;
  bill_id: string | null;
  source: "qr" | "menu" | "staff";
  status: OrderStatus;
  note: string;
  created_at: string;
  accepted_at: string | null;
  served_at: string | null;
  cancel_reason: string | null;
};

export type ChosenOption = { group_id: string; choice_id: string; group_ar: string; group_en: string; choice_ar: string; choice_en: string };

export type OrderItem = {
  id: string;
  order_id: string;
  menu_item_id: string | null;
  name_ar: string;
  name_en: string;
  unit_price: number;
  qty: number;
  options: ChosenOption[];
  note: string;
  voided_at?: string | null;
  void_reason?: string | null;
};

export type ModePrice = { place_id: string; mode_id: string; hourly_rate: number };

export type Payment = {
  id: string;
  bill_id: string;
  method: PayMethod;
  amount: number;
  kind: "bill" | "debt";
  paid_at: string;
  business_day: string;
  voided_at?: string | null;
};

export type BookingStatus = "pending" | "confirmed" | "rejected" | "cancelled" | "started" | "no_show";

export type Booking = {
  id: string;
  customer_id: string;
  place_id: string;
  mode_id: string;
  starts_at: string;
  duration_minutes: number;
  group_size: number | null;
  note: string;
  status: BookingStatus;
  source: "customer" | "staff";
  session_id: string | null;
  created_at: string;
};

export type CashDay = {
  business_day: string;
  opening_float: number;
  opened_at: string;
  closing_counted: number | null;
  expected_cash: number | null;
  closed_at: string | null;
  note: string;
};

export type CashOut = { id: string; business_day: string; amount: number; reason: string; created_at: string };

export type StaffProfile = { user_id: string; phone: string; name: string; role: Role; active: boolean; created_at?: string };

export type Snapshot = {
  server_time: string;
  business_day: string;
  me: { user_id: string; phone: string; name: string; role: Role };
  settings: Settings;
  places: Place[];
  modes: Mode[];
  categories: Category[];
  items: MenuItem[];
  customers: Customer[];
  aliases: Record<string, string>;
  sessions: Session[];
  segments: Segment[];
  bills: Bill[];
  orders: Order[];
  order_items: OrderItem[];
  payments: Payment[];
  bookings: Booking[];
  cash_day: CashDay | null;
  last_cash_day: CashDay | null;
  cash_outs: CashOut[];
  staff: StaffProfile[];
  mode_prices?: ModePrice[];
  bundle_plans?: BundlePlan[];
  customer_bundles?: CustomerBundle[];
  bundle_uses?: BundleUse[];
  stock_moves?: StockMove[];
  visits?: Record<string, number>;
  happy_hours?: HappyHour[];
  staff_calls?: StaffCall[];
};

export type StaffCall = { id: string; place_id: string; reason: "help" | "water" | "bill"; created_at: string; handled_at: string | null; handled_by: string | null };

export type PublicEvent = {
  id: string;
  title_ar: string;
  title_en: string;
  desc_ar: string;
  desc_en: string;
  starts_at: string;
  ends_at: string | null;
  price: number;
  capacity: number | null;
  image_url: string;
  place: { name_ar: string; name_en: string } | null;
  seats_left: number | null;
};

export type Catalog = {
  settings: Pick<Settings, "venue_name" | "venue_address" | "venue_whatsapp" | "min_session_minutes" | "billing_step_minutes" | "grace_minutes" | "day_rollover_hour">;
  categories: Category[];
  items: MenuItem[];
  modes: Mode[];
  places: (Place & { busy: boolean })[];
  schedule: { place_id: string; starts_at: string; duration_minutes: number }[];
  mode_prices?: ModePrice[];
  bundle_plans?: BundlePlan[];
  review_url?: string;
  loyalty?: { every: number; reward_minutes: number };
  happy_hours?: HappyHour[];
  areas?: { id: string; capacity: number | null; occupied: number }[];
  events?: PublicEvent[];
};

// What a cart line sends to the server
export type CartLine = {
  key: string;
  menu_item_id: string;
  qty: number;
  options: ChosenOption[];
  note: string;
};
