-- dot: server functions.
-- Customers (anon) call customer_* / public_* RPCs.
-- Staff call staff_snapshot() and staff_op(op) — the op log the counter replays after being offline.
-- Owner calls owner_* RPCs.

-- ---------------------------------------------------------------------------
-- Internal helpers
-- ---------------------------------------------------------------------------
create or replace function public.money(x numeric) returns numeric
language sql immutable as $$ select round(coalesce(x, 0), 2) $$;

create or replace function public.bill_due(p_bill uuid) returns numeric
language sql stable set search_path = public as $$
  select public.money(coalesce(b.total, 0) - coalesce((select sum(amount) from public.payments where bill_id = b.id), 0))
  from public.bills b where b.id = p_bill;
$$;

create or replace function public.customer_outstanding(p_customer uuid) returns numeric
language sql stable set search_path = public as $$
  select public.money(coalesce(sum(public.bill_due(b.id)), 0))
  from public.bills b where b.customer_id = p_customer and b.status = 'closed';
$$;

create or replace function public.bill_items_total(p_bill uuid) returns numeric
language sql stable set search_path = public as $$
  select public.money(coalesce(sum(oi.qty * oi.unit_price), 0))
  from public.orders o join public.order_items oi on oi.order_id = o.id
  where o.bill_id = p_bill and o.status in ('accepted','served');
$$;

create or replace function public.verify_owner_credentials(p_phone text, p_password text) returns uuid
language sql stable security definer set search_path = public, extensions as $$
  select sp.user_id from public.staff_profiles sp join auth.users u on u.id = sp.user_id
  where sp.phone = p_phone and sp.role = 'owner' and sp.active
    and u.encrypted_password = extensions.crypt(p_password, u.encrypted_password)
  limit 1;
$$;

create or replace function public.staff_email(p_phone text) returns text
language sql immutable as $$ select 's' || p_phone || '@staff.dotcowork.space' $$;

