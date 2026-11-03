-- dot round 3: hour bundles (prepaid room time) and café stock.
-- Additive only. The client calls staff_op3 / staff_snapshot2 / public_catalog2, which wrap the earlier versions.

-- ---------------------------------------------------------------------------
-- Hour bundles
-- ---------------------------------------------------------------------------
create table public.bundle_plans (
  id uuid primary key default gen_random_uuid(),
  name_ar text not null check (length(name_ar) between 1 and 80),
  name_en text not null check (length(name_en) between 1 and 80),
  hours numeric(6,2) not null check (hours > 0 and hours <= 1000),
  price numeric(10,2) not null check (price >= 0),
  valid_days int not null default 30 check (valid_days between 1 and 730),
  mode_id uuid references public.room_modes(id),          -- null = any mode
  active boolean not null default true,
  sort int not null default 0,
  created_at timestamptz not null default now()
);

create table public.customer_bundles (
  id uuid primary key,
  customer_id uuid not null references public.customers(id),
  plan_id uuid references public.bundle_plans(id),
  name_ar text not null,
  name_en text not null,
  mode_id uuid references public.room_modes(id),
  minutes_total numeric(10,2) not null check (minutes_total > 0),
  minutes_used numeric(10,2) not null default 0 check (minutes_used >= 0),
  price numeric(10,2) not null,
  order_item_id uuid unique references public.order_items(id),
  expires_at timestamptz not null,
  voided_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid
);
create index on public.customer_bundles (customer_id);

create table public.bundle_uses (
  id uuid primary key default gen_random_uuid(),
  bundle_id uuid not null references public.customer_bundles(id),
  session_id uuid not null references public.room_sessions(id),
  minutes numeric(10,2) not null check (minutes > 0),
  amount numeric(10,2) not null check (amount >= 0),
  at timestamptz not null default now(),
  by uuid
);
create index on public.bundle_uses (session_id);

alter table public.bundle_plans enable row level security;
alter table public.customer_bundles enable row level security;
alter table public.bundle_uses enable row level security;
create policy staff_read on public.bundle_plans for select to authenticated using (public.is_staff());
create policy owner_write on public.bundle_plans for all to authenticated using (public.is_owner()) with check (public.is_owner());
create policy staff_read on public.customer_bundles for select to authenticated using (public.is_staff());
create policy staff_read on public.bundle_uses for select to authenticated using (public.is_staff());

