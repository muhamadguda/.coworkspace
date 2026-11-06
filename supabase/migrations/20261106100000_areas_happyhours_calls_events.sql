-- dot round 6. Additive only.
-- 1. Shared areas: a place of kind 'area' with a seat count. Each person gets their own timer
--    (a session of one), so many sessions run in one area at once, up to its capacity.
-- 2. Happy hours: % off the hourly fee on chosen days and times (Cairo time). The counter's
--    billing applies them per minute; the server stores what the counter charged, as before.
-- 3. Call staff: a button on the table's menu page rings the counter.
-- 4. Events: a public list with sign-ups.
-- 5. Offers list: customers who said yes to WhatsApp offers.
-- 6. Wi-Fi and InstaPay on the customer's bill page.

-- ---------------------------------------------------------------------------
-- 1. Shared areas
-- ---------------------------------------------------------------------------
alter table public.places drop constraint places_kind_check;
alter table public.places add constraint places_kind_check check (kind in ('room', 'table', 'area'));
alter table public.places add column capacity int check (capacity is null or capacity between 1 and 500);
grant select (capacity) on public.places to anon;

do $$
declare d text;
begin
  d := pg_get_functiondef('public.staff_op(jsonb)'::regprocedure);
  if position('select * into v_place from public.places where id = (p->>''place_id'')::uuid and kind = ''room'';' in d) = 0
     or position('if exists (select 1 from public.room_sessions where place_id = v_place.id and status = ''active'') then raise exception ''room_busy''; end if;' in d) = 0 then
    raise exception 'patch staff_op start_session failed';
  end if;
  d := replace(d, 'select * into v_place from public.places where id = (p->>''place_id'')::uuid and kind = ''room'';',
    'select * into v_place from public.places where id = (p->>''place_id'')::uuid and kind in (''room'', ''area'') for update;');
  d := replace(d, 'if exists (select 1 from public.room_sessions where place_id = v_place.id and status = ''active'') then raise exception ''room_busy''; end if;',
    'if v_place.kind = ''room'' and exists (select 1 from public.room_sessions where place_id = v_place.id and status = ''active'') then raise exception ''room_busy''; end if;
    if v_place.kind = ''area'' and v_place.capacity is not null
       and (select count(*) from public.room_sessions where place_id = v_place.id and status = ''active'') >= v_place.capacity then raise exception ''area_full''; end if;');
  execute d;
end $$;

-- "Room is free" pushes are for rooms; a seat freeing up in a shared area is not news.
create or replace function public.notify_room_free() returns trigger
language plpgsql security definer set search_path = public as $$
declare pl text[] := public.place_label(new.place_id);
begin
  if new.status = 'ended' and old.status = 'active' and (select kind from public.places where id = new.place_id) = 'room' then
    perform public.push_send(public.push_messages('room', new.place_id, array[pl[1] || ' فضيت', pl[2] || ' is free'], array['احجزها قبل ما حد ياخدها', 'Grab it before someone else does'], '/menu?tab=book', 'room-' || new.place_id));
    perform public.expire_watches('room', new.place_id);
  end if;
  return new;
end $$;
revoke execute on function public.notify_room_free() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Happy hours
-- ---------------------------------------------------------------------------
create table public.happy_hours (
  id uuid primary key default gen_random_uuid(),
  name_ar text not null default '' check (length(name_ar) <= 60),
  name_en text not null default '' check (length(name_en) <= 60),
  days int[] not null default '{0,1,2,3,4,5,6}' check (days <@ array[0,1,2,3,4,5,6] and cardinality(days) > 0),  -- 0 = Sunday; the day the window starts
  start_time time not null,
  end_time time not null,                 -- earlier than start_time = runs past midnight
  percent_off numeric(5,2) not null check (percent_off > 0 and percent_off <= 100),
  applies_to text not null default 'all' check (applies_to in ('all', 'room', 'area')),
  mode_id uuid references public.room_modes(id) on delete cascade,   -- null = every mode
  active boolean not null default true,
  sort int not null default 0,
  created_at timestamptz not null default now(),
  check (start_time <> end_time)
);
alter table public.happy_hours enable row level security;
create policy public_read on public.happy_hours for select to anon, authenticated using (active or public.is_staff());
create policy owner_write on public.happy_hours for all to authenticated using (public.is_owner()) with check (public.is_owner());

create or replace function public.happy_hours_json() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', h.id, 'name_ar', h.name_ar, 'name_en', h.name_en, 'days', to_jsonb(h.days),
      'start_time', to_char(h.start_time, 'HH24:MI'), 'end_time', to_char(h.end_time, 'HH24:MI'), 'percent_off', h.percent_off,
      'applies_to', h.applies_to, 'mode_id', h.mode_id) order by h.sort, h.start_time), '[]'::jsonb)
  from public.happy_hours h where h.active;
