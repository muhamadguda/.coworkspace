-- Reopen bill: payments are voided (kept for audit), never erased.
alter table public.payments add column voided_at timestamptz, add column void_reason text;

do $$
declare d text;
begin
  d := pg_get_functiondef('public.bill_due(uuid)'::regprocedure);
  if position('from public.payments where bill_id = b.id' in d) = 0 then raise exception 'patch bill_due failed'; end if;
  d := replace(d, 'from public.payments where bill_id = b.id', 'from public.payments where bill_id = b.id and voided_at is null');
  execute d;

  d := pg_get_functiondef('public.staff_op(jsonb)'::regprocedure);
  if position('from public.payments where business_day = v_day and method = ''cash''' in d) = 0 then raise exception 'patch close_day failed'; end if;
  d := replace(d, 'from public.payments where business_day = v_day and method = ''cash''', 'from public.payments where business_day = v_day and method = ''cash'' and voided_at is null');
  execute d;

  d := pg_get_functiondef('public.owner_report(date,date)'::regprocedure);
  if position('from public.payments where business_day between p_from and p_to group by method' in d) = 0 then raise exception 'patch report methods failed'; end if;
  d := replace(d, 'from public.payments where business_day between p_from and p_to group by method', 'from public.payments where business_day between p_from and p_to and voided_at is null group by method');
  d := replace(d, 'from public.payments where business_day between p_from and p_to and kind = ''debt''', 'from public.payments where business_day between p_from and p_to and kind = ''debt'' and voided_at is null');
  execute d;

  -- sign-ups: only create_auth_user may add users
  d := pg_get_functiondef('public.create_auth_user(text,text)'::regprocedure);
  if position('insert into auth.users' in d) = 0 then raise exception 'patch create_auth_user failed'; end if;
  d := replace(d, 'insert into auth.users', 'perform set_config(''dot.allow_user_create'', ''on'', true);
  insert into auth.users');
  execute d;
end $$;

create or replace function public.owner_reopen_bill(p_bill uuid, p_reason text) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare b public.bills; v_pays jsonb;
begin
  if not public.is_owner() then raise exception 'not_owner'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'reason_required'; end if;
  select * into b from public.bills where id = p_bill for update;
  if not found or b.status <> 'closed' then raise exception 'bill_not_closed'; end if;
  if exists (select 1 from public.payments where bill_id = b.id and kind = 'debt' and voided_at is null) then raise exception 'has_debt_payments'; end if;
  if exists (select 1 from public.bills where customer_id = b.customer_id and status = 'open') then raise exception 'customer_has_open_bill'; end if;
  select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) into v_pays from public.payments x where x.bill_id = b.id and x.voided_at is null;
  update public.payments set voided_at = now(), void_reason = left(trim(p_reason), 200) where bill_id = b.id and kind = 'bill' and voided_at is null;
  update public.bills set status = 'open', closed_at = null, closed_by = null, business_day = null, items_total = null, subtotal = null,
    discount_kind = null, discount_value = null, discount_amount = 0, discount_reason = null, discount_by = null, total = null, pay_later = 0
  where id = b.id;
  perform public.audit('reopen_bill', 'bills', b.id::text, jsonb_build_object('reason', trim(p_reason), 'total', b.total, 'pay_later', b.pay_later, 'discount', b.discount_amount, 'payments', v_pays));
  return jsonb_build_object('ok', true);
end $$;
grant execute on function public.owner_reopen_bill(uuid, text) to authenticated;

create or replace function public.block_external_signup() returns trigger
language plpgsql set search_path = public as $$
begin
  if coalesce(current_setting('dot.allow_user_create', true), '') <> 'on' then
    raise exception 'signups_disabled';
  end if;
  return new;
end $$;
create trigger block_external_signup before insert on auth.users for each row execute function public.block_external_signup();

-- Push notifications + error log (expired watches and dead subscriptions are flagged, not erased)
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
  gone boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.push_subscriptions enable row level security;

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
  on conflict (endpoint) do update set p256dh = excluded.p256dh, auth = excluded.auth, gone = false;
  return v_endpoint;
end $$;

create or replace function public.customer_push_watch(p_sub jsonb, p_kind text, p_ref uuid, p_lang text) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare v_endpoint text;
begin
  if p_kind not in ('order','booking','room') then raise exception 'bad_kind'; end if;
  if p_kind = 'order' and not exists (select 1 from public.orders where id = p_ref) then raise exception 'not_found'; end if;
  if p_kind = 'booking' and not exists (select 1 from public.bookings where id = p_ref) then raise exception 'not_found'; end if;
  if p_kind = 'room' and not exists (select 1 from public.places where id = p_ref and kind = 'room' and active) then raise exception 'not_found'; end if;
  v_endpoint := public.push_save_subscription(p_sub);
  if (select count(*) from public.push_watches where endpoint = v_endpoint and expires_at > now()) >= 20 then raise exception 'too_many'; end if;
  insert into public.push_watches (endpoint, kind, ref, lang, expires_at)
  values (v_endpoint, p_kind, p_ref, case when p_lang = 'en' then 'en' else 'ar' end,
          now() + case p_kind when 'booking' then interval '30 days' when 'room' then interval '12 hours' else interval '1 day' end)
  on conflict (endpoint, kind, ref) do update set expires_at = excluded.expires_at, lang = excluded.lang;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.staff_push_subscribe(p_sub jsonb, p_lang text, p_on boolean) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare v_endpoint text;
