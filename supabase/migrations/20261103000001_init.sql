-- dot: co-working space & café management
-- Schema, row-level security, and helper functions.
-- Money: numeric(10,2) EGP. Time: timestamptz, business day computed in Africa/Cairo.

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- Settings (single row)
-- ---------------------------------------------------------------------------
create table public.settings (
  id int primary key default 1 check (id = 1),
  venue_name text not null default 'dot',
  venue_address text not null default '',
  venue_whatsapp text not null default '',
  receipt_footer_ar text not null default 'نورتونا! مستنيينكم تاني',
  receipt_footer_en text not null default 'Thanks for coming. See you soon!',
  min_session_minutes int not null default 60 check (min_session_minutes between 0 and 600),
  billing_step_minutes int not null default 15 check (billing_step_minutes between 1 and 120),
  grace_minutes int not null default 10 check (grace_minutes between 0 and 120),
  day_rollover_hour int not null default 5 check (day_rollover_hour between 0 and 12),
  booking_warning_minutes int not null default 15 check (booking_warning_minutes between 0 and 240),
  staff_discount_max_percent numeric(5,2) not null default 20 check (staff_discount_max_percent between 0 and 100),
  staff_discount_max_amount numeric(10,2) not null default 50 check (staff_discount_max_amount >= 0),
  updated_at timestamptz not null default now()
);
insert into public.settings (id) values (1);

-- One-time owner setup (code hash only, never exposed)
create table public.app_setup (
  id int primary key default 1 check (id = 1),
  setup_code_hash text,
  claimed_at timestamptz
);
insert into public.app_setup (id) values (1);

-- ---------------------------------------------------------------------------
-- Staff
-- ---------------------------------------------------------------------------
create table public.staff_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  phone text not null unique check (phone ~ '^[0-9]{8,15}$'),
  name text not null check (length(name) between 1 and 80),
  role text not null check (role in ('owner','staff')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.staff_profiles where user_id = auth.uid() and active);
$$;

create or replace function public.is_owner() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.staff_profiles where user_id = auth.uid() and active and role = 'owner');
$$;

-- ---------------------------------------------------------------------------
-- Places, modes, menu
-- ---------------------------------------------------------------------------
create table public.places (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('room','table')),
  name_ar text not null,
  name_en text not null,
  sort int not null default 0,
  active boolean not null default true,
  qr_token text not null unique default encode(extensions.gen_random_bytes(6), 'hex'),
  created_at timestamptz not null default now()
);

create table public.room_modes (
  id uuid primary key default gen_random_uuid(),
  name_ar text not null,
  name_en text not null,
  hourly_rate numeric(10,2) not null check (hourly_rate >= 0),
  sort int not null default 0,
  active boolean not null default true
);

create table public.menu_categories (
  id uuid primary key default gen_random_uuid(),
  name_ar text not null,
  name_en text not null,
  sort int not null default 0,
  active boolean not null default true
);

create table public.menu_items (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.menu_categories(id) on delete restrict,
  name_ar text not null,
  name_en text not null,
  desc_ar text not null default '',
  desc_en text not null default '',
  price numeric(10,2) not null check (price >= 0),
  image_url text,
  -- [{ "id": "sugar", "name_ar": "...", "name_en": "...", "choices": [{ "id": "none", "name_ar": "...", "name_en": "..." }] }]
  options jsonb not null default '[]'::jsonb check (jsonb_typeof(options) = 'array'),
  available boolean not null default true,  -- sold-out toggle (staff)
  active boolean not null default true,     -- hidden from menu (owner)
  sort int not null default 0,
  created_at timestamptz not null default now()
);
create index on public.menu_items (category_id);

-- ---------------------------------------------------------------------------
-- Customers
-- ---------------------------------------------------------------------------
create table public.customers (
  id uuid primary key default gen_random_uuid(),
  phone text not null unique check (phone ~ '^[0-9]{8,15}$'),
  name text not null default '' check (length(name) <= 80),
  code text not null unique check (code ~ '^[0-9]{4,6}$'),
  debt_limit numeric(10,2) not null default 0 check (debt_limit >= 0),
  created_at timestamptz not null default now()
);

