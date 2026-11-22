-- Custom menus and stations.
--
-- Custom menu: a set of menu items the owner picks, shown only to the customers the owner adds
-- to it by phone. An item marked "custom menus only" (menu_items.public = false) is hidden from
-- the public menu and can only be ordered by a customer who has it on one of their menus.
--
-- Station: like a table or room (Station 1, Station 2...), but an account the owner creates; it isn't bookable and never shows publicly. The
-- owner adds people by phone. A member orders "on the station account" (phone and code both
-- needed), with no room session: the order lands on the station's own open bill, which the
-- counter settles like any bill (pay now, or pay later within the station's debt limit). Each
-- station gets its own custom menu, which its members see.
--
-- The station account is a customer row flagged is_account with a non-dialable phone
-- ('station-<hex>'), so every existing bill, debt and checkout rule applies to it unchanged.
-- Phone lookups can never reach it, and the one code-only lookup refuses it.

alter table public.menu_items add column public boolean not null default true;

alter table public.customers add column is_account boolean not null default false;
alter table public.customers drop constraint customers_phone_check;
alter table public.customers add constraint customers_phone_check
  check (phone ~ '^[0-9]{8,15}$' or (is_account and phone ~ '^station-[0-9a-f]{12}$'));

alter table public.orders add column ordered_by uuid references public.customers(id);

create table public.custom_menus (
  id uuid primary key default gen_random_uuid(),
  name_ar text not null check (length(trim(name_ar)) between 1 and 80),
  name_en text not null check (length(trim(name_en)) between 1 and 80),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.custom_menu_items (
  menu_id uuid not null references public.custom_menus(id) on delete cascade,
  menu_item_id uuid not null references public.menu_items(id) on delete cascade,
  primary key (menu_id, menu_item_id)
);
create index on public.custom_menu_items (menu_item_id);

create table public.custom_menu_members (
  menu_id uuid not null references public.custom_menus(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  added_at timestamptz not null default now(),
  added_by uuid references auth.users(id),
  primary key (menu_id, customer_id)
);
create index on public.custom_menu_members (customer_id);

create table public.stations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 80),
  account_customer_id uuid not null unique references public.customers(id),
  menu_id uuid references public.custom_menus(id) on delete set null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- One station per person, so "charge my station" is never ambiguous.
create table public.station_members (
  station_id uuid not null references public.stations(id) on delete cascade,
  customer_id uuid not null unique references public.customers(id) on delete cascade,
  added_at timestamptz not null default now(),
  added_by uuid references auth.users(id),
  primary key (station_id, customer_id)
);

alter table public.custom_menus enable row level security;
alter table public.custom_menu_items enable row level security;
alter table public.custom_menu_members enable row level security;
alter table public.stations enable row level security;
alter table public.station_members enable row level security;

create policy staff_read on public.custom_menus for select to authenticated using (public.is_staff());
create policy staff_read on public.custom_menu_items for select to authenticated using (public.is_staff());
create policy staff_read on public.custom_menu_members for select to authenticated using (public.is_staff());
create policy staff_read on public.stations for select to authenticated using (public.is_staff());
create policy staff_read on public.station_members for select to authenticated using (public.is_staff());

-- Owner edits menus and removes members directly; adding by phone and creating stations go through RPCs.
create policy owner_write on public.custom_menus for all to authenticated using (public.is_owner()) with check (public.is_owner());
create policy owner_write on public.custom_menu_items for all to authenticated using (public.is_owner()) with check (public.is_owner());
create policy owner_delete on public.custom_menu_members for delete to authenticated using (public.is_owner());
create policy owner_delete on public.station_members for delete to authenticated using (public.is_owner());

-- Anonymous readers never see custom-menu-only items.
drop policy public_read on public.menu_items;
create policy public_read on public.menu_items for select to anon, authenticated using ((active and public) or public.is_staff());

-- ---------------------------------------------------------------------------
-- Which custom menus a customer gets: their own plus their station's.
-- ---------------------------------------------------------------------------
create or replace function public.customer_menu_ids(p_customer uuid) returns setof uuid
language sql stable security definer set search_path = public as $$
  select m.id from public.custom_menus m
  where m.active and (
    exists (select 1 from public.custom_menu_members x where x.menu_id = m.id and x.customer_id = p_customer)
    or exists (select 1 from public.station_members x join public.stations o on o.id = x.station_id
               where x.customer_id = p_customer and o.active and o.menu_id = m.id));
$$;

-- Customer orders (QR or online menu) may only include a hidden item when it's on the ordering
-- person's menus. Counter orders (source 'staff') can add anything.
create or replace function public.trg_order_item_menu() returns trigger
language plpgsql security definer set search_path = public as $$
declare o public.orders;
begin
  if new.menu_item_id is null or (select public from public.menu_items where id = new.menu_item_id) then return new; end if;
  select * into o from public.orders where id = new.order_id;
  if o.source = 'staff' then return new; end if;
  if not exists (select 1 from public.custom_menu_items ci
                 where ci.menu_item_id = new.menu_item_id
                   and ci.menu_id in (select public.customer_menu_ids(coalesce(o.ordered_by, o.customer_id)))) then
    raise exception 'item_not_found';
  end if;
  return new;
end $$;
create trigger order_item_menu before insert on public.order_items for each row execute function public.trg_order_item_menu();

-- Public menu hides custom-menu-only items.
do $$
declare d text;
begin
  d := pg_get_functiondef('public.public_catalog()'::regprocedure);
  if position('where i.active and c.active' in d) = 0 then raise exception 'patch public_catalog failed'; end if;
  d := replace(d, 'where i.active and c.active', 'where i.active and i.public and c.active');
  execute d;

  -- An station account has a code like anyone else; never let the code alone order on it.
  d := pg_get_functiondef('public.find_or_create_customer(text,text,text,boolean)'::regprocedure);
  if position('select * into c from public.customers where code = v_code;' in d) = 0 then raise exception 'patch find_or_create_customer failed'; end if;
  d := replace(d, 'select * into c from public.customers where code = v_code;', 'select * into c from public.customers where code = v_code and not is_account;');
  execute d;
end $$;

-- ---------------------------------------------------------------------------
-- Customer RPCs
-- ---------------------------------------------------------------------------
-- My custom menus and station. Phone and code both, throttled like the bill page.
create or replace function public.customer_my_menus(p_phone text, p_code text) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare v_phone text := public.normalize_phone(p_phone); c public.customers; v_key text := 'bill:' || public.normalize_phone(p_phone); o public.stations;
begin
  if not public.throttle_check(v_key) then return jsonb_build_object('error', 'too_many_attempts'); end if;
  select * into c from public.customers where phone = v_phone and code = trim(coalesce(p_code, '')) and not is_account;
  if not found then
    insert into public.lookup_attempts (key, ok) values (v_key, false);
    return jsonb_build_object('error', 'customer_not_found');
  end if;
  select o2.* into o from public.station_members x join public.stations o2 on o2.id = x.station_id
  where x.customer_id = c.id and o2.active;
  return jsonb_build_object(
    'station', case when o.id is null then null else jsonb_build_object('id', o.id, 'name', o.name) end,
    'menus', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'name_ar', m.name_ar, 'name_en', m.name_en,
        'item_ids', coalesce((select jsonb_agg(ci.menu_item_id) from public.custom_menu_items ci join public.menu_items i on i.id = ci.menu_item_id
                              where ci.menu_id = m.id and i.active), '[]'::jsonb)) order by m.created_at)
      from public.custom_menus m where m.id in (select public.customer_menu_ids(c.id))), '[]'::jsonb),
    'items', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'category_id', i.category_id, 'name_ar', i.name_ar, 'name_en', i.name_en,
        'desc_ar', i.desc_ar, 'desc_en', i.desc_en, 'price', i.price, 'image_url', i.image_url, 'options', i.options,
        'available', i.available, 'active', i.active, 'sort', i.sort) order by i.sort, i.name_en)
      from public.menu_items i where i.active and i.id in (
        select ci.menu_item_id from public.custom_menu_items ci where ci.menu_id in (select public.customer_menu_ids(c.id)))), '[]'::jsonb)
  );
