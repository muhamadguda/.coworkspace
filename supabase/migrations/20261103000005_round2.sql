-- Round 2: per-room/per-mode prices, order item edits, booker transfer, bill reopen,
-- keep-alive ping, and blocking self sign-ups.

-- ---------------------------------------------------------------------------
-- Per-room, per-mode prices (blank = the mode's default price)
-- ---------------------------------------------------------------------------
create table public.room_mode_prices (
  place_id uuid not null references public.places(id) on delete cascade,
  mode_id uuid not null references public.room_modes(id) on delete cascade,
  hourly_rate numeric(10,2) not null check (hourly_rate >= 0),
  primary key (place_id, mode_id)
);
alter table public.room_mode_prices enable row level security;
create policy public_read on public.room_mode_prices for select to anon, authenticated using (true);
create policy owner_write on public.room_mode_prices for all to authenticated using (public.is_owner()) with check (public.is_owner());

create or replace function public.rate_for(p_place uuid, p_mode uuid) returns numeric
language sql stable set search_path = public as $$
  select coalesce(
    (select hourly_rate from public.room_mode_prices where place_id = p_place and mode_id = p_mode),
    (select hourly_rate from public.room_modes where id = p_mode));
$$;

-- Every new segment takes the room's price for that mode.
create or replace function public.segment_rate() returns trigger
language plpgsql set search_path = public as $$
begin
  new.rate := coalesce(public.rate_for((select place_id from public.room_sessions where id = new.session_id), new.mode_id), new.rate);
  return new;
end $$;
create trigger session_segments_rate before insert on public.session_segments for each row execute function public.segment_rate();

-- ---------------------------------------------------------------------------
-- Order item edits (void / change quantity)
-- ---------------------------------------------------------------------------
alter table public.order_items
  add column voided_at timestamptz,
  add column void_reason text,
  add column voided_by uuid references auth.users(id);

create or replace function public.bill_items_total(p_bill uuid) returns numeric
language sql stable set search_path = public as $$
  select public.money(coalesce(sum(oi.qty * oi.unit_price), 0))
  from public.orders o join public.order_items oi on oi.order_id = o.id
  where o.bill_id = p_bill and o.status in ('accepted','served') and oi.voided_at is null;
$$;

-- Patch existing function bodies in place (keeps one source of truth for each function).
do $$
declare d text;
  procedure_patch text;
begin
  -- insert_order_items: accept client-generated line ids (needed for offline edits)
  d := pg_get_functiondef('public.insert_order_items(uuid,jsonb,boolean)'::regprocedure);
  if position('insert into public.order_items (order_id,' in d) = 0 then raise exception 'patch insert_order_items failed'; end if;
  d := replace(d, 'insert into public.order_items (order_id,', 'insert into public.order_items (id, order_id,');
  d := replace(d, 'values (p_order, m.id,', 'values (coalesce((it->>''id'')::uuid, gen_random_uuid()), p_order, m.id,');
  execute d;

  -- customer_bill: hide voided lines
  d := pg_get_functiondef('public.customer_bill(text,text)'::regprocedure);
  if position('from public.order_items oi where oi.order_id = o.id' in d) = 0 then raise exception 'patch customer_bill failed'; end if;
  d := replace(d, 'from public.order_items oi where oi.order_id = o.id', 'from public.order_items oi where oi.order_id = o.id and oi.voided_at is null');
  execute d;

  -- staff_snapshot: include room price overrides
  d := pg_get_functiondef('public.staff_snapshot()'::regprocedure);
  if position('''staff'', case when' in d) = 0 then raise exception 'patch staff_snapshot failed'; end if;
  d := replace(d, '''staff'', case when', '''mode_prices'', coalesce((select jsonb_agg(to_jsonb(x)) from public.room_mode_prices x), ''[]''::jsonb),
    ''staff'', case when');
  execute d;

  -- public_catalog: include room price overrides
  d := pg_get_functiondef('public.public_catalog()'::regprocedure);
  if position('''schedule'',' in d) = 0 then raise exception 'patch public_catalog failed'; end if;
  d := replace(d, '''schedule'',', '''mode_prices'', coalesce((select jsonb_agg(to_jsonb(x)) from public.room_mode_prices x), ''[]''::jsonb),
    ''schedule'',');
  execute d;

  -- owner_report: exclude voided lines from top items, list voided lines
  d := pg_get_functiondef('public.owner_report(date,date)'::regprocedure);
  if position('where o.status in (''accepted'',''served'') and b.status = ''closed''' in d) = 0 or position('''cancellations'', coalesce(' in d) = 0 then raise exception 'patch owner_report failed'; end if;
  d := replace(d, 'where o.status in (''accepted'',''served'') and b.status = ''closed''', 'where o.status in (''accepted'',''served'') and oi.voided_at is null and b.status = ''closed''');
  d := replace(d, '''cancellations'', coalesce(', '''voided_items'', coalesce((select jsonb_agg(jsonb_build_object(''name_ar'', oi.name_ar, ''name_en'', oi.name_en, ''qty'', oi.qty, ''amount'', oi.qty * oi.unit_price, ''reason'', oi.void_reason, ''by'', sp.name, ''at'', oi.voided_at) order by oi.voided_at desc)
      from public.order_items oi left join public.staff_profiles sp on sp.user_id = oi.voided_by
      where oi.voided_at is not null and public.business_day(oi.voided_at) between p_from and p_to), ''[]''::jsonb),
    ''cancellations'', coalesce(');
  execute d;

  -- create_auth_user: allowed through the sign-up block below
  d := pg_get_functiondef('public.create_auth_user(text,text)'::regprocedure);
  if position('insert into auth.users' in d) = 0 then raise exception 'patch create_auth_user failed'; end if;
  d := replace(d, 'insert into auth.users', 'perform set_config(''dot.allow_user_create'', ''on'', true);
  insert into auth.users');
  execute d;
end $$;

-- ---------------------------------------------------------------------------
-- staff_op: new operations wrap the original function
-- ---------------------------------------------------------------------------
-- A guest who leaves early can pay their own bill while the room keeps running;
-- only the booker's bill waits for the session to end.
do $$
declare d text;
begin
  d := pg_get_functiondef('public.staff_op(jsonb)'::regprocedure);
  if position('where id = v_bill.session_id and status = ''active'') then
      raise exception ''session_still_active'';' in d) = 0 then raise exception 'patch staff_op checkout failed'; end if;
  d := replace(d, 'where id = v_bill.session_id and status = ''active'') then
      raise exception ''session_still_active'';', 'where id = v_bill.session_id and status = ''active'' and booker_customer_id = v_bill.customer_id) then
      raise exception ''session_still_active'';');
  execute d;
end $$;

alter function public.staff_op(jsonb) rename to staff_op_core;
revoke execute on function public.staff_op_core(jsonb) from public, anon, authenticated;

create or replace function public.staff_op(op jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public, extensions as $$
declare
  v_type text := op->>'type';
  v_uid uuid := auth.uid();
  v_role text;
  p jsonb := coalesce(op->'payload', '{}'::jsonb);
  v_at timestamptz := least(coalesce((op->>'at')::timestamptz, now()), now() + interval '2 minutes');
  r record; q int; v_cid uuid;
begin
  if v_type not in ('edit_item', 'transfer_booker') then
    return public.staff_op_core(op);
  end if;
  select role into v_role from public.staff_profiles where user_id = v_uid and active;
  if v_role is null then raise exception 'not_staff'; end if;
  insert into public.applied_ops (op_id, type, actor) values ((op->>'id')::uuid, v_type, v_uid) on conflict (op_id) do nothing;
  if not found then return jsonb_build_object('ok', true, 'duplicate', true); end if;

  if v_type = 'edit_item' then
    select oi.id, oi.qty, oi.voided_at, oi.name_en, oi.unit_price, o.status as ostatus, o.bill_id into r
    from public.order_items oi join public.orders o on o.id = oi.order_id where oi.id = (p->>'item_id')::uuid for update of oi;
    if not found then raise exception 'item_not_found'; end if;
    if r.ostatus not in ('accepted','served') or r.voided_at is not null then raise exception 'order_not_cancellable'; end if;
    if exists (select 1 from public.bills where id = r.bill_id and status = 'closed') then raise exception 'bill_closed'; end if;
    if coalesce(trim(p->>'reason'), '') = '' then raise exception 'reason_required'; end if;
    q := (p->>'qty')::int;
    if q = 0 then
      update public.order_items set voided_at = v_at, void_reason = left(trim(p->>'reason'), 200), voided_by = v_uid where id = r.id;
    elsif q between 1 and 50 then
      update public.order_items set qty = q where id = r.id;
    else
      raise exception 'bad_qty';
    end if;
    perform public.audit('edit_item', 'order_items', r.id::text, jsonb_build_object('item', r.name_en, 'from', r.qty, 'to', q, 'unit_price', r.unit_price, 'reason', p->>'reason'));

  elsif v_type = 'transfer_booker' then
    v_cid := public.resolve_customer((p->>'customer_id')::uuid);
    if not exists (select 1 from public.room_sessions where id = (p->>'session_id')::uuid and status = 'active') then raise exception 'session_not_active'; end if;
    if not exists (select 1 from public.bills where customer_id = v_cid and session_id = (p->>'session_id')::uuid and status = 'open') then raise exception 'not_in_session'; end if;
    update public.room_sessions set booker_customer_id = v_cid where id = (p->>'session_id')::uuid;
    perform public.audit('transfer_booker', 'room_sessions', p->>'session_id', p);
  end if;

  return jsonb_build_object('ok', true);
end $$;
grant execute on function public.staff_op(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Owner: reopen a closed bill to correct it (payments are removed and logged)
-- ---------------------------------------------------------------------------
create or replace function public.owner_reopen_bill(p_bill uuid, p_reason text) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare b public.bills; v_pays jsonb;
begin
  if not public.is_owner() then raise exception 'not_owner'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'reason_required'; end if;
  select * into b from public.bills where id = p_bill for update;
  if not found or b.status <> 'closed' then raise exception 'bill_not_closed'; end if;
  if exists (select 1 from public.payments where bill_id = b.id and kind = 'debt') then raise exception 'has_debt_payments'; end if;
  if exists (select 1 from public.bills where customer_id = b.customer_id and status = 'open') then raise exception 'customer_has_open_bill'; end if;
  select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) into v_pays from public.payments x where x.bill_id = b.id;
  delete from public.payments where bill_id = b.id and kind = 'bill';
  update public.bills set status = 'open', closed_at = null, closed_by = null, business_day = null, items_total = null, subtotal = null,
    discount_kind = null, discount_value = null, discount_amount = 0, discount_reason = null, discount_by = null, total = null, pay_later = 0
  where id = b.id;
  perform public.audit('reopen_bill', 'bills', b.id::text, jsonb_build_object('reason', trim(p_reason), 'total', b.total, 'pay_later', b.pay_later, 'discount', b.discount_amount, 'payments', v_pays));
  return jsonb_build_object('ok', true);
end $$;
grant execute on function public.owner_reopen_bill(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Keep-alive: a scheduled ping adds and removes a row so the free project
-- never counts as inactive.
-- ---------------------------------------------------------------------------
create table public.keepalive (id bigserial primary key, at timestamptz not null default now(), source text not null default 'cron');
alter table public.keepalive enable row level security;

create or replace function public.keepalive(p_source text default 'cron') returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare n int;
begin
  insert into public.keepalive (source) values (left(coalesce(p_source, 'cron'), 40));
  delete from public.keepalive;
  get diagnostics n = row_count;
  return jsonb_build_object('ok', true, 'cycled', n, 'at', now());
end $$;
grant execute on function public.keepalive(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Block self sign-ups: only create_auth_user (owner setup / Team screen) may add users.
-- ---------------------------------------------------------------------------
create or replace function public.block_external_signup() returns trigger
language plpgsql set search_path = public as $$
begin
  if coalesce(current_setting('dot.allow_user_create', true), '') <> 'on' then
    raise exception 'signups_disabled';
  end if;
  return new;
end $$;
create trigger block_external_signup before insert on auth.users for each row execute function public.block_external_signup();

revoke execute on function public.rate_for(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.segment_rate() from public, anon, authenticated;
revoke execute on function public.block_external_signup() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Push notifications (Web Push) and app error log
-- The database decides who to notify and posts to /api/push (Vercel), which
-- holds the VAPID private key and delivers. Secrets live in app_secrets
-- (no policies: invisible to API callers) and are set outside migrations.
-- ---------------------------------------------------------------------------
create extension if not exists pg_net with schema extensions;

create table public.app_secrets (
  id int primary key default 1 check (id = 1),
  push_secret text,
  push_url text not null default 'https://www.dotcowork.space/api/push'
);
insert into public.app_secrets (id) values (1);
alter table public.app_secrets enable row level security;

create table public.push_subscriptions (
  endpoint text primary key,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);
alter table public.push_subscriptions enable row level security;

-- What each device wants to hear about.
-- kind: order (ref = order id), booking (ref = booking id), room (ref = place id), staff (ref = user id)
create table public.push_watches (
  id bigserial primary key,
  endpoint text not null references public.push_subscriptions(endpoint) on delete cascade,
  kind text not null check (kind in ('order','booking','room','staff')),
  ref uuid not null,
  lang text not null default 'ar' check (lang in ('ar','en')),
  expires_at timestamptz not null default now() + interval '2 days',
  created_at timestamptz not null default now(),
  unique (endpoint, kind, ref)
);
create index on public.push_watches (kind, ref);
alter table public.push_watches enable row level security;

create table public.app_errors (
  id bigserial primary key,
  at timestamptz not null default now(),
  source text not null,
  message text not null,
  detail text,
  url text,
  user_agent text,
  user_id uuid
);
create index on public.app_errors (at desc);
alter table public.app_errors enable row level security;
create policy owner_read on public.app_errors for select to authenticated using (public.is_owner());

create or replace function public.push_save_subscription(p_sub jsonb) returns text
language plpgsql volatile set search_path = public as $$
declare v_endpoint text := p_sub->>'endpoint';
begin
  if v_endpoint is null or v_endpoint !~ '^https://' or length(v_endpoint) > 1000 then raise exception 'bad_subscription'; end if;
  insert into public.push_subscriptions (endpoint, p256dh, auth)
  values (v_endpoint, p_sub->'keys'->>'p256dh', p_sub->'keys'->>'auth')
  on conflict (endpoint) do update set p256dh = excluded.p256dh, auth = excluded.auth;
  return v_endpoint;
end $$;

-- Customer: watch an order / booking (the uuid is the proof: only the device that made it knows it),
-- or a room becoming free.
create or replace function public.customer_push_watch(p_sub jsonb, p_kind text, p_ref uuid, p_lang text) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare v_endpoint text;
begin
  if p_kind = 'order' and not exists (select 1 from public.orders where id = p_ref) then raise exception 'not_found'; end if;
  if p_kind = 'booking' and not exists (select 1 from public.bookings where id = p_ref) then raise exception 'not_found'; end if;
  if p_kind = 'room' and not exists (select 1 from public.places where id = p_ref and kind = 'room' and active) then raise exception 'not_found'; end if;
  if p_kind not in ('order','booking','room') then raise exception 'bad_kind'; end if;
  v_endpoint := public.push_save_subscription(p_sub);
  if (select count(*) from public.push_watches where endpoint = v_endpoint and expires_at > now()) >= 20 then raise exception 'too_many'; end if;
  insert into public.push_watches (endpoint, kind, ref, lang, expires_at)
  values (v_endpoint, p_kind, p_ref, case when p_lang = 'en' then 'en' else 'ar' end,
          now() + case p_kind when 'booking' then interval '30 days' when 'room' then interval '12 hours' else interval '1 day' end)
  on conflict (endpoint, kind, ref) do update set expires_at = excluded.expires_at, lang = excluded.lang;
  return jsonb_build_object('ok', true);
end $$;

-- Staff/owner device: new orders, booking requests (and errors for owners).
create or replace function public.staff_push_subscribe(p_sub jsonb, p_lang text, p_on boolean) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare v_endpoint text;
begin
  if not public.is_staff() then raise exception 'not_staff'; end if;
  v_endpoint := public.push_save_subscription(p_sub);
  delete from public.push_watches where endpoint = v_endpoint and kind = 'staff';
  if p_on then
    insert into public.push_watches (endpoint, kind, ref, lang, expires_at)
    values (v_endpoint, 'staff', auth.uid(), case when p_lang = 'en' then 'en' else 'ar' end, now() + interval '10 years');
  end if;
  return jsonb_build_object('ok', true, 'on', p_on);
end $$;

create or replace function public.staff_push_status(p_endpoint text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.push_watches where endpoint = p_endpoint and kind = 'staff' and ref = auth.uid());
$$;

-- Send: hand the messages to the Vercel /api/push route (async via pg_net).
create or replace function public.push_send(p_messages jsonb) returns void
language plpgsql volatile security definer set search_path = public, extensions as $$
declare s public.app_secrets;
begin
  if p_messages is null or jsonb_array_length(p_messages) = 0 then return; end if;
  select * into s from public.app_secrets where id = 1;
  if s.push_secret is null then return; end if;
  perform net.http_post(
    url := s.push_url,
    body := jsonb_build_object('messages', p_messages),
    headers := jsonb_build_object('content-type', 'application/json', 'x-push-secret', s.push_secret)
  );
exception when others then
  -- never let notifications break the operation that triggered them
  null;
end $$;

-- Build messages for one watch kind/ref. title/body come as [ar, en].
create or replace function public.push_messages(p_kind text, p_ref uuid, p_title text[], p_body text[], p_url text, p_tag text) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth,
    'title', case when w.lang = 'en' then p_title[2] else p_title[1] end,
    'body', case when w.lang = 'en' then p_body[2] else p_body[1] end,
    'url', p_url, 'tag', p_tag)), '[]'::jsonb)
  from public.push_watches w join public.push_subscriptions s on s.endpoint = w.endpoint
  where w.kind = p_kind and (p_ref is null or w.ref = p_ref) and w.expires_at > now();
$$;

create or replace function public.staff_push_messages(p_title text[], p_body text[], p_url text, p_tag text, p_owner_only boolean) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth,
    'title', case when w.lang = 'en' then p_title[2] else p_title[1] end,
    'body', case when w.lang = 'en' then p_body[2] else p_body[1] end,
    'url', p_url, 'tag', p_tag)), '[]'::jsonb)
  from public.push_watches w join public.push_subscriptions s on s.endpoint = w.endpoint
  join public.staff_profiles sp on sp.user_id = w.ref and sp.active
  where w.kind = 'staff' and (not p_owner_only or sp.role = 'owner');
$$;

create or replace function public.place_label(p_place uuid) returns text[]
language sql stable set search_path = public as $$
  select coalesce((select array[name_ar, name_en] from public.places where id = p_place), array['الكاونتر', 'the counter']);
$$;

create or replace function public.notify_order_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare pl text[] := public.place_label(new.place_id);
begin
  if tg_op = 'INSERT' and new.status = 'new' then
    perform public.push_send(public.staff_push_messages(
      array['طلب جديد', 'New order'], array['من ' || pl[1], 'From ' || pl[2]], '/staff#orders', 'orders', false));
  elsif tg_op = 'UPDATE' and new.status is distinct from old.status then
    if new.status = 'accepted' then
      perform public.push_send(public.push_messages('order', new.id, array['طلبك اتأكد', 'Order confirmed'], array['بيتحضر دلوقتي', 'It''s being prepared now'], '/menu', 'order-' || new.id));
    elsif new.status = 'served' then
      perform public.push_send(public.push_messages('order', new.id,
        case when new.place_id is null then array['طلبك جاهز', 'Your order is ready'] else array['طلبك في الطريق', 'Your order is on its way'] end,
        case when new.place_id is null then array['استلمه من الكاونتر', 'Pick it up at the counter'] else array['هيوصلك ' || pl[1], 'Coming to ' || pl[2]] end, '/menu', 'order-' || new.id));
      delete from public.push_watches where kind = 'order' and ref = new.id;
    elsif new.status = 'rejected' then
      perform public.push_send(public.push_messages('order', new.id, array['معرفناش نأكد طلبك', 'We couldn''t accept your order'], array['كلم الكاونتر لو محتاج حاجة', 'Ask at the counter if you need anything'], '/menu', 'order-' || new.id));
      delete from public.push_watches where kind = 'order' and ref = new.id;
    end if;
  end if;
  return new;
end $$;
create trigger orders_notify after insert or update of status on public.orders for each row execute function public.notify_order_change();

create or replace function public.notify_booking_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare pl text[] := public.place_label(new.place_id);
  t_ar text := to_char(new.starts_at at time zone 'Africa/Cairo', 'DD/MM HH12:MI AM');
begin
  if tg_op = 'INSERT' and new.status = 'pending' then
    perform public.push_send(public.staff_push_messages(
      array['طلب حجز جديد', 'New booking request'], array[pl[1] || ' · ' || t_ar, pl[2] || ' · ' || t_ar], '/staff#bookings', 'bookings', false));
  elsif tg_op = 'UPDATE' and new.status is distinct from old.status then
    if new.status = 'confirmed' then
      perform public.push_send(public.push_messages('booking', new.id, array['حجزك اتأكد', 'Booking confirmed'], array[pl[1] || ' · ' || t_ar, pl[2] || ' · ' || t_ar], '/menu?tab=bill', 'booking-' || new.id));
    elsif new.status in ('rejected', 'cancelled') then
      perform public.push_send(public.push_messages('booking', new.id, array['الحجز مش متاح', 'Booking not available'], array[pl[1] || ' · ' || t_ar, pl[2] || ' · ' || t_ar], '/menu?tab=book', 'booking-' || new.id));
      delete from public.push_watches where kind = 'booking' and ref = new.id;
    end if;
  end if;
  return new;
end $$;
create trigger bookings_notify after insert or update of status on public.bookings for each row execute function public.notify_booking_change();

create or replace function public.notify_room_free() returns trigger
language plpgsql security definer set search_path = public as $$
declare pl text[] := public.place_label(new.place_id);
begin
  if new.status = 'ended' and old.status = 'active' then
    perform public.push_send(public.push_messages('room', new.place_id, array[pl[1] || ' فضيت', pl[2] || ' is free'], array['احجزها قبل ما حد ياخدها', 'Grab it before someone else does'], '/menu?tab=book', 'room-' || new.place_id));
    delete from public.push_watches where kind = 'room' and ref = new.place_id;
  end if;
  return new;
end $$;
create trigger room_sessions_notify after update of status on public.room_sessions for each row execute function public.notify_room_free();

-- Called by /api/push to drop subscriptions the push service says are gone.
create or replace function public.push_prune(p_secret text, p_endpoints text[]) returns int
language plpgsql volatile security definer set search_path = public as $$
declare n int;
begin
  if p_secret is null or p_secret <> (select push_secret from public.app_secrets where id = 1) then raise exception 'forbidden'; end if;
  delete from public.push_subscriptions where endpoint = any(p_endpoints);
  get diagnostics n = row_count;
  delete from public.push_watches where expires_at < now();
  return n;
end $$;

-- Called by /api/errors: store the error; returns owner push messages for errors not seen in the last 30 minutes.
create or replace function public.log_app_error(p_secret text, p_source text, p_message text, p_detail text, p_url text, p_ua text, p_user uuid) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare v_new boolean; v_msg text := left(coalesce(p_message, 'unknown'), 500);
begin
  if p_secret is null or p_secret <> (select push_secret from public.app_secrets where id = 1) then raise exception 'forbidden'; end if;
  if (select count(*) from public.app_errors where at > now() - interval '1 minute') > 60 then return '[]'::jsonb; end if;
  v_new := not exists (select 1 from public.app_errors where message = v_msg and at > now() - interval '30 minutes');
  insert into public.app_errors (source, message, detail, url, user_agent, user_id)
  values (left(coalesce(p_source, 'web'), 20), v_msg, left(p_detail, 4000), left(p_url, 500), left(p_ua, 300), p_user);
  delete from public.app_errors where at < now() - interval '30 days';
  if not v_new then return '[]'::jsonb; end if;
  return public.staff_push_messages(array['مشكلة في السيستم', 'App error'], array[left(v_msg, 120), left(v_msg, 120)], '/staff#reports', 'app-error', true);
end $$;

revoke execute on function public.push_save_subscription(jsonb) from public, anon, authenticated;
revoke execute on function public.push_send(jsonb) from public, anon, authenticated;
revoke execute on function public.push_messages(text, uuid, text[], text[], text, text) from public, anon, authenticated;
revoke execute on function public.staff_push_messages(text[], text[], text, text, boolean) from public, anon, authenticated;
revoke execute on function public.place_label(uuid) from public, anon, authenticated;
revoke execute on function public.notify_order_change() from public, anon, authenticated;
revoke execute on function public.notify_booking_change() from public, anon, authenticated;
revoke execute on function public.notify_room_free() from public, anon, authenticated;
grant execute on function public.customer_push_watch(jsonb, text, uuid, text) to anon, authenticated;
grant execute on function public.staff_push_subscribe(jsonb, text, boolean) to authenticated;
grant execute on function public.staff_push_status(text) to authenticated;
grant execute on function public.push_prune(text, text[]) to anon, authenticated;
grant execute on function public.log_app_error(text, text, text, text, text, text, uuid) to anon, authenticated;