$$;
revoke execute on function public.happy_hours_json() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Call staff
-- ---------------------------------------------------------------------------
create table public.staff_calls (
  id uuid primary key default gen_random_uuid(),
  place_id uuid not null references public.places(id) on delete cascade,
  reason text not null check (reason in ('help', 'water', 'bill')),
  created_at timestamptz not null default now(),
  handled_at timestamptz,
  handled_by uuid references auth.users(id)
);
create index staff_calls_recent on public.staff_calls (created_at desc);
alter table public.staff_calls enable row level security;
create policy staff_read on public.staff_calls for select to authenticated using (public.is_staff());
alter publication supabase_realtime add table public.staff_calls;

create or replace function public.customer_call_staff(p_token text, p_reason text) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare v_place public.places; v_id uuid; pl text[]; b_ar text; b_en text;
begin
  if p_reason not in ('help', 'water', 'bill') then raise exception 'bad_request'; end if;
  select * into v_place from public.places where qr_token = coalesce(p_token, '') and active;
  if not found then raise exception 'bad_place'; end if;
  -- One open call per place and reason is enough; pressing again doesn't ring again.
  select id into v_id from public.staff_calls where place_id = v_place.id and reason = p_reason and handled_at is null
    and created_at > now() - interval '30 minutes';
  if v_id is not null then return jsonb_build_object('ok', true, 'id', v_id, 'duplicate', true); end if;
  if (select count(*) from public.staff_calls where place_id = v_place.id and created_at > now() - interval '10 minutes') >= 6
     or (select count(*) from public.staff_calls where created_at > now() - interval '1 minute') >= 30 then
    raise exception 'too_many_attempts';
  end if;
  insert into public.staff_calls (place_id, reason) values (v_place.id, p_reason) returning id into v_id;
  pl := public.place_label(v_place.id);
  b_ar := case p_reason when 'water' then 'عايزين مية' when 'bill' then 'عايزين يحاسبوا' else 'محتاجين حد' end;
  b_en := case p_reason when 'water' then 'Would like water' when 'bill' then 'Ready to pay' else 'Needs a hand' end;
  perform public.push_send(public.staff_push_messages(array['نداء من ' || pl[1], 'Call from ' || pl[2]], array[b_ar, b_en], '/staff#board', 'call-' || v_place.id, false));
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;
grant execute on function public.customer_call_staff(text, text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Events
-- ---------------------------------------------------------------------------
create table public.events (
  id uuid primary key default gen_random_uuid(),
  title_ar text not null check (length(title_ar) between 1 and 120),
  title_en text not null check (length(title_en) between 1 and 120),
  desc_ar text not null default '' check (length(desc_ar) <= 2000),
  desc_en text not null default '' check (length(desc_en) <= 2000),
  starts_at timestamptz not null,
  ends_at timestamptz,
  place_id uuid references public.places(id) on delete set null,
  price numeric(10,2) not null default 0 check (price >= 0),
  capacity int check (capacity is null or capacity between 1 and 2000),   -- null = no limit
  image_url text not null default '' check (image_url = '' or image_url ~ '^https://'),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  check (ends_at is null or ends_at > starts_at)
);
create table public.event_signups (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  customer_id uuid not null references public.customers(id),
  seats int not null default 1 check (seats between 1 and 10),
  note text not null default '' check (length(note) <= 300),
  status text not null default 'going' check (status in ('going', 'cancelled', 'attended')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_id, customer_id)
);
alter table public.events enable row level security;
alter table public.event_signups enable row level security;
create policy public_read on public.events for select to anon, authenticated using (active or public.is_staff());
create policy owner_write on public.events for all to authenticated using (public.is_owner()) with check (public.is_owner());
create policy staff_read on public.event_signups for select to authenticated using (public.is_staff());
create policy owner_write on public.event_signups for update to authenticated using (public.is_owner()) with check (public.is_owner());
alter publication supabase_realtime add table public.event_signups;

create or replace function public.event_seats_taken(p_event uuid) returns int
language sql stable security definer set search_path = public as $$
  select coalesce(sum(seats), 0)::int from public.event_signups where event_id = p_event and status in ('going', 'attended');
$$;
revoke execute on function public.event_seats_taken(uuid) from public, anon, authenticated;

create or replace function public.public_events() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'title_ar', e.title_ar, 'title_en', e.title_en, 'desc_ar', e.desc_ar, 'desc_en', e.desc_en,
      'starts_at', e.starts_at, 'ends_at', e.ends_at, 'price', e.price, 'capacity', e.capacity, 'image_url', e.image_url,
      'place', (select jsonb_build_object('name_ar', p.name_ar, 'name_en', p.name_en) from public.places p where p.id = e.place_id),
      'seats_left', case when e.capacity is null then null else greatest(0, e.capacity - public.event_seats_taken(e.id)) end)
    order by e.starts_at), '[]'::jsonb)
  from (select * from public.events where active and coalesce(ends_at, starts_at + interval '3 hours') > now()
        order by starts_at limit 30) e;