end $$;

-- Place an order; with p_to_station it goes on the member's station account instead of their own bill.
create or replace function public.customer_place_order2(p_order_id uuid, p_token text, p_phone text, p_code text, p_name text, p_items jsonb, p_note text, p_to_station boolean)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare v_phone text := public.normalize_phone(p_phone); v_key text := 'bill:' || public.normalize_phone(p_phone);
  c public.customers; o public.stations; v_place uuid; v_pending int; v_who text;
begin
  if not coalesce(p_to_station, false) then
    return public.customer_place_order(p_order_id, p_token, p_phone, p_code, p_name, p_items, p_note);
  end if;
  if p_order_id is null then raise exception 'bad_request'; end if;
  if exists (select 1 from public.orders where id = p_order_id) then
    return jsonb_build_object('order_id', p_order_id, 'duplicate', true);
  end if;
  if not public.throttle_check(v_key) then raise exception 'too_many_attempts'; end if;
  select * into c from public.customers where phone = v_phone and code = trim(coalesce(p_code, '')) and not is_account;
  if not found then
    insert into public.lookup_attempts (key, ok) values (v_key, false);
    raise exception 'customer_not_found';
  end if;
  select o2.* into o from public.station_members x join public.stations o2 on o2.id = x.station_id
  where x.customer_id = c.id and o2.active;
  if o.id is null then raise exception 'not_station_member'; end if;
  if coalesce(p_token, '') <> '' then
    select id into v_place from public.places where qr_token = p_token and active;
    if v_place is null then raise exception 'bad_place'; end if;
  end if;
  select count(*) into v_pending from public.orders where customer_id = o.account_customer_id and status = 'new';
  if v_pending >= 15 then raise exception 'too_many_pending'; end if;
  -- The station's running bill: never tied to a room, so no session is needed and room fees never land on it.
  if not exists (select 1 from public.bills where customer_id = o.account_customer_id and status = 'open') then
    insert into public.bills (id, customer_id, place_id, session_id, status, opened_at)
    values (gen_random_uuid(), o.account_customer_id, null, null, 'open', now());
  end if;
  v_who := coalesce(nullif(c.name, ''), c.phone);
  insert into public.orders (id, customer_id, place_id, source, status, note, ordered_by)
  values (p_order_id, o.account_customer_id, v_place, case when v_place is null then 'menu' else 'qr' end, 'new',
    left('🖥 ' || v_who || ' · ' || c.phone || case when coalesce(trim(p_note), '') <> '' then ' · ' || trim(p_note) else '' end, 300), c.id);
  perform public.insert_order_items(p_order_id, p_items, false);
  return jsonb_build_object('order_id', p_order_id, 'station', o.name, 'name', c.name, 'customer_code', null, 'is_new_customer', false);