-- When the counter creates a customer offline and the same phone was created
-- online meanwhile, the offline id becomes an alias of the real one.
create table public.customer_aliases (
  alias_id uuid primary key,
  customer_id uuid not null references public.customers(id) on delete cascade
);

-- ---------------------------------------------------------------------------
-- Room sessions
-- ---------------------------------------------------------------------------
create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id),
  place_id uuid not null references public.places(id),
  mode_id uuid not null references public.room_modes(id),
  starts_at timestamptz not null,
  duration_minutes int not null check (duration_minutes between 15 and 1440),
  group_size int check (group_size between 1 and 100),
  note text not null default '' check (length(note) <= 300),
  status text not null default 'pending' check (status in ('pending','confirmed','rejected','cancelled','started','no_show')),
  source text not null check (source in ('customer','staff')),
  session_id uuid,
  decided_by uuid references auth.users(id),
  decided_at timestamptz,
  created_at timestamptz not null default now()
);
create index on public.bookings (place_id, starts_at);
create index on public.bookings (status);

create table public.room_sessions (
  id uuid primary key,
  place_id uuid not null references public.places(id),
  booker_customer_id uuid not null references public.customers(id),
  booking_id uuid references public.bookings(id),
  kind text not null check (kind in ('open','fixed')),
  planned_end timestamptz,
  group_size int check (group_size between 1 and 100),
  status text not null default 'active' check (status in ('active','ended')),
  started_at timestamptz not null,
  ended_at timestamptz,
  alert_ack_for timestamptz,          -- planned_end value whose time-up alert was acknowledged
  billed_minutes int,
  room_fee numeric(10,2),
  overstay_charged boolean,
  split_mode text check (split_mode in ('booker','equal')),
  started_by uuid references auth.users(id),
  ended_by uuid references auth.users(id),
  check (kind = 'open' or planned_end is not null)
);
create unique index room_sessions_one_active on public.room_sessions (place_id) where status = 'active';
alter table public.bookings add constraint bookings_session_fk foreign key (session_id) references public.room_sessions(id);

create table public.session_segments (
  id uuid primary key,
  session_id uuid not null references public.room_sessions(id) on delete cascade,
  mode_id uuid not null references public.room_modes(id),
  rate numeric(10,2) not null,
  started_at timestamptz not null,
  ended_at timestamptz
);
create index on public.session_segments (session_id);

-- ---------------------------------------------------------------------------
-- Bills, orders, payments
-- ---------------------------------------------------------------------------
create table public.bills (
  id uuid primary key,
  customer_id uuid not null references public.customers(id),
  place_id uuid references public.places(id),        -- null = counter / takeaway
  session_id uuid references public.room_sessions(id),
  status text not null default 'open' check (status in ('open','closed')),
  opened_at timestamptz not null,
  closed_at timestamptz,
  business_day date,
  room_fee_share numeric(10,2) not null default 0,
  items_total numeric(10,2),
  subtotal numeric(10,2),
  discount_kind text check (discount_kind in ('amount','percent')),
  discount_value numeric(10,2),
  discount_amount numeric(10,2) not null default 0,
  discount_reason text,
  discount_by uuid references auth.users(id),
  total numeric(10,2),
  pay_later numeric(10,2) not null default 0,
  opened_by uuid references auth.users(id),
  closed_by uuid references auth.users(id)
);
create unique index bills_one_open_per_customer on public.bills (customer_id) where status = 'open';
create index on public.bills (session_id);
create index on public.bills (business_day);