create or replace function public.create_auth_user(p_phone text, p_password text) returns uuid
language plpgsql volatile security definer set search_path = public, extensions as $$
declare v_id uuid := gen_random_uuid(); v_email text := public.staff_email(p_phone);
begin
  if length(coalesce(p_password, '')) < 6 then raise exception 'password_too_short'; end if;
  if exists (select 1 from auth.users where email = v_email) then raise exception 'phone_taken'; end if;
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, email_change, email_change_token_new, recovery_token)
  values ('00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated', v_email,
    extensions.crypt(p_password, extensions.gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', '');
  insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (gen_random_uuid(), v_id, v_id::text,
    jsonb_build_object('sub', v_id::text, 'email', v_email, 'email_verified', true, 'phone_verified', false),
    'email', now(), now(), now());
  return v_id;
end $$;

-- Validate and insert order lines. Prices and names always come from the menu.
create or replace function public.insert_order_items(p_order uuid, p_items jsonb, p_allow_unavailable boolean)
returns int language plpgsql volatile set search_path = public as $$
declare it jsonb; m public.menu_items; n int := 0; opts jsonb; sel jsonb; grp jsonb; ch jsonb; q int;
begin
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'empty_order'; end if;
  if jsonb_array_length(p_items) > 40 then raise exception 'too_many_items'; end if;
  for it in select * from jsonb_array_elements(p_items) loop
    select * into m from public.menu_items where id = (it->>'menu_item_id')::uuid and active;
    if not found then raise exception 'item_not_found'; end if;
    if not m.available and not p_allow_unavailable then raise exception 'item_sold_out:%', m.id; end if;
    q := coalesce((it->>'qty')::int, 1);
    if q < 1 or q > 50 then raise exception 'bad_qty'; end if;
    opts := '[]'::jsonb;
    for sel in select * from jsonb_array_elements(coalesce(it->'options', '[]'::jsonb)) loop
      select g into grp from jsonb_array_elements(m.options) g where g->>'id' = sel->>'group_id';
      if grp is null then raise exception 'bad_option'; end if;
      select c into ch from jsonb_array_elements(grp->'choices') c where c->>'id' = sel->>'choice_id';
      if ch is null then raise exception 'bad_option'; end if;
      opts := opts || jsonb_build_array(jsonb_build_object(
        'group_id', grp->>'id', 'choice_id', ch->>'id',
        'group_ar', grp->>'name_ar', 'group_en', grp->>'name_en',
        'choice_ar', ch->>'name_ar', 'choice_en', ch->>'name_en'));
    end loop;
    insert into public.order_items (order_id, menu_item_id, name_ar, name_en, unit_price, qty, options, note)
    values (p_order, m.id, m.name_ar, m.name_en, m.price, q, opts, left(coalesce(it->>'note', ''), 200));
    n := n + 1;
  end loop;
  return n;
end $$;

create or replace function public.normalize_phone(p text) returns text
language sql immutable as $$
  select case
    when d like '0020%' then '0' || substr(d, 5)
    when d like '20%' and length(d) = 12 then '0' || substr(d, 3)
    else d end
  from (select regexp_replace(coalesce(p, ''), '[^0-9]', '', 'g') as d) s;
$$;

-- ---------------------------------------------------------------------------
-- Owner setup (one time, guarded by a setup code)
-- ---------------------------------------------------------------------------
create or replace function public.claim_owner(p_setup_code text, p_phone text, p_name text, p_password text)
returns jsonb language plpgsql volatile security definer set search_path = public, extensions as $$
declare s public.app_setup; v_uid uuid; v_phone text := public.normalize_phone(p_phone);
begin
  select * into s from public.app_setup where id = 1 for update;
  if s.claimed_at is not null or exists (select 1 from public.staff_profiles where role = 'owner') then
    raise exception 'already_claimed';
  end if;
  if not public.throttle_check('setup') then return jsonb_build_object('error', 'too_many_attempts'); end if;
  if s.setup_code_hash is null or s.setup_code_hash <> extensions.crypt(p_setup_code, s.setup_code_hash) then
    insert into public.lookup_attempts (key, ok) values ('setup', false);
    return jsonb_build_object('error', 'bad_setup_code');
  end if;
  if v_phone !~ '^[0-9]{8,15}$' then raise exception 'bad_phone'; end if;
  v_uid := public.create_auth_user(v_phone, p_password);
  insert into public.staff_profiles (user_id, phone, name, role) values (v_uid, v_phone, coalesce(nullif(trim(p_name), ''), 'Owner'), 'owner');
  update public.app_setup set claimed_at = now() where id = 1;
  return jsonb_build_object('ok', true, 'email', public.staff_email(v_phone));
end $$;

create or replace function public.setup_status() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('claimed', exists (select 1 from public.staff_profiles where role = 'owner'));
$$;

-- ---------------------------------------------------------------------------
-- Public (anon) RPCs
-- ---------------------------------------------------------------------------
create or replace function public.public_catalog() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'settings', (select jsonb_build_object('venue_name', venue_name, 'venue_address', venue_address, 'venue_whatsapp', venue_whatsapp,
        'min_session_minutes', min_session_minutes, 'billing_step_minutes', billing_step_minutes, 'grace_minutes', grace_minutes,
        'day_rollover_hour', day_rollover_hour) from public.settings where id = 1),
    'categories', coalesce((select jsonb_agg(to_jsonb(c) order by c.sort, c.name_en) from public.menu_categories c where c.active), '[]'::jsonb),
    'items', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'category_id', i.category_id, 'name_ar', i.name_ar, 'name_en', i.name_en,
        'desc_ar', i.desc_ar, 'desc_en', i.desc_en, 'price', i.price, 'image_url', i.image_url, 'options', i.options,
        'available', i.available, 'sort', i.sort) order by i.sort, i.name_en)
        from public.menu_items i join public.menu_categories c on c.id = i.category_id where i.active and c.active), '[]'::jsonb),
    'modes', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'name_ar', m.name_ar, 'name_en', m.name_en, 'hourly_rate', m.hourly_rate, 'sort', m.sort) order by m.sort)
        from public.room_modes m where m.active), '[]'::jsonb),
    'places', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'kind', p.kind, 'name_ar', p.name_ar, 'name_en', p.name_en, 'sort', p.sort,
        'busy', case when p.kind = 'room'
                     then exists (select 1 from public.room_sessions s where s.place_id = p.id and s.status = 'active')
                     else exists (select 1 from public.bills b where b.place_id = p.id and b.status = 'open') end) order by p.kind, p.sort)
        from public.places p where p.active), '[]'::jsonb),
    'schedule', coalesce((select jsonb_agg(jsonb_build_object('place_id', b.place_id, 'starts_at', b.starts_at, 'duration_minutes', b.duration_minutes) order by b.starts_at)
        from public.bookings b where b.status = 'confirmed' and b.starts_at + make_interval(mins => b.duration_minutes) > now()
          and b.starts_at < now() + interval '14 days'), '[]'::jsonb)
  );
$$;