end $$;

-- ---------------------------------------------------------------------------
-- Owner RPCs
-- ---------------------------------------------------------------------------
create or replace function public.owner_stations_menus() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_owner() then raise exception 'not_owner'; end if;
  return jsonb_build_object(
    'menus', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'name_ar', m.name_ar, 'name_en', m.name_en, 'active', m.active,
        'station_id', (select o.id from public.stations o where o.menu_id = m.id limit 1),
        'item_ids', coalesce((select jsonb_agg(ci.menu_item_id) from public.custom_menu_items ci where ci.menu_id = m.id), '[]'::jsonb),
        'members', coalesce((select jsonb_agg(jsonb_build_object('customer_id', c.id, 'phone', c.phone, 'name', c.name) order by x.added_at)
          from public.custom_menu_members x join public.customers c on c.id = x.customer_id where x.menu_id = m.id), '[]'::jsonb)) order by m.created_at)
      from public.custom_menus m), '[]'::jsonb),
    'stations', coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'name', o.name, 'active', o.active, 'menu_id', o.menu_id,
        'account_customer_id', o.account_customer_id,
        'debt_limit', a.debt_limit, 'outstanding', public.customer_outstanding(a.id),
        'open_bill', (select coalesce(public.bill_items_total(b.id), 0) from public.bills b where b.customer_id = a.id and b.status = 'open'),
        'members', coalesce((select jsonb_agg(jsonb_build_object('customer_id', c.id, 'phone', c.phone, 'name', c.name) order by x.added_at)
          from public.station_members x join public.customers c on c.id = x.customer_id where x.station_id = o.id), '[]'::jsonb)) order by o.created_at)
      from public.stations o join public.customers a on a.id = o.account_customer_id), '[]'::jsonb)
  );
end $$;