create table public.orders (
  id uuid primary key,
  customer_id uuid not null references public.customers(id),
  place_id uuid references public.places(id),
  bill_id uuid references public.bills(id),
  source text not null check (source in ('qr','menu','staff')),
  status text not null default 'new' check (status in ('new','accepted','served','rejected','cancelled')),
  note text not null default '' check (length(note) <= 300),
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  accepted_by uuid references auth.users(id),
  served_at timestamptz,
  cancel_reason text,
  cancelled_by uuid references auth.users(id)
);
create index on public.orders (status);
create index on public.orders (bill_id);

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  menu_item_id uuid references public.menu_items(id),
  name_ar text not null,
  name_en text not null,
  unit_price numeric(10,2) not null check (unit_price >= 0),
  qty int not null check (qty between 1 and 50),
  options jsonb not null default '[]'::jsonb,   -- [{group_ar, group_en, choice_ar, choice_en}]
  note text not null default '' check (length(note) <= 200)
);
create index on public.order_items (order_id);

create table public.payments (
  id uuid primary key,
  bill_id uuid not null references public.bills(id),
  method text not null check (method in ('cash','instapay','vf_cash')),
  amount numeric(10,2) not null check (amount > 0),
  kind text not null default 'bill' check (kind in ('bill','debt')),
  paid_at timestamptz not null,
  business_day date not null,
  created_by uuid references auth.users(id)
);
create index on public.payments (bill_id);
create index on public.payments (business_day);

-- ---------------------------------------------------------------------------
-- Cash drawer
-- ---------------------------------------------------------------------------
create table public.cash_days (
  business_day date primary key,
  opening_float numeric(10,2) not null check (opening_float >= 0),
  opened_at timestamptz not null,
  opened_by uuid references auth.users(id),
  closing_counted numeric(10,2),
  expected_cash numeric(10,2),
  closed_at timestamptz,
  closed_by uuid references auth.users(id),
  note text not null default ''
);

create table public.cash_outs (
  id uuid primary key,
  business_day date not null,
  amount numeric(10,2) not null check (amount > 0),
  reason text not null check (length(reason) between 1 and 200),
  created_at timestamptz not null,
  created_by uuid references auth.users(id)
);
create index on public.cash_outs (business_day);

-- ---------------------------------------------------------------------------
-- Audit, op log, throttling
-- ---------------------------------------------------------------------------
create table public.audit_log (
  id bigserial primary key,
  at timestamptz not null default now(),
  actor uuid references auth.users(id),
  action text not null,
  entity text,
  entity_id text,
  details jsonb not null default '{}'::jsonb
);
create index on public.audit_log (at desc);

create table public.applied_ops (
  op_id uuid primary key,
  type text not null,
  actor uuid,
  applied_at timestamptz not null default now()
);

create table public.lookup_attempts (
  id bigserial primary key,
  key text not null,
  ok boolean not null,
  at timestamptz not null default now()
);
create index on public.lookup_attempts (key, at);

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function public.business_day(ts timestamptz) returns date
language sql stable set search_path = public as $$
  select ((ts at time zone 'Africa/Cairo') - make_interval(hours => (select day_rollover_hour from public.settings where id = 1)))::date;
$$;

create or replace function public.gen_customer_code() returns text
language plpgsql volatile set search_path = public, extensions as $$
declare c text; i int := 0; len int := 4;
begin
  loop
    i := i + 1;
    if i > 60 then len := 5; end if;
    if i > 120 then len := 6; end if;
    c := lpad((floor(random() * power(10, len)))::bigint::text, len, '0');
    if left(c, 1) <> '0' and not exists (select 1 from public.customers where code = c) then
      return c;
    end if;
  end loop;
end $$;

create or replace function public.resolve_customer(p_id uuid) returns uuid
language sql stable set search_path = public as $$
  select coalesce((select customer_id from public.customer_aliases where alias_id = p_id), p_id);
$$;

create or replace function public.audit(p_action text, p_entity text, p_entity_id text, p_details jsonb default '{}'::jsonb)
returns void language sql volatile set search_path = public as $$
  insert into public.audit_log (actor, action, entity, entity_id, details) values (auth.uid(), p_action, p_entity, p_entity_id, coalesce(p_details, '{}'::jsonb));
$$;

-- Throttle: max 8 failed lookups per key per 15 minutes
create or replace function public.throttle_check(p_key text) returns boolean
language sql stable set search_path = public as $$
  select count(*) < 8 from public.lookup_attempts where key = p_key and not ok and at > now() - interval '15 minutes';
