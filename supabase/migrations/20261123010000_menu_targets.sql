-- Apply a custom menu to places, stations and events, not only to phone numbers.
--
-- Targets: one room/table/area ('place'), all tables / all rooms / all shared areas, all stations,
-- one station, one event. A menu is shown to (and orderable by) whoever matches ANY of its targets
-- or is on it by phone. Several matching menus all apply together (union); there is no priority.
--   place / all_*: the order's place, from the QR the customer scanned. No phone needed to see it.
--   station / all_stations: members of that station (or of any active station).
--   event: from 2 hours before it starts until it ends (or 6 hours after start), for people signed
--          up and for anyone ordering from the event's place.

create table public.custom_menu_targets (
  id uuid primary key default gen_random_uuid(),
  menu_id uuid not null references public.custom_menus(id) on delete cascade,
  kind text not null check (kind in ('place', 'all_tables', 'all_rooms', 'all_areas', 'all_stations', 'station', 'event')),
  ref_id uuid,
  created_at timestamptz not null default now(),
  check ((kind in ('place', 'station', 'event')) = (ref_id is not null))
);
create unique index custom_menu_targets_uniq on public.custom_menu_targets (menu_id, kind, coalesce(ref_id, '00000000-0000-0000-0000-000000000000'::uuid));
create index on public.custom_menu_targets (kind, ref_id);

alter table public.custom_menu_targets enable row level security;
create policy staff_read on public.custom_menu_targets for select to authenticated using (public.is_staff());
create policy owner_write on public.custom_menu_targets for all to authenticated using (public.is_owner()) with check (public.is_owner());

-- Every active menu that applies to this person (may be null) ordering at this place (may be null).
create or replace function public.menus_for(p_customer uuid, p_place uuid) returns setof uuid
language sql stable security definer set search_path = public as $$
  select m.id from public.custom_menus m
  where m.active and (
    (p_customer is not null and m.id in (select public.customer_menu_ids(p_customer)))
    or exists (select 1 from public.custom_menu_targets t where t.menu_id = m.id and (
         (t.kind = 'place' and t.ref_id = p_place)
      or (t.kind in ('all_tables', 'all_rooms', 'all_areas') and exists (select 1 from public.places p where p.id = p_place and p.active
            and p.kind = case t.kind when 'all_tables' then 'table' when 'all_rooms' then 'room' else 'area' end))
      or (t.kind in ('all_stations', 'station') and p_customer is not null and exists (
            select 1 from public.station_members x join public.stations s on s.id = x.station_id
            where x.customer_id = p_customer and s.active and (t.kind = 'all_stations' or s.id = t.ref_id)))
      or (t.kind = 'event' and exists (
            select 1 from public.events e where e.id = t.ref_id and e.active
              and now() between e.starts_at - interval '2 hours' and coalesce(e.ends_at, e.starts_at + interval '6 hours')
              and ((p_place is not null and e.place_id = p_place)
                or (p_customer is not null and exists (select 1 from public.event_signups g
                      where g.event_id = e.id and g.customer_id = p_customer and g.status <> 'cancelled')))))
    )));
$$;

-- Hidden items: allowed when on any menu that applies to the person or the order's place.
create or replace function public.trg_order_item_menu() returns trigger
language plpgsql security definer set search_path = public as $$
declare o public.orders;
begin
  if new.menu_item_id is null or (select public from public.menu_items where id = new.menu_item_id) then return new; end if;
  select * into o from public.orders where id = new.order_id;
  if o.source = 'staff' then return new; end if;
  if not exists (select 1 from public.custom_menu_items ci
                 where ci.menu_item_id = new.menu_item_id
                   and ci.menu_id in (select public.menus_for(public.resolve_customer(coalesce(o.ordered_by, o.customer_id)), o.place_id))) then
    raise exception 'item_not_found';
  end if;
  return new;
end $$;