$$;
grant execute on function public.public_events() to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Offers list
-- ---------------------------------------------------------------------------
alter table public.customers
  add column offers_opt_in boolean not null default false,
  add column offers_opt_in_at timestamptz;

create or replace function public.customer_event_signup(p_event uuid, p_phone text, p_name text, p_seats int, p_note text, p_offers boolean)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare e public.events; v_cust jsonb; v_cid uuid; v_taken int; v_prev int; v_new boolean;
begin
  if p_seats is null or p_seats < 1 or p_seats > 10 then raise exception 'bad_seats'; end if;
  select * into e from public.events where id = p_event and active for update;
  if not found or coalesce(e.ends_at, e.starts_at + interval '3 hours') < now() then raise exception 'not_found'; end if;
  if (select count(*) from public.event_signups where updated_at > now() - interval '1 minute') >= 30 then raise exception 'too_many_attempts'; end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'name_required'; end if;
  v_cust := public.find_or_create_customer(p_phone, null, p_name, true);
  v_cid := (v_cust->>'id')::uuid;
  select seats into v_prev from public.event_signups where event_id = e.id and customer_id = v_cid and status in ('going', 'attended');
  v_new := v_prev is null;
  if e.capacity is not null then
    v_taken := public.event_seats_taken(e.id) - coalesce(v_prev, 0);
    if v_taken + p_seats > e.capacity then
      raise exception 'event_full';
    end if;
  end if;
  insert into public.event_signups (event_id, customer_id, seats, note, status)
  values (e.id, v_cid, p_seats, left(coalesce(p_note, ''), 300), 'going')
  on conflict (event_id, customer_id) do update set seats = excluded.seats, note = excluded.note, status = 'going', updated_at = now();
  -- A sign-up can say yes to offers, never no: saying no is done with the customer's code.
  if coalesce(p_offers, false) then
    update public.customers set offers_opt_in = true, offers_opt_in_at = now() where id = v_cid and not offers_opt_in;
  end if;
  if v_new then
    perform public.push_send(public.staff_push_messages(array['تسجيل في ' || e.title_ar, 'Sign-up: ' || e.title_en],
      array[coalesce(nullif(v_cust->>'name', ''), 'ضيف') || ' · ' || p_seats, coalesce(nullif(v_cust->>'name', ''), 'Guest') || ' · ' || p_seats],
      '/staff#events', 'event-' || e.id, true));
  end if;
  return jsonb_build_object('ok', true, 'updated', not v_new,
    'seats_left', case when e.capacity is null then null else greatest(0, e.capacity - public.event_seats_taken(e.id)) end);