-- A bundle bought on a bill disappears if its line is voided or its order cancelled, unless time was already used.
create or replace function public.bundle_void_for_item(p_item uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_staff() then return; end if;
  if exists (select 1 from public.customer_bundles where order_item_id = p_item and voided_at is null and minutes_used > 0) then
    raise exception 'bundle_in_use';
  end if;
  update public.customer_bundles set voided_at = now() where order_item_id = p_item and voided_at is null;
end $$;

create or replace function public.trg_bundle_item() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.voided_at is not null and old.voided_at is null then
    perform public.bundle_void_for_item(new.id);
  elsif new.qty <> old.qty and exists (select 1 from public.customer_bundles where order_item_id = new.id) then
    raise exception 'bundle_qty_fixed';
  end if;
  return new;
end $$;
create trigger bundle_item after update of qty, voided_at on public.order_items
  for each row execute function public.trg_bundle_item();

create or replace function public.trg_bundle_order() returns trigger
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if new.status in ('cancelled','rejected') and old.status not in ('cancelled','rejected') then
    for r in select id from public.order_items where order_id = new.id loop
      perform public.bundle_void_for_item(r.id);
    end loop;
  end if;
  return new;
end $$;
create trigger bundle_order after update of status on public.orders
  for each row execute function public.trg_bundle_order();

-- ---------------------------------------------------------------------------
-- Stock
-- ---------------------------------------------------------------------------
alter table public.menu_items
  add column track_stock boolean not null default false,
  add column stock_qty numeric(10,2) not null default 0,
  add column low_stock_at numeric(10,2) not null default 0,
  add column stock_auto_off boolean not null default false;

create table public.stock_moves (
  id bigserial primary key,
  menu_item_id uuid not null references public.menu_items(id),
  delta numeric(10,2) not null,
  qty_after numeric(10,2) not null,
  reason text not null,            -- sale | void | cancel | restock | count | waste
  ref text,
  note text not null default '',
  at timestamptz not null default now(),
  by uuid default auth.uid()
);
create index on public.stock_moves (menu_item_id, at desc);
alter table public.stock_moves enable row level security;
create policy staff_read on public.stock_moves for select to authenticated using (public.is_staff());

-- Moves stock for tracked items. Sells out automatically at 0 and comes back when restocked
-- (only if it was the stock that took it off, not a manual "sold out").
create or replace function public.stock_apply(p_item uuid, p_delta numeric, p_reason text, p_ref text, p_note text default '')
returns void language plpgsql security definer set search_path = public as $$
declare m public.menu_items;
begin
  if p_item is null or coalesce(p_delta, 0) = 0 or not public.is_staff() then return; end if;
  update public.menu_items set stock_qty = stock_qty + p_delta where id = p_item and track_stock returning * into m;
  if not found then return; end if;
  insert into public.stock_moves (menu_item_id, delta, qty_after, reason, ref, note) values (p_item, p_delta, m.stock_qty, p_reason, p_ref, left(coalesce(p_note, ''), 200));
  if m.stock_qty <= 0 and m.available then
    update public.menu_items set available = false, stock_auto_off = true where id = p_item;
  elsif m.stock_qty > 0 and not m.available and m.stock_auto_off then
    update public.menu_items set available = true, stock_auto_off = false where id = p_item;
  end if;
end $$;

-- An order counts against stock while it is accepted or served.
create or replace function public.trg_order_stock() returns trigger
language plpgsql security definer set search_path = public as $$
declare was boolean; is_now boolean; r record;
begin
  was := old.status in ('accepted','served');
  is_now := new.status in ('accepted','served');
  if was = is_now then return new; end if;
  for r in select menu_item_id, qty from public.order_items where order_id = new.id and voided_at is null and menu_item_id is not null loop
    perform public.stock_apply(r.menu_item_id, case when is_now then -r.qty else r.qty end, case when is_now then 'sale' else 'cancel' end, new.id::text);
  end loop;
  return new;
end $$;
create trigger order_stock after update of status on public.orders
  for each row execute function public.trg_order_stock();

create or replace function public.trg_item_stock() returns trigger
language plpgsql security definer set search_path = public as $$
declare counted boolean; old_q numeric := 0; new_q numeric;
begin
  if new.menu_item_id is null then return new; end if;
  select status in ('accepted','served') into counted from public.orders where id = new.order_id;
  if not coalesce(counted, false) then return new; end if;
  if tg_op = 'UPDATE' then old_q := case when old.voided_at is null then old.qty else 0 end; end if;
  new_q := case when new.voided_at is null then new.qty else 0 end;
  if new_q <> old_q then
    perform public.stock_apply(new.menu_item_id, old_q - new_q, case when new_q > old_q then 'sale' else 'void' end, new.order_id::text);
  end if;
  return new;
end $$;
create trigger item_stock after insert or update of qty, voided_at on public.order_items
  for each row execute function public.trg_item_stock();

-- ---------------------------------------------------------------------------
-- staff_op3: sell_bundle, stock_adjust, end_session with a bundle; everything else → staff_op2
-- ---------------------------------------------------------------------------
create or replace function public.staff_op3(op jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public, extensions as $$
declare
  v_type text := op->>'type';
  v_uid uuid := auth.uid();
  v_role text;
  p jsonb := coalesce(op->'payload', '{}'::jsonb);
  v_at timestamptz := least(coalesce((op->>'at')::timestamptz, now()), now() + interval '2 minutes');
  v_res jsonb; v_plan public.bundle_plans; v_cid uuid; v_bill public.bills; v_b public.customer_bundles;
  v_sess public.room_sessions; v_min numeric; v_amt numeric; v_maxrate numeric; v_item public.menu_items; v_delta numeric;
begin
  if v_type = 'end_session' then
    v_res := public.staff_op2(op);
    if coalesce((v_res->>'duplicate')::boolean, false) or jsonb_typeof(p->'bundle') is distinct from 'object' then return v_res; end if;
    select * into v_sess from public.room_sessions where id = (p->>'session_id')::uuid;
    select * into v_b from public.customer_bundles where id = (p->'bundle'->>'bundle_id')::uuid for update;
    if not found or v_b.voided_at is not null then raise exception 'bundle_not_found'; end if;
    if v_b.expires_at < v_at then raise exception 'bundle_expired'; end if;
    if v_b.customer_id <> v_sess.booker_customer_id then raise exception 'bundle_not_booker'; end if;
    v_min := round((p->'bundle'->>'minutes')::numeric, 2);
    v_amt := public.money((p->'bundle'->>'amount')::numeric);
    if v_min <= 0 or v_min > v_b.minutes_total - v_b.minutes_used + 0.01 then raise exception 'bundle_balance'; end if;
    select max(rate) into v_maxrate from public.session_segments where session_id = v_sess.id;
    if v_amt < 0 or v_amt > v_min * coalesce(v_maxrate, 0) / 60 + 0.05 then raise exception 'bundle_amount'; end if;
    update public.customer_bundles set minutes_used = least(minutes_total, minutes_used + v_min) where id = v_b.id;
    insert into public.bundle_uses (id, bundle_id, session_id, minutes, amount, at, by)
    values (coalesce((p->'bundle'->>'id')::uuid, gen_random_uuid()), v_b.id, v_sess.id, v_min, v_amt, v_at, v_uid);
    perform public.audit('use_bundle', 'customer_bundles', v_b.id::text, p->'bundle');
    return v_res;
  end if;

  if v_type not in ('sell_bundle', 'stock_adjust') then
    return public.staff_op2(op);
  end if;

  select role into v_role from public.staff_profiles where user_id = v_uid and active;
  if v_role is null then raise exception 'not_staff'; end if;
  insert into public.applied_ops (op_id, type, actor) values ((op->>'id')::uuid, v_type, v_uid) on conflict (op_id) do nothing;
  if not found then return jsonb_build_object('ok', true, 'duplicate', true); end if;

  if v_type = 'sell_bundle' then
    select * into v_plan from public.bundle_plans where id = (p->>'plan_id')::uuid and active;
    if not found then raise exception 'bad_plan'; end if;
    v_cid := public.resolve_customer((p->>'customer_id')::uuid);
    select * into v_bill from public.bills where customer_id = v_cid and status = 'open';
    if not found then
      insert into public.bills (id, customer_id, place_id, session_id, status, opened_at, opened_by)
      values ((p->>'bill_id')::uuid, v_cid, null, null, 'open', v_at, v_uid) returning * into v_bill;
    end if;
    insert into public.orders (id, customer_id, place_id, bill_id, source, status, note, created_at, accepted_at, accepted_by)
    values ((p->>'order_id')::uuid, v_cid, v_bill.place_id, v_bill.id, 'staff', 'accepted', '', v_at, v_at, v_uid);
    insert into public.order_items (id, order_id, menu_item_id, name_ar, name_en, unit_price, qty)
    values ((p->>'item_id')::uuid, (p->>'order_id')::uuid, null, v_plan.name_ar, v_plan.name_en, v_plan.price, 1);
    insert into public.customer_bundles (id, customer_id, plan_id, name_ar, name_en, mode_id, minutes_total, price, order_item_id, expires_at, created_at, created_by)
    values ((p->>'id')::uuid, v_cid, v_plan.id, v_plan.name_ar, v_plan.name_en, v_plan.mode_id, v_plan.hours * 60, v_plan.price,
      (p->>'item_id')::uuid, v_at + make_interval(days => v_plan.valid_days), v_at, v_uid);
    perform public.audit('sell_bundle', 'customer_bundles', p->>'id', p);
    v_res := jsonb_build_object('bill_id', v_bill.id);

  elsif v_type = 'stock_adjust' then
    select * into v_item from public.menu_items where id = (p->>'menu_item_id')::uuid for update;
    if not found or not v_item.track_stock then raise exception 'not_tracked'; end if;
    if p->>'reason' not in ('restock', 'count', 'waste') then raise exception 'bad_reason'; end if;
    v_delta := case when p->>'reason' = 'count' then (p->>'qty')::numeric - v_item.stock_qty
                    when p->>'reason' = 'waste' then -abs((p->>'qty')::numeric)
                    else abs((p->>'qty')::numeric) end;
    perform public.stock_apply(v_item.id, round(v_delta, 2), p->>'reason', op->>'id', p->>'note');
    v_res := jsonb_build_object('stock_qty', (select stock_qty from public.menu_items where id = v_item.id));
  end if;

  return coalesce(v_res, '{}'::jsonb) || jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------------------
-- Snapshot / catalog extras
-- ---------------------------------------------------------------------------
create or replace function public.staff_snapshot2() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  return public.staff_snapshot() || jsonb_build_object(
    'bundle_plans', coalesce((select jsonb_agg(to_jsonb(b) order by b.sort, b.hours) from public.bundle_plans b), '[]'::jsonb),
    'customer_bundles', coalesce((select jsonb_agg(to_jsonb(c) order by c.created_at) from public.customer_bundles c
        where c.voided_at is null and (c.expires_at > now() - interval '14 days' or c.created_at > now() - interval '14 days')), '[]'::jsonb),
    'bundle_uses', coalesce((select jsonb_agg(to_jsonb(u) order by u.at) from public.bundle_uses u where u.at > now() - interval '35 days'), '[]'::jsonb),
    'stock_moves', coalesce((select jsonb_agg(to_jsonb(m) order by m.at desc) from (select * from public.stock_moves order by at desc limit 150) m), '[]'::jsonb)
  );
end $$;

create or replace function public.public_catalog2() returns jsonb
language sql stable security definer set search_path = public as $$
  select public.public_catalog() || jsonb_build_object(
    'bundle_plans', coalesce((select jsonb_agg(jsonb_build_object('id', b.id, 'name_ar', b.name_ar, 'name_en', b.name_en, 'hours', b.hours,
        'price', b.price, 'valid_days', b.valid_days, 'mode_id', b.mode_id) order by b.sort, b.hours)
      from public.bundle_plans b where b.active), '[]'::jsonb));
$$;

-- Internal helpers return early for non-staff callers (direct RPC calls do nothing).
grant execute on function public.staff_op3(jsonb) to authenticated;
grant execute on function public.staff_snapshot2() to authenticated;
grant execute on function public.public_catalog2() to anon, authenticated;