$$;

-- ---------------------------------------------------------------------------
-- Row level security
-- Staff read everything operational. Writes go through security-definer
-- functions (staff_op / owner RPCs) except owner-managed catalog tables.
-- Anonymous customers only read the public catalog.
-- ---------------------------------------------------------------------------
alter table public.settings enable row level security;
alter table public.app_setup enable row level security;
alter table public.staff_profiles enable row level security;
alter table public.places enable row level security;
alter table public.room_modes enable row level security;
alter table public.menu_categories enable row level security;
alter table public.menu_items enable row level security;
alter table public.customers enable row level security;
alter table public.customer_aliases enable row level security;
alter table public.bookings enable row level security;
alter table public.room_sessions enable row level security;
alter table public.session_segments enable row level security;
alter table public.bills enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.payments enable row level security;
alter table public.cash_days enable row level security;
alter table public.cash_outs enable row level security;
alter table public.audit_log enable row level security;
alter table public.applied_ops enable row level security;
alter table public.lookup_attempts enable row level security;

-- staff read
create policy staff_read on public.settings for select to authenticated using (public.is_staff());
create policy staff_read on public.staff_profiles for select to authenticated using (public.is_staff());
create policy staff_read on public.customers for select to authenticated using (public.is_staff());
create policy staff_read on public.customer_aliases for select to authenticated using (public.is_staff());
create policy staff_read on public.bookings for select to authenticated using (public.is_staff());
create policy staff_read on public.room_sessions for select to authenticated using (public.is_staff());
create policy staff_read on public.session_segments for select to authenticated using (public.is_staff());
create policy staff_read on public.bills for select to authenticated using (public.is_staff());
create policy staff_read on public.orders for select to authenticated using (public.is_staff());
create policy staff_read on public.order_items for select to authenticated using (public.is_staff());
create policy staff_read on public.payments for select to authenticated using (public.is_staff());
create policy staff_read on public.cash_days for select to authenticated using (public.is_staff());
create policy staff_read on public.cash_outs for select to authenticated using (public.is_staff());
create policy owner_read on public.audit_log for select to authenticated using (public.is_owner());

-- public catalog read (active rows) + staff read all
create policy public_read on public.places for select to anon, authenticated using (active or public.is_staff());
create policy public_read on public.room_modes for select to anon, authenticated using (active or public.is_staff());
create policy public_read on public.menu_categories for select to anon, authenticated using (active or public.is_staff());
create policy public_read on public.menu_items for select to anon, authenticated using (active or public.is_staff());

-- owner writes on catalog & settings
create policy owner_write on public.places for all to authenticated using (public.is_owner()) with check (public.is_owner());
create policy owner_write on public.room_modes for all to authenticated using (public.is_owner()) with check (public.is_owner());
create policy owner_write on public.menu_categories for all to authenticated using (public.is_owner()) with check (public.is_owner());
create policy owner_write on public.menu_items for all to authenticated using (public.is_owner()) with check (public.is_owner());
create policy owner_update on public.settings for update to authenticated using (public.is_owner()) with check (public.is_owner());

-- Hide the QR token from anonymous readers (they resolve tokens via RPC only)
revoke select on public.places from anon;
grant select (id, kind, name_ar, name_en, sort, active) on public.places to anon;

-- ---------------------------------------------------------------------------
-- Realtime: staff screens listen to these
-- ---------------------------------------------------------------------------
alter publication supabase_realtime add table public.orders, public.bookings, public.bills, public.room_sessions, public.menu_items, public.payments;

-- ---------------------------------------------------------------------------
-- Storage bucket for menu photos (public read, owner write)
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('menu', 'menu', true, 3145728, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;

create policy menu_owner_insert on storage.objects for insert to authenticated with check (bucket_id = 'menu' and public.is_owner());
create policy menu_owner_update on storage.objects for update to authenticated using (bucket_id = 'menu' and public.is_owner());
create policy menu_owner_delete on storage.objects for delete to authenticated using (bucket_id = 'menu' and public.is_owner());