-- Menus for this device: by phone + code (optional) and by the scanned QR place (optional).
create or replace function public.customer_menus2(p_phone text, p_code text, p_token text) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare v_phone text := public.normalize_phone(p_phone); v_key text := 'bill:' || public.normalize_phone(p_phone);
  v_cid uuid; v_place uuid; o public.stations; v_ids uuid[];
begin
  if v_phone <> '' and coalesce(trim(p_code), '') <> '' then
    if not public.throttle_check(v_key) then return jsonb_build_object('error', 'too_many_attempts'); end if;
    select id into v_cid from public.customers where phone = v_phone and code = trim(p_code) and not is_account;
    if v_cid is null then insert into public.lookup_attempts (key, ok) values (v_key, false); end if;
  end if;
  if coalesce(p_token, '') <> '' then
    select id into v_place from public.places where qr_token = p_token and active;
  end if;
  if v_cid is not null then
    select s.* into o from public.station_members x join public.stations s on s.id = x.station_id where x.customer_id = v_cid and s.active;
  end if;
  select coalesce(array_agg(id), '{}') into v_ids from public.menus_for(v_cid, v_place) id;
  return jsonb_build_object(
    'known', v_cid is not null,
    'station', case when o.id is null then null else jsonb_build_object('id', o.id, 'name', o.name) end,
    'menus', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'name_ar', m.name_ar, 'name_en', m.name_en,
        'item_ids', coalesce((select jsonb_agg(ci.menu_item_id) from public.custom_menu_items ci join public.menu_items i on i.id = ci.menu_item_id
                              where ci.menu_id = m.id and i.active), '[]'::jsonb)) order by m.created_at)
      from public.custom_menus m where m.id = any(v_ids)), '[]'::jsonb),
    'items', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'category_id', i.category_id, 'name_ar', i.name_ar, 'name_en', i.name_en,
        'desc_ar', i.desc_ar, 'desc_en', i.desc_en, 'price', i.price, 'image_url', i.image_url, 'options', i.options,
        'available', i.available, 'active', i.active, 'sort', i.sort) order by i.sort, i.name_en)
      from public.menu_items i where i.active and i.id in (select ci.menu_item_id from public.custom_menu_items ci where ci.menu_id = any(v_ids))), '[]'::jsonb)
  );
end $$;

-- Owner screen: add each menu's targets and the events it can target.
do $$
declare d text;
begin
  d := pg_get_functiondef('public.owner_stations_menus()'::regprocedure);
  if position('''item_ids'', coalesce((select jsonb_agg(ci.menu_item_id) from public.custom_menu_items ci where ci.menu_id = m.id), ''[]''::jsonb),' in d) = 0
     or position('    ''stations'', coalesce(' in d) = 0 then raise exception 'patch owner_stations_menus failed'; end if;
  d := replace(d, '''item_ids'', coalesce((select jsonb_agg(ci.menu_item_id) from public.custom_menu_items ci where ci.menu_id = m.id), ''[]''::jsonb),',
    '''item_ids'', coalesce((select jsonb_agg(ci.menu_item_id) from public.custom_menu_items ci where ci.menu_id = m.id), ''[]''::jsonb),
        ''targets'', coalesce((select jsonb_agg(jsonb_build_object(''id'', t.id, ''kind'', t.kind, ''ref_id'', t.ref_id) order by t.created_at)
          from public.custom_menu_targets t where t.menu_id = m.id), ''[]''::jsonb),');
  d := replace(d, '    ''stations'', coalesce(', '    ''events'', coalesce((select jsonb_agg(jsonb_build_object(''id'', e.id, ''title_ar'', e.title_ar, ''title_en'', e.title_en, ''starts_at'', e.starts_at) order by e.starts_at)
      from public.events e where e.active and coalesce(e.ends_at, e.starts_at + interval ''6 hours'') > now() - interval ''1 day''), ''[]''::jsonb),
    ''stations'', coalesce(');
  execute d;
end $$;

grant execute on function public.customer_menus2(text, text, text) to anon, authenticated;
revoke execute on function public.menus_for(uuid, uuid) from public, anon, authenticated;