create or replace function public.place_by_token(p_token text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', id, 'kind', kind, 'name_ar', name_ar, 'name_en', name_en)
  from public.places where qr_token = p_token and active;
$$;

-- Find a customer by code (preferred) or phone; create by phone when allowed.
create or replace function public.find_or_create_customer(p_phone text, p_code text, p_name text, p_create boolean)
returns jsonb language plpgsql volatile set search_path = public as $$
declare c public.customers; v_phone text := public.normalize_phone(p_phone); v_code text := nullif(trim(coalesce(p_code, '')), ''); v_new boolean := false;
begin
  if v_code is not null then
    select * into c from public.customers where code = v_code;
    if not found then raise exception 'customer_not_found'; end if;
    if v_phone <> '' and c.phone <> v_phone then raise exception 'customer_not_found'; end if;
  else
    if v_phone !~ '^[0-9]{8,15}$' then raise exception 'bad_phone'; end if;
    select * into c from public.customers where phone = v_phone;
    if not found then
      if not p_create then raise exception 'customer_not_found'; end if;
      insert into public.customers (phone, name, code) values (v_phone, left(coalesce(trim(p_name), ''), 80), public.gen_customer_code())
      returning * into c;
      v_new := true;
    end if;
  end if;
  if c.name = '' and coalesce(trim(p_name), '') <> '' then
    update public.customers set name = left(trim(p_name), 80) where id = c.id returning * into c;
  end if;
  return jsonb_build_object('id', c.id, 'is_new', v_new, 'code', case when v_new then c.code end, 'name', c.name);
end $$;

create or replace function public.customer_place_order(p_order_id uuid, p_token text, p_phone text, p_code text, p_name text, p_items jsonb, p_note text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare v_place uuid; v_cust jsonb; v_cid uuid; v_pending int;
begin
  if p_order_id is null then raise exception 'bad_request'; end if;
  if exists (select 1 from public.orders where id = p_order_id) then
    return jsonb_build_object('order_id', p_order_id, 'duplicate', true);
  end if;
  if coalesce(p_token, '') <> '' then
    select id into v_place from public.places where qr_token = p_token and active;
    if v_place is null then raise exception 'bad_place'; end if;
  end if;
  v_cust := public.find_or_create_customer(p_phone, p_code, p_name, true);
  v_cid := (v_cust->>'id')::uuid;
  select count(*) into v_pending from public.orders where customer_id = v_cid and status = 'new';
  if v_pending >= 5 then raise exception 'too_many_pending'; end if;
  insert into public.orders (id, customer_id, place_id, source, status, note)
  values (p_order_id, v_cid, v_place, case when v_place is null then 'menu' else 'qr' end, 'new', left(coalesce(p_note, ''), 300));
  perform public.insert_order_items(p_order_id, p_items, false);
  return jsonb_build_object('order_id', p_order_id, 'is_new_customer', (v_cust->>'is_new')::boolean, 'customer_code', v_cust->>'code', 'name', v_cust->>'name');
end $$;

create or replace function public.customer_order_status(p_ids uuid[]) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'status', status)), '[]'::jsonb)
  from public.orders where id = any(p_ids[1:20]);
$$;