end $$;
grant execute on function public.customer_event_signup(uuid, text, text, int, text, boolean) to anon, authenticated;

create or replace function public.customer_set_offers(p_phone text, p_code text, p_on boolean) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare v_phone text := public.normalize_phone(p_phone); v_key text := 'bill:' || public.normalize_phone(p_phone); c public.customers;
begin
  if not public.throttle_check(v_key) then return jsonb_build_object('error', 'too_many_attempts'); end if;
  select * into c from public.customers where phone = v_phone and code = trim(coalesce(p_code, ''));
  if not found then
    insert into public.lookup_attempts (key, ok) values (v_key, false);
    return jsonb_build_object('error', 'customer_not_found');
  end if;
  update public.customers set offers_opt_in = coalesce(p_on, false), offers_opt_in_at = now() where id = c.id;
  return jsonb_build_object('ok', true, 'offers_opt_in', coalesce(p_on, false));
end $$;
grant execute on function public.customer_set_offers(text, text, boolean) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. Wi-Fi and InstaPay
-- ---------------------------------------------------------------------------
alter table public.settings
  add column wifi_ssid text not null default '' check (length(wifi_ssid) <= 64),
  add column wifi_password text not null default '' check (length(wifi_password) <= 64),
  add column instapay_link text not null default '' check (instapay_link = '' or instapay_link ~ '^https://');