begin
  if not public.is_staff() then raise exception 'not_staff'; end if;
  v_endpoint := public.push_save_subscription(p_sub);
  insert into public.push_watches (endpoint, kind, ref, lang, expires_at)
  values (v_endpoint, 'staff', auth.uid(), case when p_lang = 'en' then 'en' else 'ar' end, case when p_on then now() + interval '10 years' else now() end)
  on conflict (endpoint, kind, ref) do update set expires_at = excluded.expires_at, lang = excluded.lang;
  return jsonb_build_object('ok', true, 'on', p_on);
end $$;

create or replace function public.staff_push_status(p_endpoint text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.push_watches where endpoint = p_endpoint and kind = 'staff' and ref = auth.uid() and expires_at > now());
$$;

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
  null;
end $$;

create or replace function public.push_messages(p_kind text, p_ref uuid, p_title text[], p_body text[], p_url text, p_tag text) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth,
    'title', case when w.lang = 'en' then p_title[2] else p_title[1] end,
    'body', case when w.lang = 'en' then p_body[2] else p_body[1] end,
    'url', p_url, 'tag', p_tag)), '[]'::jsonb)
  from public.push_watches w join public.push_subscriptions s on s.endpoint = w.endpoint
  where w.kind = p_kind and w.ref = p_ref and w.expires_at > now() and not s.gone;
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
  where w.kind = 'staff' and w.expires_at > now() and not s.gone and (not p_owner_only or sp.role = 'owner');
$$;

create or replace function public.place_label(p_place uuid) returns text[]
language sql stable set search_path = public as $$
  select coalesce((select array[name_ar, name_en] from public.places where id = p_place), array['الكاونتر', 'the counter']);
$$;

create or replace function public.expire_watches(p_kind text, p_ref uuid) returns void
language sql volatile security definer set search_path = public as $$
  update public.push_watches set expires_at = now() where kind = p_kind and ref = p_ref and expires_at > now();
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
      perform public.expire_watches('order', new.id);
    elsif new.status = 'rejected' then
      perform public.push_send(public.push_messages('order', new.id, array['معرفناش نأكد طلبك', 'We couldn''t accept your order'], array['كلم الكاونتر لو محتاج حاجة', 'Ask at the counter if you need anything'], '/menu', 'order-' || new.id));
      perform public.expire_watches('order', new.id);
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
      perform public.expire_watches('booking', new.id);
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
    perform public.expire_watches('room', new.place_id);
  end if;
  return new;
end $$;
create trigger room_sessions_notify after update of status on public.room_sessions for each row execute function public.notify_room_free();

create or replace function public.push_prune(p_secret text, p_endpoints text[]) returns int
language plpgsql volatile security definer set search_path = public as $$
declare n int;
begin
  if p_secret is null or p_secret <> (select push_secret from public.app_secrets where id = 1) then raise exception 'forbidden'; end if;
  update public.push_subscriptions set gone = true where endpoint = any(p_endpoints);
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function public.log_app_error(p_secret text, p_source text, p_message text, p_detail text, p_url text, p_ua text, p_user uuid) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare v_new boolean; v_msg text := left(coalesce(p_message, 'unknown'), 500);
begin
  if p_secret is null or p_secret <> (select push_secret from public.app_secrets where id = 1) then raise exception 'forbidden'; end if;
  if (select count(*) from public.app_errors where at > now() - interval '1 minute') > 60 then return '[]'::jsonb; end if;
  v_new := not exists (select 1 from public.app_errors where message = v_msg and at > now() - interval '30 minutes');
  insert into public.app_errors (source, message, detail, url, user_agent, user_id)
  values (left(coalesce(p_source, 'web'), 20), v_msg, left(p_detail, 4000), left(p_url, 500), left(p_ua, 300), p_user);
  if not v_new then return '[]'::jsonb; end if;
  return public.staff_push_messages(array['مشكلة في السيستم', 'App error'], array[left(v_msg, 120), left(v_msg, 120)], '/staff#reports', 'app-error', true);
end $$;

grant execute on function public.customer_push_watch(jsonb, text, uuid, text) to anon, authenticated;
grant execute on function public.staff_push_subscribe(jsonb, text, boolean) to authenticated;
grant execute on function public.staff_push_status(text) to authenticated;
grant execute on function public.push_prune(text, text[]) to anon, authenticated;
grant execute on function public.log_app_error(text, text, text, text, text, text, uuid) to anon, authenticated;