create or replace function public.customer_bill(p_phone text, p_code text) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare v_phone text := public.normalize_phone(p_phone); c public.customers; b public.bills; s public.room_sessions; v_key text;
begin
  v_key := 'bill:' || v_phone;
  if not public.throttle_check(v_key) then return jsonb_build_object('error', 'too_many_attempts'); end if;
  select * into c from public.customers where phone = v_phone and code = trim(coalesce(p_code, ''));
  if not found then
    insert into public.lookup_attempts (key, ok) values (v_key, false);
    return jsonb_build_object('error', 'customer_not_found');
  end if;
  select * into b from public.bills where customer_id = c.id and status = 'open';
  if b.id is not null and b.session_id is not null then select * into s from public.room_sessions where id = b.session_id; end if;
  return jsonb_build_object(
    'customer', jsonb_build_object('name', c.name, 'phone', c.phone, 'code', c.code),
    'outstanding', public.customer_outstanding(c.id),
    'settings', (select jsonb_build_object('min_session_minutes', min_session_minutes, 'billing_step_minutes', billing_step_minutes, 'grace_minutes', grace_minutes) from public.settings where id = 1),
    'bill', case when b.id is null then null else jsonb_build_object(
      'id', b.id, 'opened_at', b.opened_at, 'room_fee_share', b.room_fee_share,
      'place', (select jsonb_build_object('kind', kind, 'name_ar', name_ar, 'name_en', name_en) from public.places where id = b.place_id),
      'orders', coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'status', o.status, 'created_at', o.created_at,
          'items', (select coalesce(jsonb_agg(jsonb_build_object('name_ar', oi.name_ar, 'name_en', oi.name_en, 'qty', oi.qty, 'unit_price', oi.unit_price, 'options', oi.options)), '[]'::jsonb)
                    from public.order_items oi where oi.order_id = o.id)) order by o.created_at)
        from public.orders o where o.bill_id = b.id or (o.customer_id = c.id and o.status = 'new')), '[]'::jsonb),
      'session', case when s.id is null then null else jsonb_build_object(
        'id', s.id, 'kind', s.kind, 'planned_end', s.planned_end, 'status', s.status, 'started_at', s.started_at, 'ended_at', s.ended_at,
        'room_fee', s.room_fee, 'is_booker', s.booker_customer_id = c.id,
        'members', (select count(*) from public.bills where session_id = s.id),
        'segments', coalesce((select jsonb_agg(jsonb_build_object('mode_id', g.mode_id, 'rate', g.rate, 'started_at', g.started_at, 'ended_at', g.ended_at,
            'name_ar', m.name_ar, 'name_en', m.name_en) order by g.started_at)
          from public.session_segments g join public.room_modes m on m.id = g.mode_id where g.session_id = s.id), '[]'::jsonb)) end
    ) end,
    'bookings', coalesce((select jsonb_agg(jsonb_build_object('id', k.id, 'status', k.status, 'starts_at', k.starts_at, 'duration_minutes', k.duration_minutes,
        'place_ar', p.name_ar, 'place_en', p.name_en, 'mode_ar', m.name_ar, 'mode_en', m.name_en) order by k.starts_at)
      from public.bookings k join public.places p on p.id = k.place_id join public.room_modes m on m.id = k.mode_id
      where k.customer_id = c.id and k.status in ('pending','confirmed') and k.starts_at > now() - interval '1 day'), '[]'::jsonb)
  );
end $$;

create or replace function public.booking_overlaps(p_place uuid, p_start timestamptz, p_minutes int, p_ignore uuid) returns boolean
language sql stable set search_path = public as $$
  select exists (select 1 from public.bookings b where b.place_id = p_place and b.status = 'confirmed'
    and b.id is distinct from p_ignore
    and tstzrange(b.starts_at, b.starts_at + make_interval(mins => b.duration_minutes)) && tstzrange(p_start, p_start + make_interval(mins => p_minutes)));
$$;

