-- Which places a mode is for: private rooms (PlayStation, lectures...), shared areas (a seat),
-- or both. Existing modes were all made for rooms.
alter table public.room_modes add column place_scope text not null default 'room' check (place_scope in ('room', 'area', 'all'));

do $$
declare d text;
begin
  d := pg_get_functiondef('public.staff_op(jsonb)'::regprocedure);
  if position('if not found then raise exception ''bad_mode''; end if;
    v_sid := (p->>''id'')::uuid;' in d) = 0 then raise exception 'patch staff_op mode scope failed'; end if;
  d := replace(d, 'if not found then raise exception ''bad_mode''; end if;
    v_sid := (p->>''id'')::uuid;', 'if not found then raise exception ''bad_mode''; end if;
    if v_mode.place_scope <> ''all'' and v_mode.place_scope <> v_place.kind then raise exception ''mode_not_here''; end if;
    v_sid := (p->>''id'')::uuid;');
  execute d;
end $$;

create or replace function public.public_catalog2() returns jsonb
language sql stable security definer set search_path = public as $$
  select public.public_catalog() || jsonb_build_object(
    'modes', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'name_ar', m.name_ar, 'name_en', m.name_en, 'hourly_rate', m.hourly_rate, 'sort', m.sort, 'place_scope', m.place_scope) order by m.sort)
      from public.room_modes m where m.active), '[]'::jsonb),
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
