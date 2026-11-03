-- dot: staff operations, owner RPCs, privileges.

-- ---------------------------------------------------------------------------
-- staff_op: one idempotent operation from the counter's queue
-- op = { id: uuid, type: text, at: timestamptz, payload: {...}, override?: {phone, password} }
-- ---------------------------------------------------------------------------
create or replace function public.staff_op(op jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public, extensions as $$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_id uuid := (op->>'id')::uuid;
  v_type text := op->>'type';
  p jsonb := coalesce(op->'payload', '{}'::jsonb);
  v_at timestamptz := least(coalesce((op->>'at')::timestamptz, now()), now() + interval '2 minutes');
  v_owner_ok boolean := false;
  v_result jsonb := '{}'::jsonb;
  v_cust jsonb; v_cid uuid; v_bill public.bills; v_sess public.room_sessions; v_ord public.orders; v_place public.places;
  v_set public.settings; v_bid uuid; v_sid uuid; v_mode public.room_modes; v_day date;
  v_items numeric; v_sub numeric; v_disc numeric; v_total numeric; v_paid numeric; v_pay_later numeric; v_pct numeric;
  v_outstanding numeric; v_limit numeric; v_remaining numeric; v_take numeric; v_share jsonb; v_sum numeric; r record;
begin
  select role into v_role from public.staff_profiles where user_id = v_uid and active;
  if v_role is null then raise exception 'not_staff'; end if;
  if v_id is null or v_type is null then raise exception 'bad_op'; end if;

  insert into public.applied_ops (op_id, type, actor) values (v_id, v_type, v_uid) on conflict (op_id) do nothing;
  if not found then return jsonb_build_object('ok', true, 'duplicate', true); end if;

  if op ? 'override' and op->'override' is not null and op->'override' <> 'null'::jsonb then
    v_owner_ok := public.verify_owner_credentials(public.normalize_phone(op->'override'->>'phone'), op->'override'->>'password') is not null;
    if not v_owner_ok then raise exception 'bad_owner_credentials'; end if;
  end if;
  if v_role = 'owner' then v_owner_ok := true; end if;
  select * into v_set from public.settings where id = 1;

  case v_type

  when 'open_day' then
    v_day := public.business_day(v_at);
    insert into public.cash_days (business_day, opening_float, opened_at, opened_by)
    values (v_day, public.money((p->>'opening_float')::numeric), v_at, v_uid)
    on conflict (business_day) do nothing;
    v_result := jsonb_build_object('business_day', v_day);

  when 'cash_out' then
    insert into public.cash_outs (id, business_day, amount, reason, created_at, created_by)
    values ((p->>'id')::uuid, public.business_day(v_at), public.money((p->>'amount')::numeric), left(trim(p->>'reason'), 200), v_at, v_uid);
    perform public.audit('cash_out', 'cash_outs', p->>'id', p);

  when 'close_day' then
    v_day := (p->>'business_day')::date;
    if not exists (select 1 from public.cash_days where business_day = v_day) then raise exception 'day_not_open'; end if;
    select public.money(d.opening_float
        + coalesce((select sum(amount) from public.payments where business_day = v_day and method = 'cash'), 0)
        - coalesce((select sum(amount) from public.cash_outs where business_day = v_day), 0))
      into v_total from public.cash_days d where d.business_day = v_day;
    update public.cash_days set closing_counted = public.money((p->>'counted')::numeric), expected_cash = v_total,
      closed_at = v_at, closed_by = v_uid, note = left(coalesce(p->>'note', ''), 300)
    where business_day = v_day;
    perform public.audit('close_day', 'cash_days', v_day::text, p || jsonb_build_object('expected', v_total));
    v_result := jsonb_build_object('expected', v_total);

  when 'ensure_customer' then
    v_cid := (p->>'id')::uuid;
    select * into r from public.customers where phone = public.normalize_phone(p->>'phone');
    if found then
      if r.id <> v_cid then insert into public.customer_aliases (alias_id, customer_id) values (v_cid, r.id) on conflict do nothing; end if;
      if r.name = '' and coalesce(trim(p->>'name'), '') <> '' then update public.customers set name = left(trim(p->>'name'), 80) where id = r.id; end if;
      v_result := jsonb_build_object('id', r.id, 'code', r.code);
    else
      insert into public.customers (id, phone, name, code)
      values (v_cid, public.normalize_phone(p->>'phone'), left(coalesce(trim(p->>'name'), ''), 80), public.gen_customer_code())
      returning jsonb_build_object('id', id, 'code', code) into v_result;
    end if;

  when 'rename_customer' then
    update public.customers set name = left(coalesce(trim(p->>'name'), ''), 80) where id = public.resolve_customer((p->>'customer_id')::uuid);

  when 'open_bill' then
    v_cid := public.resolve_customer((p->>'customer_id')::uuid);
    if exists (select 1 from public.bills where customer_id = v_cid and status = 'open') then raise exception 'customer_has_open_bill'; end if;
    v_sid := (p->>'session_id')::uuid;
    if v_sid is not null and not exists (select 1 from public.room_sessions where id = v_sid and status = 'active') then raise exception 'session_not_active'; end if;
    insert into public.bills (id, customer_id, place_id, session_id, status, opened_at, opened_by)
    values ((p->>'id')::uuid, v_cid, (p->>'place_id')::uuid, v_sid, 'open', v_at, v_uid);

  when 'start_session' then
    v_cid := public.resolve_customer((p->>'customer_id')::uuid);
    select * into v_place from public.places where id = (p->>'place_id')::uuid and kind = 'room';
    if not found then raise exception 'bad_place'; end if;
    if exists (select 1 from public.room_sessions where place_id = v_place.id and status = 'active') then raise exception 'room_busy'; end if;
    select * into v_mode from public.room_modes where id = (p->>'mode_id')::uuid;
    if not found then raise exception 'bad_mode'; end if;
    v_sid := (p->>'id')::uuid;
    insert into public.room_sessions (id, place_id, booker_customer_id, booking_id, kind, planned_end, group_size, status, started_at, started_by)
    values (v_sid, v_place.id, v_cid, (p->>'booking_id')::uuid, p->>'kind', (p->>'planned_end')::timestamptz,
      nullif(p->>'group_size', '')::int, 'active', v_at, v_uid);
    insert into public.session_segments (id, session_id, mode_id, rate, started_at)
    values ((p->>'segment_id')::uuid, v_sid, v_mode.id, v_mode.hourly_rate, v_at);
    select * into v_bill from public.bills where customer_id = v_cid and status = 'open';
    if found then
      update public.bills set place_id = v_place.id, session_id = v_sid where id = v_bill.id;
    else
      insert into public.bills (id, customer_id, place_id, session_id, status, opened_at, opened_by)
      values ((p->>'bill_id')::uuid, v_cid, v_place.id, v_sid, 'open', v_at, v_uid);
    end if;
    if p->>'booking_id' is not null then
      update public.bookings set status = 'started', session_id = v_sid where id = (p->>'booking_id')::uuid;
    end if;

  when 'change_mode' then
    select * into v_sess from public.room_sessions where id = (p->>'session_id')::uuid and status = 'active';
    if not found then raise exception 'session_not_active'; end if;
    select * into v_mode from public.room_modes where id = (p->>'mode_id')::uuid;
    if not found then raise exception 'bad_mode'; end if;
    update public.session_segments set ended_at = v_at where session_id = v_sess.id and ended_at is null;
    insert into public.session_segments (id, session_id, mode_id, rate, started_at)
    values ((p->>'segment_id')::uuid, v_sess.id, v_mode.id, v_mode.hourly_rate, v_at);

  when 'update_session' then
    select * into v_sess from public.room_sessions where id = (p->>'session_id')::uuid and status = 'active';
    if not found then raise exception 'session_not_active'; end if;
    update public.room_sessions set
      kind = coalesce(p->>'kind', kind),
      planned_end = case when p->>'kind' = 'open' then null when p ? 'planned_end' then (p->>'planned_end')::timestamptz else planned_end end,
      group_size = case when p ? 'group_size' then nullif(p->>'group_size', '')::int else group_size end
    where id = v_sess.id;

  when 'ack_session_alert' then
    update public.room_sessions set alert_ack_for = (p->>'planned_end')::timestamptz where id = (p->>'session_id')::uuid;

  when 'add_member' then
    select * into v_sess from public.room_sessions where id = (p->>'session_id')::uuid and status = 'active';
    if not found then raise exception 'session_not_active'; end if;
    v_cid := public.resolve_customer((p->>'customer_id')::uuid);
    select * into v_bill from public.bills where customer_id = v_cid and status = 'open';
    if found then
      update public.bills set place_id = v_sess.place_id, session_id = v_sess.id where id = v_bill.id;
    else
      insert into public.bills (id, customer_id, place_id, session_id, status, opened_at, opened_by)
      values ((p->>'bill_id')::uuid, v_cid, v_sess.place_id, v_sess.id, 'open', v_at, v_uid);
    end if;

  when 'end_session' then
    select * into v_sess from public.room_sessions where id = (p->>'session_id')::uuid and status = 'active' for update;
    if not found then raise exception 'session_not_active'; end if;
    v_total := public.money((p->>'room_fee')::numeric);
    select coalesce(sum(public.money((x->>'amount')::numeric)), 0) into v_sum from jsonb_array_elements(coalesce(p->'shares', '[]'::jsonb)) x;
    if abs(v_sum - v_total) > 0.009 then raise exception 'shares_mismatch'; end if;
    update public.session_segments set ended_at = v_at where session_id = v_sess.id and ended_at is null;
    update public.room_sessions set status = 'ended', ended_at = v_at, ended_by = v_uid,
      billed_minutes = (p->>'billed_minutes')::int, room_fee = v_total,
      overstay_charged = coalesce((p->>'overstay_charged')::boolean, false), split_mode = coalesce(p->>'split_mode', 'booker')
    where id = v_sess.id;
    for v_share in select * from jsonb_array_elements(coalesce(p->'shares', '[]'::jsonb)) loop
      update public.bills set room_fee_share = public.money((v_share->>'amount')::numeric)
      where id = (v_share->>'bill_id')::uuid and session_id = v_sess.id and status = 'open';
      if not found then raise exception 'bad_share_bill'; end if;
    end loop;
    perform public.audit('end_session', 'room_sessions', v_sess.id::text, p);

  when 'staff_order' then
    select * into v_bill from public.bills where id = (p->>'bill_id')::uuid and status = 'open';
    if not found then raise exception 'bill_not_open'; end if;
    insert into public.orders (id, customer_id, place_id, bill_id, source, status, note, created_at, accepted_at, accepted_by)
    values ((p->>'order_id')::uuid, v_bill.customer_id, v_bill.place_id, v_bill.id, 'staff', 'accepted', left(coalesce(p->>'note', ''), 300), v_at, v_at, v_uid);
    perform public.insert_order_items((p->>'order_id')::uuid, p->'items', true);

  when 'accept_order' then
    select * into v_ord from public.orders where id = (p->>'order_id')::uuid for update;
    if not found then raise exception 'order_not_found'; end if;
    if v_ord.status <> 'new' then raise exception 'order_not_new'; end if;
    select * into v_bill from public.bills where customer_id = v_ord.customer_id and status = 'open';
    if not found then
      v_sid := null;
      if v_ord.place_id is not null then
        select id into v_sid from public.room_sessions where place_id = v_ord.place_id and status = 'active';
      end if;
      insert into public.bills (id, customer_id, place_id, session_id, status, opened_at, opened_by)
      values (coalesce((p->>'bill_id')::uuid, gen_random_uuid()), v_ord.customer_id, v_ord.place_id, v_sid, 'open', v_at, v_uid)
      returning * into v_bill;
    end if;
    update public.orders set status = 'accepted', bill_id = v_bill.id, accepted_at = v_at, accepted_by = v_uid where id = v_ord.id;
    v_result := jsonb_build_object('bill_id', v_bill.id);

  when 'reject_order' then
    update public.orders set status = 'rejected', cancel_reason = left(coalesce(p->>'reason', ''), 200), cancelled_by = v_uid
    where id = (p->>'order_id')::uuid and status = 'new';
    if not found then raise exception 'order_not_new'; end if;

  when 'serve_order' then
    update public.orders set status = 'served', served_at = v_at where id = (p->>'order_id')::uuid and status = 'accepted';

  when 'cancel_order' then
    select * into v_ord from public.orders where id = (p->>'order_id')::uuid;
    if not found or v_ord.status not in ('accepted','served') then raise exception 'order_not_cancellable'; end if;
    if exists (select 1 from public.bills where id = v_ord.bill_id and status = 'closed') then raise exception 'bill_closed'; end if;
    if coalesce(trim(p->>'reason'), '') = '' then raise exception 'reason_required'; end if;
    update public.orders set status = 'cancelled', cancel_reason = left(trim(p->>'reason'), 200), cancelled_by = v_uid where id = v_ord.id;
    perform public.audit('cancel_order', 'orders', v_ord.id::text, p);

  when 'move_bill' then
    select * into v_bill from public.bills where id = (p->>'bill_id')::uuid and status = 'open' for update;
    if not found then raise exception 'bill_not_open'; end if;
    if v_bill.session_id is not null and exists (select 1 from public.room_sessions where id = v_bill.session_id and status = 'active')
       and exists (select 1 from public.room_sessions where id = v_bill.session_id and booker_customer_id = v_bill.customer_id) then
      raise exception 'booker_cannot_leave_active_session';
    end if;
    v_sid := null;
    if p->>'place_id' is not null then
      select id into v_sid from public.room_sessions where place_id = (p->>'place_id')::uuid and status = 'active';
    end if;
    update public.bills set place_id = (p->>'place_id')::uuid, session_id = v_sid where id = v_bill.id;
    perform public.audit('move_bill', 'bills', v_bill.id::text, p);

  when 'checkout' then
    select * into v_bill from public.bills where id = (p->>'bill_id')::uuid for update;
    if not found or v_bill.status <> 'open' then raise exception 'bill_not_open'; end if;
    if v_bill.session_id is not null and exists (select 1 from public.room_sessions where id = v_bill.session_id and status = 'active') then
      raise exception 'session_still_active';
    end if;
    if exists (select 1 from public.orders where bill_id = v_bill.id and status = 'new') then raise exception 'pending_orders'; end if;
    v_items := public.bill_items_total(v_bill.id);
    v_sub := public.money(v_items + v_bill.room_fee_share);
    v_disc := 0; v_pct := 0;
    if p->>'discount_kind' = 'amount' then
      v_disc := least(public.money((p->>'discount_value')::numeric), v_sub);
    elsif p->>'discount_kind' = 'percent' then
      if (p->>'discount_value')::numeric > 100 or (p->>'discount_value')::numeric < 0 then raise exception 'bad_discount'; end if;
      v_disc := public.money(v_sub * (p->>'discount_value')::numeric / 100);
    end if;
    if v_disc < 0 then raise exception 'bad_discount'; end if;
    if v_disc > 0 then
      if coalesce(trim(p->>'discount_reason'), '') = '' then raise exception 'reason_required'; end if;
      v_pct := case when v_sub > 0 then v_disc * 100 / v_sub else 0 end;
      if not v_owner_ok and (v_disc > v_set.staff_discount_max_amount or v_pct > v_set.staff_discount_max_percent + 0.001) then
        raise exception 'discount_over_cap';
      end if;
    end if;
    v_total := public.money(v_sub - v_disc);
    v_pay_later := public.money(coalesce((p->>'pay_later')::numeric, 0));
    if v_pay_later < 0 then raise exception 'bad_pay_later'; end if;
    select coalesce(sum(public.money((x->>'amount')::numeric)), 0) into v_paid from jsonb_array_elements(coalesce(p->'payments', '[]'::jsonb)) x;
    if abs(v_paid + v_pay_later - v_total) > 0.009 then
      raise exception 'payment_mismatch:%', jsonb_build_object('total', v_total, 'paid', v_paid, 'pay_later', v_pay_later)::text;
    end if;
    if v_pay_later > 0 then
      select public.customer_outstanding(c.id), c.debt_limit into v_outstanding, v_limit from public.customers c where c.id = v_bill.customer_id;
      if not v_owner_ok and v_outstanding + v_pay_later > v_limit + 0.009 then raise exception 'debt_limit'; end if;
    end if;
    v_day := public.business_day(v_at);
    insert into public.payments (id, bill_id, method, amount, kind, paid_at, business_day, created_by)
    select (x->>'id')::uuid, v_bill.id, x->>'method', public.money((x->>'amount')::numeric), 'bill', v_at, v_day, v_uid
    from jsonb_array_elements(coalesce(p->'payments', '[]'::jsonb)) x where public.money((x->>'amount')::numeric) > 0;
    update public.bills set status = 'closed', closed_at = v_at, closed_by = v_uid, business_day = v_day,
      items_total = v_items, subtotal = v_sub,
      discount_kind = case when v_disc > 0 then p->>'discount_kind' end,
      discount_value = case when v_disc > 0 then (p->>'discount_value')::numeric end,
      discount_amount = v_disc, discount_reason = case when v_disc > 0 then left(trim(p->>'discount_reason'), 200) end,
      discount_by = case when v_disc > 0 then v_uid end,
      total = v_total, pay_later = v_pay_later
    where id = v_bill.id;
    if v_disc > 0 or v_pay_later > 0 or op ? 'override' then
      perform public.audit('checkout', 'bills', v_bill.id::text, jsonb_build_object('discount', v_disc, 'pay_later', v_pay_later, 'override', op ? 'override'));
    end if;
    v_result := jsonb_build_object('total', v_total, 'subtotal', v_sub, 'discount', v_disc, 'items_total', v_items);

  when 'pay_debt' then
    v_cid := public.resolve_customer((p->>'customer_id')::uuid);
    v_remaining := public.money((p->>'amount')::numeric);
    if v_remaining <= 0 then raise exception 'bad_amount'; end if;
    if v_remaining > public.customer_outstanding(v_cid) + 0.009 then raise exception 'more_than_owed'; end if;
    v_day := public.business_day(v_at);
    for r in select b.id, public.bill_due(b.id) as due from public.bills b
             where b.customer_id = v_cid and b.status = 'closed' and public.bill_due(b.id) > 0 order by b.closed_at loop
      exit when v_remaining <= 0;
      v_take := least(r.due, v_remaining);
      insert into public.payments (id, bill_id, method, amount, kind, paid_at, business_day, created_by)
      values (gen_random_uuid(), r.id, p->>'method', v_take, 'debt', v_at, v_day, v_uid);
      v_remaining := public.money(v_remaining - v_take);
    end loop;
    perform public.audit('pay_debt', 'customers', v_cid::text, p);

  when 'booking_decide' then
    if p->>'status' not in ('confirmed','rejected','cancelled','no_show') then raise exception 'bad_status'; end if;
    select * into r from public.bookings where id = (p->>'booking_id')::uuid for update;
    if not found then raise exception 'booking_not_found'; end if;
    if p->>'status' = 'confirmed' and public.booking_overlaps(r.place_id, r.starts_at, r.duration_minutes, r.id) then raise exception 'slot_taken'; end if;
    update public.bookings set status = p->>'status', decided_by = v_uid, decided_at = v_at where id = r.id;

  when 'booking_create' then
    v_cid := public.resolve_customer((p->>'customer_id')::uuid);
    if public.booking_overlaps((p->>'place_id')::uuid, (p->>'starts_at')::timestamptz, (p->>'duration_minutes')::int, null) then raise exception 'slot_taken'; end if;
    insert into public.bookings (id, customer_id, place_id, mode_id, starts_at, duration_minutes, group_size, note, status, source, decided_by, decided_at)
    values ((p->>'id')::uuid, v_cid, (p->>'place_id')::uuid, (p->>'mode_id')::uuid, (p->>'starts_at')::timestamptz,
      (p->>'duration_minutes')::int, nullif(p->>'group_size', '')::int, left(coalesce(p->>'note', ''), 300), 'confirmed', 'staff', v_uid, v_at);

  when 'set_item_available' then
    update public.menu_items set available = (p->>'available')::boolean where id = (p->>'menu_item_id')::uuid;

  else
    raise exception 'unknown_op:%', v_type;
  end case;

  return jsonb_build_object('ok', true) || v_result;
end $$;

-- ---------------------------------------------------------------------------
-- Owner RPCs
-- ---------------------------------------------------------------------------
create or replace function public.owner_create_staff(p_phone text, p_name text, p_password text, p_role text) returns jsonb
language plpgsql volatile security definer set search_path = public, extensions as $$
declare v_uid uuid; v_phone text := public.normalize_phone(p_phone);
begin
  if not public.is_owner() then raise exception 'not_owner'; end if;
  if v_phone !~ '^[0-9]{8,15}$' then raise exception 'bad_phone'; end if;
  if p_role not in ('owner','staff') then raise exception 'bad_role'; end if;
  if exists (select 1 from public.staff_profiles where phone = v_phone) then raise exception 'phone_taken'; end if;
  v_uid := public.create_auth_user(v_phone, p_password);
  insert into public.staff_profiles (user_id, phone, name, role) values (v_uid, v_phone, coalesce(nullif(trim(p_name), ''), v_phone), p_role);
  perform public.audit('create_staff', 'staff_profiles', v_uid::text, jsonb_build_object('phone', v_phone, 'role', p_role));
  return jsonb_build_object('user_id', v_uid);
end $$;

create or replace function public.owner_update_staff(p_user_id uuid, p_name text, p_role text, p_active boolean) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
begin
  if not public.is_owner() then raise exception 'not_owner'; end if;
  if p_user_id = auth.uid() and (p_active = false or p_role <> 'owner') then raise exception 'cannot_demote_self'; end if;
  update public.staff_profiles set name = coalesce(nullif(trim(p_name), ''), name), role = coalesce(p_role, role), active = coalesce(p_active, active)
  where user_id = p_user_id;
  perform public.audit('update_staff', 'staff_profiles', p_user_id::text, jsonb_build_object('role', p_role, 'active', p_active));
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.owner_reset_password(p_user_id uuid, p_password text) returns jsonb
language plpgsql volatile security definer set search_path = public, extensions as $$
begin
  if not public.is_owner() then raise exception 'not_owner'; end if;
  if length(coalesce(p_password, '')) < 6 then raise exception 'password_too_short'; end if;
  update auth.users set encrypted_password = extensions.crypt(p_password, extensions.gen_salt('bf')), updated_at = now() where id = p_user_id;
  perform public.audit('reset_password', 'staff_profiles', p_user_id::text, '{}'::jsonb);
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.change_own_password(p_old text, p_new text) returns jsonb
language plpgsql volatile security definer set search_path = public, extensions as $$
begin
  if not public.is_staff() then raise exception 'not_staff'; end if;
  if length(coalesce(p_new, '')) < 6 then raise exception 'password_too_short'; end if;
  if not exists (select 1 from auth.users where id = auth.uid() and encrypted_password = extensions.crypt(p_old, encrypted_password)) then
    raise exception 'bad_password';
  end if;
  update auth.users set encrypted_password = extensions.crypt(p_new, extensions.gen_salt('bf')), updated_at = now() where id = auth.uid();
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.owner_set_debt_limit(p_customer uuid, p_limit numeric) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
begin
  if not public.is_owner() then raise exception 'not_owner'; end if;
  if p_limit < 0 then raise exception 'bad_amount'; end if;
  update public.customers set debt_limit = public.money(p_limit) where id = p_customer;
  perform public.audit('set_debt_limit', 'customers', p_customer::text, jsonb_build_object('limit', p_limit));
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.owner_regenerate_qr(p_place uuid) returns jsonb
language plpgsql volatile security definer set search_path = public, extensions as $$
declare v text;
begin
  if not public.is_owner() then raise exception 'not_owner'; end if;
  update public.places set qr_token = encode(extensions.gen_random_bytes(6), 'hex') where id = p_place returning qr_token into v;
  return jsonb_build_object('qr_token', v);
end $$;

create or replace function public.owner_report(p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_owner() then raise exception 'not_owner'; end if;
  return jsonb_build_object(
    'from', p_from, 'to', p_to,
    'payments_by_method', coalesce((select jsonb_object_agg(method, amt) from (
        select method, sum(amount) amt from public.payments where business_day between p_from and p_to group by method) x), '{}'::jsonb),
    'debt_collected', coalesce((select sum(amount) from public.payments where business_day between p_from and p_to and kind = 'debt'), 0),
    'bills', (select jsonb_build_object('count', count(*), 'items_total', coalesce(sum(items_total), 0), 'room_fees', coalesce(sum(room_fee_share), 0),
        'subtotal', coalesce(sum(subtotal), 0), 'discounts', coalesce(sum(discount_amount), 0), 'total', coalesce(sum(total), 0),
        'pay_later', coalesce(sum(pay_later), 0))
      from public.bills where status = 'closed' and business_day between p_from and p_to),
    'by_day', coalesce((select jsonb_agg(jsonb_build_object('day', d, 'total', t, 'bills', n) order by d) from (
        select business_day d, sum(total) t, count(*) n from public.bills where status = 'closed' and business_day between p_from and p_to group by business_day) x), '[]'::jsonb),
    'room_usage', coalesce((select jsonb_agg(jsonb_build_object('place_id', place_id, 'name_ar', name_ar, 'name_en', name_en, 'mode_ar', mode_ar, 'mode_en', mode_en, 'minutes', minutes, 'sessions', sessions) order by name_en, mode_en) from (
        select s.place_id, p.name_ar, p.name_en, m.name_ar mode_ar, m.name_en mode_en,
          round(sum(extract(epoch from (coalesce(g.ended_at, now()) - g.started_at)) / 60)) minutes, count(distinct s.id) sessions
        from public.session_segments g join public.room_sessions s on s.id = g.session_id
        join public.places p on p.id = s.place_id join public.room_modes m on m.id = g.mode_id
        where public.business_day(s.started_at) between p_from and p_to
        group by s.place_id, p.name_ar, p.name_en, m.name_ar, m.name_en) x), '[]'::jsonb),
    'room_fees_by_room', coalesce((select jsonb_agg(jsonb_build_object('name_ar', p.name_ar, 'name_en', p.name_en, 'fee', fee, 'sessions', n) order by fee desc) from (
        select place_id, sum(room_fee) fee, count(*) n from public.room_sessions where status = 'ended' and public.business_day(ended_at) between p_from and p_to group by place_id) x
        join public.places p on p.id = x.place_id), '[]'::jsonb),
    'top_items', coalesce((select jsonb_agg(jsonb_build_object('name_ar', name_ar, 'name_en', name_en, 'qty', qty, 'revenue', revenue) order by qty desc) from (
        select oi.name_ar, oi.name_en, sum(oi.qty) qty, sum(oi.qty * oi.unit_price) revenue
        from public.order_items oi join public.orders o on o.id = oi.order_id join public.bills b on b.id = o.bill_id
        where o.status in ('accepted','served') and b.status = 'closed' and b.business_day between p_from and p_to
        group by oi.name_ar, oi.name_en order by sum(oi.qty) desc limit 20) x), '[]'::jsonb),
    'discounts', coalesce((select jsonb_agg(jsonb_build_object('bill_id', b.id, 'day', b.business_day, 'amount', b.discount_amount, 'reason', b.discount_reason,
        'customer', c.name, 'phone', c.phone, 'by', sp.name) order by b.closed_at desc)
      from public.bills b join public.customers c on c.id = b.customer_id left join public.staff_profiles sp on sp.user_id = b.discount_by
      where b.status = 'closed' and b.discount_amount > 0 and b.business_day between p_from and p_to), '[]'::jsonb),
    'debts', coalesce((select jsonb_agg(jsonb_build_object('customer_id', id, 'name', name, 'phone', phone, 'outstanding', o, 'debt_limit', debt_limit) order by o desc) from (
        select c.id, c.name, c.phone, c.debt_limit, public.customer_outstanding(c.id) o from public.customers c) x where o > 0), '[]'::jsonb),
    'cash_days', coalesce((select jsonb_agg(to_jsonb(d) order by d.business_day desc) from public.cash_days d where d.business_day between p_from and p_to), '[]'::jsonb),
    'cash_outs', coalesce((select jsonb_agg(jsonb_build_object('day', x.business_day, 'amount', x.amount, 'reason', x.reason, 'by', sp.name, 'at', x.created_at) order by x.created_at desc)
      from public.cash_outs x left join public.staff_profiles sp on sp.user_id = x.created_by where x.business_day between p_from and p_to), '[]'::jsonb),
    'cancellations', coalesce((select jsonb_agg(jsonb_build_object('order_id', o.id, 'reason', o.cancel_reason, 'status', o.status, 'by', sp.name, 'at', o.created_at,
        'amount', (select sum(qty * unit_price) from public.order_items where order_id = o.id)) order by o.created_at desc)
      from public.orders o left join public.staff_profiles sp on sp.user_id = o.cancelled_by
      where o.status = 'cancelled' and public.business_day(o.created_at) between p_from and p_to), '[]'::jsonb)
  );
end $$;

-- ---------------------------------------------------------------------------
-- Privileges: lock everything down, then grant the public surface
-- ---------------------------------------------------------------------------
revoke execute on all functions in schema public from public, anon, authenticated;

grant execute on function public.is_staff() to anon, authenticated;
grant execute on function public.is_owner() to anon, authenticated;
grant execute on function public.public_catalog() to anon, authenticated;
grant execute on function public.place_by_token(text) to anon, authenticated;
grant execute on function public.customer_place_order(uuid, text, text, text, text, jsonb, text) to anon, authenticated;
grant execute on function public.customer_order_status(uuid[]) to anon, authenticated;
grant execute on function public.customer_bill(text, text) to anon, authenticated;
grant execute on function public.customer_book(text, text, uuid, uuid, timestamptz, int, int, text) to anon, authenticated;
grant execute on function public.customer_cancel_booking(text, text, uuid) to anon, authenticated;
grant execute on function public.claim_owner(text, text, text, text) to anon, authenticated;
grant execute on function public.setup_status() to anon, authenticated;
grant execute on function public.staff_snapshot() to authenticated;
grant execute on function public.staff_op(jsonb) to authenticated;
grant execute on function public.change_own_password(text, text) to authenticated;
grant execute on function public.owner_create_staff(text, text, text, text) to authenticated;
grant execute on function public.owner_update_staff(uuid, text, text, boolean) to authenticated;
grant execute on function public.owner_reset_password(uuid, text) to authenticated;
grant execute on function public.owner_set_debt_limit(uuid, numeric) to authenticated;
grant execute on function public.owner_regenerate_qr(uuid) to authenticated;
grant execute on function public.owner_report(date, date) to authenticated;

alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