create or replace function public.customer_book(p_phone text, p_name text, p_place_id uuid, p_mode_id uuid, p_starts_at timestamptz, p_duration int, p_group_size int, p_note text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare v_cust jsonb; v_cid uuid; v_id uuid;
begin
  if not exists (select 1 from public.places where id = p_place_id and kind = 'room' and active) then raise exception 'bad_place'; end if;
  if not exists (select 1 from public.room_modes where id = p_mode_id and active) then raise exception 'bad_mode'; end if;
  if p_starts_at < now() - interval '5 minutes' or p_starts_at > now() + interval '60 days' then raise exception 'bad_time'; end if;
  if p_duration is null or p_duration < 30 or p_duration > 720 then raise exception 'bad_duration'; end if;
  if p_group_size is not null and (p_group_size < 1 or p_group_size > 100) then raise exception 'bad_group'; end if;
  if public.booking_overlaps(p_place_id, p_starts_at, p_duration, null) then raise exception 'slot_taken'; end if;
  v_cust := public.find_or_create_customer(p_phone, null, p_name, true);
  v_cid := (v_cust->>'id')::uuid;
  if (select count(*) from public.bookings where customer_id = v_cid and status = 'pending') >= 3 then raise exception 'too_many_pending'; end if;
  insert into public.bookings (customer_id, place_id, mode_id, starts_at, duration_minutes, group_size, note, status, source)
  values (v_cid, p_place_id, p_mode_id, p_starts_at, p_duration, p_group_size, left(coalesce(p_note, ''), 300), 'pending', 'customer')
  returning id into v_id;
  return jsonb_build_object('booking_id', v_id, 'is_new_customer', (v_cust->>'is_new')::boolean, 'customer_code', v_cust->>'code');
end $$;

create or replace function public.customer_cancel_booking(p_phone text, p_code text, p_booking_id uuid) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare c public.customers;
begin
  select * into c from public.customers where phone = public.normalize_phone(p_phone) and code = trim(coalesce(p_code, ''));
  if not found then raise exception 'customer_not_found'; end if;
  update public.bookings set status = 'cancelled', decided_at = now()
  where id = p_booking_id and customer_id = c.id and status in ('pending','confirmed');
  if not found then raise exception 'booking_not_found'; end if;
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------------------
-- Staff snapshot: everything the counter needs to work (and keep working offline)
-- ---------------------------------------------------------------------------
create or replace function public.staff_snapshot() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_me public.staff_profiles; v_day date := public.business_day(now()); v_open_bills uuid[];
begin
  select * into v_me from public.staff_profiles where user_id = auth.uid() and active;
  if not found then raise exception 'not_staff'; end if;
  select coalesce(array_agg(id), '{}') into v_open_bills from public.bills where status = 'open';
  return jsonb_build_object(
    'server_time', now(),
    'business_day', v_day,
    'me', jsonb_build_object('user_id', v_me.user_id, 'phone', v_me.phone, 'name', v_me.name, 'role', v_me.role),
    'settings', (select to_jsonb(s) from public.settings s where id = 1),
    'places', coalesce((select jsonb_agg(to_jsonb(p) order by p.kind, p.sort, p.name_en) from public.places p), '[]'::jsonb),
    'modes', coalesce((select jsonb_agg(to_jsonb(m) order by m.sort) from public.room_modes m), '[]'::jsonb),
    'categories', coalesce((select jsonb_agg(to_jsonb(c) order by c.sort) from public.menu_categories c), '[]'::jsonb),
    'items', coalesce((select jsonb_agg(to_jsonb(i) order by i.sort, i.name_en) from public.menu_items i), '[]'::jsonb),
    'customers', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'phone', c.phone, 'name', c.name, 'code', c.code,
        'debt_limit', c.debt_limit, 'outstanding', public.customer_outstanding(c.id), 'created_at', c.created_at)) from public.customers c), '[]'::jsonb),
    'aliases', coalesce((select jsonb_object_agg(alias_id, customer_id) from public.customer_aliases), '{}'::jsonb),
    'sessions', coalesce((select jsonb_agg(to_jsonb(s)) from public.room_sessions s
        where s.status = 'active' or s.id in (select session_id from public.bills where id = any(v_open_bills))), '[]'::jsonb),
    'segments', coalesce((select jsonb_agg(to_jsonb(g) order by g.started_at) from public.session_segments g
        where g.session_id in (select id from public.room_sessions s where s.status = 'active' or s.id in (select session_id from public.bills where id = any(v_open_bills)))), '[]'::jsonb),
    'bills', coalesce((select jsonb_agg(to_jsonb(b)) from public.bills b
        where b.status = 'open' or (b.status = 'closed' and b.closed_at > now() - interval '36 hours')), '[]'::jsonb),
    'orders', coalesce((select jsonb_agg(to_jsonb(o) order by o.created_at) from public.orders o
        where o.status = 'new' or o.bill_id in (select id from public.bills where status = 'open' or closed_at > now() - interval '36 hours')), '[]'::jsonb),
    'order_items', coalesce((select jsonb_agg(to_jsonb(oi)) from public.order_items oi join public.orders o on o.id = oi.order_id
        where o.status = 'new' or o.bill_id in (select id from public.bills where status = 'open' or closed_at > now() - interval '36 hours')), '[]'::jsonb),
    'payments', coalesce((select jsonb_agg(to_jsonb(p)) from public.payments p
        where p.business_day >= v_day - 1 or p.bill_id in (select id from public.bills where closed_at > now() - interval '36 hours')), '[]'::jsonb),
    'bookings', coalesce((select jsonb_agg(to_jsonb(k) order by k.starts_at) from public.bookings k
        where k.status in ('pending','confirmed') and k.starts_at + make_interval(mins => k.duration_minutes) > now() - interval '12 hours'), '[]'::jsonb),
    'cash_day', (select to_jsonb(d) from public.cash_days d where d.business_day = v_day),
    'last_cash_day', (select to_jsonb(d) from public.cash_days d where d.business_day < v_day order by d.business_day desc limit 1),
    'cash_outs', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at) from public.cash_outs x where x.business_day >= v_day - 1), '[]'::jsonb),
    'staff', case when v_me.role = 'owner' then coalesce((select jsonb_agg(to_jsonb(sp) order by sp.created_at) from public.staff_profiles sp), '[]'::jsonb) else '[]'::jsonb end
  );
end $$;