-- ---------------------------------------------------------------------------
-- Counter ops: handle a call, set a customer's offers choice. Everything else → staff_op3.
-- ---------------------------------------------------------------------------
create or replace function public.staff_op4(op jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public, extensions as $$
declare
  v_type text := op->>'type';
  v_uid uuid := auth.uid();
  v_role text;
  p jsonb := coalesce(op->'payload', '{}'::jsonb);
  v_at timestamptz := least(coalesce((op->>'at')::timestamptz, now()), now() + interval '2 minutes');
begin
  if v_type not in ('handle_call', 'set_offers') then
    return public.staff_op3(op);
  end if;
  select role into v_role from public.staff_profiles where user_id = v_uid and active;
  if v_role is null then raise exception 'not_staff'; end if;
  insert into public.applied_ops (op_id, type, actor) values ((op->>'id')::uuid, v_type, v_uid) on conflict (op_id) do nothing;
  if not found then return jsonb_build_object('ok', true, 'duplicate', true); end if;

  if v_type = 'handle_call' then
    update public.staff_calls set handled_at = coalesce(handled_at, v_at), handled_by = coalesce(handled_by, v_uid)
    where id = (p->>'call_id')::uuid
       or (p ? 'place_id' and place_id = (p->>'place_id')::uuid and handled_at is null);
  elsif v_type = 'set_offers' then
    update public.customers set offers_opt_in = coalesce((p->>'on')::boolean, false), offers_opt_in_at = v_at
    where id = public.resolve_customer((p->>'customer_id')::uuid);
    perform public.audit('set_offers', 'customers', p->>'customer_id', p);
  end if;
  return jsonb_build_object('ok', true);
end $$;
grant execute on function public.staff_op4(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Snapshot, catalog, bill page
-- ---------------------------------------------------------------------------
create or replace function public.staff_snapshot2() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  return public.staff_snapshot() || jsonb_build_object(
    'customers', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'phone', c.phone, 'name', c.name, 'code', c.code,
        'debt_limit', c.debt_limit, 'outstanding', public.customer_outstanding(c.id), 'created_at', c.created_at, 'offers_opt_in', c.offers_opt_in))
      from public.customers c where c.id in (select public.snapshot_customer_ids())), '[]'::jsonb),
    'bundle_plans', coalesce((select jsonb_agg(to_jsonb(b) order by b.sort, b.hours) from public.bundle_plans b), '[]'::jsonb),
    'customer_bundles', coalesce((select jsonb_agg(to_jsonb(c) order by c.created_at) from public.customer_bundles c
        where c.voided_at is null and (c.expires_at > now() - interval '14 days' or c.created_at > now() - interval '14 days')), '[]'::jsonb),
    'bundle_uses', coalesce((select jsonb_agg(to_jsonb(u) order by u.at) from public.bundle_uses u where u.at > now() - interval '35 days'), '[]'::jsonb),
    'stock_moves', coalesce((select jsonb_agg(to_jsonb(m) order by m.at desc) from (select * from public.stock_moves order by at desc limit 150) m), '[]'::jsonb),
    'visits', coalesce((select jsonb_object_agg(customer_id, n) from (
        select customer_id, count(distinct business_day)::int as n from public.bills
        where status = 'closed' and business_day is not null and customer_id in (select public.snapshot_customer_ids())
        group by customer_id) v), '{}'::jsonb),
    'happy_hours', coalesce((select jsonb_agg(to_jsonb(h) order by h.sort, h.start_time) from public.happy_hours h), '[]'::jsonb),
    'staff_calls', coalesce((select jsonb_agg(to_jsonb(k) order by k.created_at) from public.staff_calls k
        where k.created_at > now() - interval '12 hours'), '[]'::jsonb)
  );
end $$;

create or replace function public.public_catalog2() returns jsonb
language sql stable security definer set search_path = public as $$
  select public.public_catalog() || jsonb_build_object(
    'bundle_plans', coalesce((select jsonb_agg(jsonb_build_object('id', b.id, 'name_ar', b.name_ar, 'name_en', b.name_en, 'hours', b.hours,
        'price', b.price, 'valid_days', b.valid_days, 'mode_id', b.mode_id) order by b.sort, b.hours)
      from public.bundle_plans b where b.active), '[]'::jsonb),
    'review_url', (select google_review_url from public.settings where id = 1),
    'loyalty', (select jsonb_build_object('every', loyalty_every, 'reward_minutes', loyalty_reward_minutes) from public.settings where id = 1),
    'happy_hours', public.happy_hours_json(),
    'areas', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'capacity', p.capacity,
        'occupied', (select count(*) from public.room_sessions s where s.place_id = p.id and s.status = 'active')) order by p.sort)
      from public.places p where p.kind = 'area' and p.active), '[]'::jsonb),
    'events', public.public_events());
$$;

create or replace function public.customer_bill3(p_phone text, p_code text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r jsonb; c public.customers; st public.settings;
begin
  r := public.customer_bill2(p_phone, p_code);
  if r ? 'error' then return r; end if;
  select * into c from public.customers where phone = public.normalize_phone(p_phone) and code = trim(coalesce(p_code, ''));
  select * into st from public.settings where id = 1;
  return r || jsonb_build_object(
    'wifi', case when st.wifi_ssid = '' then null else jsonb_build_object('ssid', st.wifi_ssid, 'password', st.wifi_password) end,
    'instapay_link', nullif(st.instapay_link, ''),
    'happy_hours', public.happy_hours_json(),
    'offers_opt_in', c.offers_opt_in
  );
end $$;
grant execute on function public.customer_bill3(text, text) to anon, authenticated;