create or replace function public.owner_create_station(p_name text) returns jsonb
language plpgsql volatile security definer set search_path = public, extensions as $$
declare v_name text := left(trim(coalesce(p_name, '')), 80); v_cid uuid; v_menu uuid; v_id uuid;
begin
  if not public.is_owner() then raise exception 'not_owner'; end if;
  if v_name = '' then v_name := 'Station ' || ((select count(*) from public.stations) + 1); end if;
  insert into public.customers (phone, name, code, is_account)
  values ('station-' || encode(extensions.gen_random_bytes(6), 'hex'), left('🖥 ' || v_name, 80), public.gen_customer_code(), true)
  returning id into v_cid;
  insert into public.custom_menus (name_ar, name_en) values (v_name, v_name) returning id into v_menu;
  insert into public.stations (name, account_customer_id, menu_id) values (v_name, v_cid, v_menu) returning id into v_id;
  perform public.audit('create_station', 'stations', v_id::text, jsonb_build_object('name', v_name));
  return jsonb_build_object('id', v_id, 'menu_id', v_menu, 'account_customer_id', v_cid);
end $$;

create or replace function public.owner_update_station(p_station uuid, p_name text, p_active boolean) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare o public.stations; v_name text := left(trim(coalesce(p_name, '')), 80);
begin
  if not public.is_owner() then raise exception 'not_owner'; end if;
  if v_name = '' then raise exception 'name_required'; end if;
  update public.stations set name = v_name, active = coalesce(p_active, active) where id = p_station returning * into o;
  if not found then raise exception 'not_found'; end if;
  update public.customers set name = left('🖥 ' || v_name, 80) where id = o.account_customer_id;
  perform public.audit('update_station', 'stations', o.id::text, jsonb_build_object('name', v_name, 'active', o.active));
  return jsonb_build_object('ok', true);
end $$;

-- Add a person to a custom menu ('menu') or an station ('station') by phone; creates the customer if new.
create or replace function public.owner_add_member(p_kind text, p_target uuid, p_phone text, p_name text) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare v_phone text := public.normalize_phone(p_phone); c public.customers; v_other uuid;
begin
  if not public.is_owner() then raise exception 'not_owner'; end if;
  if v_phone !~ '^[0-9]{8,15}$' then raise exception 'bad_phone'; end if;
  if p_kind = 'menu' then
    if not exists (select 1 from public.custom_menus where id = p_target) then raise exception 'not_found'; end if;
  elsif p_kind = 'station' then
    if not exists (select 1 from public.stations where id = p_target) then raise exception 'not_found'; end if;
  else
    raise exception 'bad_request';
  end if;
  select * into c from public.customers where phone = v_phone;
  if not found then
    insert into public.customers (phone, name, code) values (v_phone, left(coalesce(trim(p_name), ''), 80), public.gen_customer_code()) returning * into c;
  elsif c.name = '' and coalesce(trim(p_name), '') <> '' then
    update public.customers set name = left(trim(p_name), 80) where id = c.id returning * into c;
  end if;
  if p_kind = 'menu' then
    insert into public.custom_menu_members (menu_id, customer_id, added_by) values (p_target, c.id, auth.uid()) on conflict do nothing;
  else
    select station_id into v_other from public.station_members where customer_id = c.id;
    if v_other is not null and v_other <> p_target then raise exception 'already_in_station'; end if;
    insert into public.station_members (station_id, customer_id, added_by) values (p_target, c.id, auth.uid()) on conflict do nothing;
  end if;
  perform public.audit('add_member', p_kind, p_target::text, jsonb_build_object('customer_id', c.id, 'phone', v_phone));
  return jsonb_build_object('customer_id', c.id, 'phone', c.phone, 'name', c.name, 'code', c.code);
end $$;

grant execute on function public.customer_my_menus(text, text) to anon, authenticated;
grant execute on function public.customer_place_order2(uuid, text, text, text, text, jsonb, text, boolean) to anon, authenticated;
grant execute on function public.owner_stations_menus() to authenticated;
grant execute on function public.owner_create_station(text) to authenticated;
grant execute on function public.owner_update_station(uuid, text, boolean) to authenticated;
grant execute on function public.owner_add_member(text, uuid, text, text) to authenticated;
revoke execute on function public.customer_menu_ids(uuid) from public, anon, authenticated;
revoke execute on function public.trg_order_item_menu() from public, anon, authenticated;
