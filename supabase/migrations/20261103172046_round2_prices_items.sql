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

create or replace function public.segment_rate() returns trigger
language plpgsql set search_path = public as $$
begin
  new.rate := coalesce(public.rate_for((select place_id from public.room_sessions where id = new.session_id), new.mode_id), new.rate);
  return new;
end $$;
create trigger session_segments_rate before insert on public.session_segments for each row execute function public.segment_rate();

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

do $$
declare d text;
begin
  d := pg_get_functiondef('public.insert_order_items(uuid,jsonb,boolean)'::regprocedure);
  if position('insert into public.order_items (order_id,' in d) = 0 then raise exception 'patch insert_order_items failed'; end if;
  d := replace(d, 'insert into public.order_items (order_id,', 'insert into public.order_items (id, order_id,');
  d := replace(d, 'values (p_order, m.id,', 'values (coalesce((it->>''id'')::uuid, gen_random_uuid()), p_order, m.id,');
  execute d;

  d := pg_get_functiondef('public.customer_bill(text,text)'::regprocedure);
  if position('from public.order_items oi where oi.order_id = o.id' in d) = 0 then raise exception 'patch customer_bill failed'; end if;
  d := replace(d, 'from public.order_items oi where oi.order_id = o.id', 'from public.order_items oi where oi.order_id = o.id and oi.voided_at is null');
  execute d;

  d := pg_get_functiondef('public.staff_snapshot()'::regprocedure);
  if position('''staff'', case when' in d) = 0 then raise exception 'patch staff_snapshot failed'; end if;
  d := replace(d, '''staff'', case when', '''mode_prices'', coalesce((select jsonb_agg(to_jsonb(x)) from public.room_mode_prices x), ''[]''::jsonb),
    ''staff'', case when');
  execute d;

  d := pg_get_functiondef('public.public_catalog()'::regprocedure);
  if position('''schedule'',' in d) = 0 then raise exception 'patch public_catalog failed'; end if;
  d := replace(d, '''schedule'',', '''mode_prices'', coalesce((select jsonb_agg(to_jsonb(x)) from public.room_mode_prices x), ''[]''::jsonb),
    ''schedule'',');
  execute d;

  d := pg_get_functiondef('public.owner_report(date,date)'::regprocedure);
  if position('where o.status in (''accepted'',''served'') and b.status = ''closed''' in d) = 0 or position('''cancellations'', coalesce(' in d) = 0 then raise exception 'patch owner_report failed'; end if;
  d := replace(d, 'where o.status in (''accepted'',''served'') and b.status = ''closed''', 'where o.status in (''accepted'',''served'') and oi.voided_at is null and b.status = ''closed''');
  d := replace(d, '''cancellations'', coalesce(', '''voided_items'', coalesce((select jsonb_agg(jsonb_build_object(''name_ar'', oi.name_ar, ''name_en'', oi.name_en, ''qty'', oi.qty, ''amount'', oi.qty * oi.unit_price, ''reason'', oi.void_reason, ''by'', sp.name, ''at'', oi.voided_at) order by oi.voided_at desc)
      from public.order_items oi left join public.staff_profiles sp on sp.user_id = oi.voided_by
      where oi.voided_at is not null and public.business_day(oi.voided_at) between p_from and p_to), ''[]''::jsonb),
    ''cancellations'', coalesce(');
  execute d;

  d := pg_get_functiondef('public.staff_op(jsonb)'::regprocedure);
  if position('where id = v_bill.session_id and status = ''active'') then
      raise exception ''session_still_active'';' in d) = 0 then raise exception 'patch staff_op checkout failed'; end if;
  d := replace(d, 'where id = v_bill.session_id and status = ''active'') then
      raise exception ''session_still_active'';', 'where id = v_bill.session_id and status = ''active'' and booker_customer_id = v_bill.customer_id) then
      raise exception ''session_still_active'';');
  execute d;
end $$;

create or replace function public.staff_op2(op jsonb) returns jsonb
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
    return public.staff_op(op);
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
grant execute on function public.staff_op2(jsonb) to authenticated;

create table public.keepalive (id bigserial primary key, at timestamptz not null default now(), source text not null default 'cron');
alter table public.keepalive enable row level security;
create or replace function public.keepalive(p_source text default 'cron') returns jsonb
language plpgsql volatile security definer set search_path = public as $$
begin
  insert into public.keepalive (source) values (left(coalesce(p_source, 'cron'), 40));
  return jsonb_build_object('ok', true, 'rows', (select count(*) from public.keepalive), 'at', now());
end $$;
grant execute on function public.keepalive(text) to anon, authenticated;
