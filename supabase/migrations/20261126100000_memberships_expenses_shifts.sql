-- dot round 8: memberships (unlimited passes), expenses, staff shifts.
-- Additive only. The client calls staff_op6 / staff_snapshot3, which wrap staff_op5 / staff_snapshot2.

-- ---------------------------------------------------------------------------
-- Memberships: a bundle plan can be unlimited (day, week, month pass) and can be
-- limited to rooms or to shared areas. Bought, sold and used exactly like an hour bundle.
-- ---------------------------------------------------------------------------
alter table public.bundle_plans
  add column unlimited boolean not null default false,
  add column place_kind text check (place_kind in ('room', 'area'));   -- null = rooms and shared areas
alter table public.customer_bundles
  add column unlimited boolean not null default false,
  add column place_kind text check (place_kind in ('room', 'area'));

-- An unlimited pass gets a balance nobody can use up (10M minutes ≈ 19 years).
create or replace function public.trg_bundle_from_plan() returns trigger
language plpgsql security definer set search_path = public as $$
declare pl public.bundle_plans;
begin
  if new.plan_id is not null then
    select * into pl from public.bundle_plans where id = new.plan_id;
    if found then
      new.unlimited := pl.unlimited;
      new.place_kind := pl.place_kind;
    end if;
  end if;
  if new.unlimited then new.minutes_total := 10000000; end if;
  return new;
end $$;
create trigger bundle_from_plan before insert on public.customer_bundles
  for each row execute function public.trg_bundle_from_plan();

create or replace function public.public_catalog2() returns jsonb
language sql stable security definer set search_path = public as $$
  select public.public_catalog() || jsonb_build_object(
    'modes', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'name_ar', m.name_ar, 'name_en', m.name_en, 'hourly_rate', m.hourly_rate, 'sort', m.sort, 'place_scope', m.place_scope) order by m.sort)
      from public.room_modes m where m.active), '[]'::jsonb),
    'bundle_plans', coalesce((select jsonb_agg(jsonb_build_object('id', b.id, 'name_ar', b.name_ar, 'name_en', b.name_en, 'hours', b.hours,
        'price', b.price, 'valid_days', b.valid_days, 'mode_id', b.mode_id, 'unlimited', b.unlimited, 'place_kind', b.place_kind) order by b.unlimited, b.sort, b.hours)
      from public.bundle_plans b where b.active), '[]'::jsonb),
    'review_url', (select google_review_url from public.settings where id = 1),
    'loyalty', (select jsonb_build_object('every', loyalty_every, 'reward_minutes', loyalty_reward_minutes) from public.settings where id = 1),
    'happy_hours', public.happy_hours_json(),
    'areas', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'capacity', p.capacity,
        'occupied', (select count(*) from public.room_sessions s where s.place_id = p.id and s.status = 'active')) order by p.sort)
      from public.places p where p.kind = 'area' and p.active), '[]'::jsonb),
    'events', public.public_events());
$$;

-- Customer bill page: bundles and passes say whether they're unlimited and where they work.
create or replace function public.customer_bill4(p_phone text, p_code text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r jsonb; c public.customers;
begin
  r := public.customer_bill3(p_phone, p_code);
  if r ? 'error' then return r; end if;
  select * into c from public.customers where phone = public.normalize_phone(p_phone) and code = trim(coalesce(p_code, ''));
  return r || jsonb_build_object(
    'events', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'title_ar', e.title_ar, 'title_en', e.title_en,
        'starts_at', e.starts_at, 'seats', s.seats) order by e.starts_at)
      from public.event_signups s join public.events e on e.id = s.event_id
      where s.customer_id = c.id and s.status = 'going' and coalesce(e.ends_at, e.starts_at + interval '3 hours') > now()), '[]'::jsonb),
    'bundles', coalesce((select jsonb_agg(jsonb_build_object('name_ar', b.name_ar, 'name_en', b.name_en, 'minutes_left', b.minutes_total - b.minutes_used,
        'expires_at', b.expires_at, 'mode_id', b.mode_id, 'source', b.source, 'unlimited', b.unlimited, 'place_kind', b.place_kind) order by b.unlimited desc, b.expires_at)
      from public.customer_bundles b
      where b.customer_id = c.id and b.voided_at is null and b.expires_at > now() and b.minutes_total - b.minutes_used > 0.5), '[]'::jsonb));
end $$;

-- ---------------------------------------------------------------------------
-- Expenses (owner): rent, salaries, bills, supplies… Reports subtract them for profit.
-- Cash outs from the drawer stay where they are and count as expenses in the profit line.
-- ---------------------------------------------------------------------------
create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  business_day date not null,
  category text not null check (category in ('rent', 'salaries', 'utilities', 'internet', 'supplies', 'maintenance', 'marketing', 'other')),
  amount numeric(10,2) not null check (amount > 0 and amount < 100000000),
  method text not null default 'cash' check (method in ('cash', 'instapay', 'vodafone', 'bank', 'other')),
  note text not null default '' check (length(note) <= 200),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);
create index on public.expenses (business_day);
alter table public.expenses enable row level security;
create policy owner_all on public.expenses for all to authenticated using (public.is_owner()) with check (public.is_owner());

create or replace function public.trg_expense_audit() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    perform public.audit('expense_delete', 'expenses', old.id::text, to_jsonb(old));
    return old;
  end if;
  perform public.audit(case when tg_op = 'INSERT' then 'expense_add' else 'expense_edit' end, 'expenses', new.id::text, to_jsonb(new));
  return new;
end $$;
create trigger expense_audit after insert or update or delete on public.expenses
  for each row execute function public.trg_expense_audit();

-- ---------------------------------------------------------------------------
-- Staff shifts: "Start shift" clocks the signed-in person in; "End shift" clocks them out.
-- Sent as counter ops, so they work offline and keep the device's time.
-- ---------------------------------------------------------------------------
create table public.staff_shifts (
  id uuid primary key,
  user_id uuid not null references auth.users(id),
  started_at timestamptz not null,
  ended_at timestamptz,
  auto_closed boolean not null default false,
  check (ended_at is null or ended_at >= started_at)
);
create index on public.staff_shifts (user_id, started_at desc);
create unique index staff_shifts_one_open on public.staff_shifts (user_id) where ended_at is null;
alter table public.staff_shifts enable row level security;
create policy staff_read_own on public.staff_shifts for select to authenticated using (user_id = auth.uid() or public.is_owner());

-- Hours per person in a date range (by business day of the shift start). Open shifts count up to now.
create or replace function public.owner_shifts(p_from date, p_to date) returns jsonb
language sql stable security definer set search_path = public as $$
  select case when not public.is_owner() then '[]'::jsonb else coalesce(jsonb_agg(jsonb_build_object(
      'id', s.id, 'user_id', s.user_id, 'name', sp.name, 'phone', sp.phone, 'started_at', s.started_at, 'ended_at', s.ended_at,
      'auto_closed', s.auto_closed,
      'minutes', round(extract(epoch from (coalesce(s.ended_at, now()) - s.started_at)) / 60)) order by s.started_at desc), '[]'::jsonb) end
  from public.staff_shifts s left join public.staff_profiles sp on sp.user_id = s.user_id
  where public.business_day(s.started_at) between p_from and p_to;
$$;
grant execute on function public.owner_shifts(date, date) to authenticated;

-- ---------------------------------------------------------------------------
-- staff_op6: shift_start / shift_end; membership scope check on end_session; the rest → staff_op5.
-- ---------------------------------------------------------------------------
create or replace function public.staff_op6(op jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public, extensions as $$
declare
  v_type text := op->>'type';
  v_uid uuid := auth.uid();
  p jsonb := coalesce(op->'payload', '{}'::jsonb);
  v_at timestamptz := least(coalesce((op->>'at')::timestamptz, now()), now() + interval '2 minutes');
  v_b public.customer_bundles; v_kind text; v_open public.staff_shifts;
begin
  if v_type = 'end_session' and jsonb_typeof(p->'bundle') = 'object' then
    select * into v_b from public.customer_bundles where id = (p->'bundle'->>'bundle_id')::uuid;
    select pl.kind into v_kind from public.room_sessions s join public.places pl on pl.id = s.place_id where s.id = (p->>'session_id')::uuid;
    if found and v_b.place_kind is not null and v_b.place_kind <> v_kind then raise exception 'bundle_place'; end if;
  end if;

  if v_type not in ('shift_start', 'shift_end') then
    return public.staff_op5(op);
  end if;

  if not exists (select 1 from public.staff_profiles where user_id = v_uid and active) then raise exception 'not_staff'; end if;
  insert into public.applied_ops (op_id, type, actor) values ((op->>'id')::uuid, v_type, v_uid) on conflict (op_id) do nothing;
  if not found then return jsonb_build_object('ok', true, 'duplicate', true); end if;

  -- shift_end names its shift: an op queued offline before signing out may be sent later under
  -- the next person's sign-in on the same counter.
  if v_type = 'shift_end' and p ? 'shift_id' then
    select * into v_open from public.staff_shifts where id = (p->>'shift_id')::uuid and ended_at is null for update;
  else
    select * into v_open from public.staff_shifts where user_id = v_uid and ended_at is null for update;
  end if;
  if v_type = 'shift_start' then
    if found then
      -- Forgot to end the last one: close it where it started if it's over 16 hours old, else now.
      update public.staff_shifts set ended_at = greatest(started_at, case when v_at - started_at > interval '16 hours' then started_at + interval '16 hours' else v_at end),
        auto_closed = true where id = v_open.id;
    end if;
    insert into public.staff_shifts (id, user_id, started_at) values ((p->>'id')::uuid, v_uid, v_at);
  else
    if found then
      update public.staff_shifts set ended_at = greatest(started_at, v_at) where id = v_open.id;
    end if;
  end if;
  return jsonb_build_object('ok', true);
end $$;
grant execute on function public.staff_op6(jsonb) to authenticated;

create or replace function public.staff_snapshot3() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  return public.staff_snapshot2() || jsonb_build_object(
    'shifts', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'user_id', s.user_id, 'started_at', s.started_at, 'ended_at', s.ended_at) order by s.started_at)
      from public.staff_shifts s where s.ended_at is null or s.started_at > now() - interval '24 hours'), '[]'::jsonb)
  );
end $$;
grant execute on function public.staff_snapshot3() to authenticated;
revoke execute on function public.staff_op6(jsonb) from public, anon;
revoke execute on function public.staff_snapshot3() from public, anon;
revoke execute on function public.owner_shifts(date, date) from public, anon;

alter publication supabase_realtime add table public.staff_shifts;
