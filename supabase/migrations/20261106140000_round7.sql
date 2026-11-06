-- dot round 7. Additive only.
-- 1. Call staff: a guest who has checked out and paid can't call from that place any more;
--    a call is "answered" when the counter presses Done, "missed" when nobody did within 15 minutes.
-- 2. Events: guests cancel their own seat (phone + code); sign-up returns the new customer's code.
-- 3. Room fee check: the server recomputes every ended session and flags a mismatch to the owner.
-- 4. Open-ended room bookings: held for up to 12 hours from the start, ended by the counter.

-- ---------------------------------------------------------------------------
-- 1. Calls
-- ---------------------------------------------------------------------------
create or replace function public.customer_call_staff2(p_token text, p_reason text, p_phone text) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare v_place public.places; v_cid uuid; v_id uuid; pl text[]; b_ar text; b_en text;
begin
  if p_reason not in ('help', 'water', 'bill') then raise exception 'bad_request'; end if;
  select * into v_place from public.places where qr_token = coalesce(p_token, '') and active;
  if not found then raise exception 'bad_place'; end if;
  -- Checked out here and left: no more calls from this place.
  if coalesce(p_phone, '') <> '' then
    select id into v_cid from public.customers where phone = public.normalize_phone(p_phone);
    if v_cid is not null
       and not exists (select 1 from public.bills where customer_id = v_cid and status = 'open')
       and exists (select 1 from public.bills where customer_id = v_cid and status = 'closed' and place_id = v_place.id and closed_at > now() - interval '12 hours') then
      raise exception 'checked_out';
    end if;
  end if;
  select id into v_id from public.staff_calls where place_id = v_place.id and reason = p_reason and handled_at is null
    and created_at > now() - interval '15 minutes';
  if v_id is not null then return jsonb_build_object('ok', true, 'id', v_id, 'duplicate', true); end if;
  if (select count(*) from public.staff_calls where place_id = v_place.id and created_at > now() - interval '10 minutes') >= 6
     or (select count(*) from public.staff_calls where created_at > now() - interval '1 minute') >= 30 then
    raise exception 'too_many_attempts';
  end if;
  insert into public.staff_calls (place_id, reason) values (v_place.id, p_reason) returning id into v_id;
  pl := public.place_label(v_place.id);
  b_ar := case p_reason when 'water' then 'عايزين مية' when 'bill' then 'عايزين يحاسبوا' else 'محتاجين حد' end;
  b_en := case p_reason when 'water' then 'Would like water' when 'bill' then 'Ready to pay' else 'Needs a hand' end;
  perform public.push_send(public.staff_push_messages(array['نداء من ' || pl[1], 'Call from ' || pl[2]], array[b_ar, b_en], '/staff#board', 'call-' || v_place.id, false));
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;
grant execute on function public.customer_call_staff2(text, text, text) to anon, authenticated;

-- Attentiveness for the owner's report: every call in the range with who answered and how fast.
create or replace function public.owner_calls_report(p_from date, p_to date) returns jsonb
language sql stable security definer set search_path = public as $$
  select case when not public.is_owner() then '{}'::jsonb else jsonb_build_object(
    'total', count(*),
    'answered', count(*) filter (where k.handled_at is not null and k.handled_at <= k.created_at + interval '15 minutes'),
    'missed', count(*) filter (where k.handled_at is null or k.handled_at > k.created_at + interval '15 minutes'),
    'avg_seconds', coalesce(round(avg(extract(epoch from k.handled_at - k.created_at)) filter (where k.handled_at is not null and k.handled_at <= k.created_at + interval '15 minutes')), 0),
    'by_staff', coalesce((select jsonb_agg(jsonb_build_object('name', x.name, 'answered', x.n, 'avg_seconds', x.avg_s) order by x.n desc) from (
        select coalesce(sp.name, '—') as name, count(*) as n, round(avg(extract(epoch from c.handled_at - c.created_at))) as avg_s
        from public.staff_calls c left join public.staff_profiles sp on sp.user_id = c.handled_by
        where c.handled_at is not null and c.handled_at <= c.created_at + interval '15 minutes'
          and public.business_day(c.created_at) between p_from and p_to
        group by sp.name) x), '[]'::jsonb),
    'by_reason', coalesce((select jsonb_object_agg(reason, n) from (select reason, count(*) as n from public.staff_calls c
        where public.business_day(c.created_at) between p_from and p_to group by reason) y), '{}'::jsonb)
  ) end
  from public.staff_calls k where public.business_day(k.created_at) between p_from and p_to;
$$;
grant execute on function public.owner_calls_report(date, date) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Events
-- ---------------------------------------------------------------------------
create or replace function public.customer_event_signup(p_event uuid, p_phone text, p_name text, p_seats int, p_note text, p_offers boolean)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare e public.events; v_cust jsonb; v_cid uuid; v_taken int; v_prev int; v_new boolean;
begin
  if p_seats is null or p_seats < 1 or p_seats > 10 then raise exception 'bad_seats'; end if;
  select * into e from public.events where id = p_event and active for update;
  if not found or coalesce(e.ends_at, e.starts_at + interval '3 hours') < now() then raise exception 'not_found'; end if;
  if (select count(*) from public.event_signups where updated_at > now() - interval '1 minute') >= 30 then raise exception 'too_many_attempts'; end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'name_required'; end if;
  v_cust := public.find_or_create_customer(p_phone, null, p_name, true);
  v_cid := (v_cust->>'id')::uuid;
  select seats into v_prev from public.event_signups where event_id = e.id and customer_id = v_cid and status in ('going', 'attended');
  v_new := v_prev is null;
  if e.capacity is not null then
    v_taken := public.event_seats_taken(e.id) - coalesce(v_prev, 0);
    if v_taken + p_seats > e.capacity then raise exception 'event_full'; end if;
  end if;
  insert into public.event_signups (event_id, customer_id, seats, note, status)
  values (e.id, v_cid, p_seats, left(coalesce(p_note, ''), 300), 'going')
  on conflict (event_id, customer_id) do update set seats = excluded.seats, note = excluded.note, status = 'going', updated_at = now();
  if coalesce(p_offers, false) then
    update public.customers set offers_opt_in = true, offers_opt_in_at = now() where id = v_cid and not offers_opt_in;
  end if;
  if v_new then
    perform public.push_send(public.staff_push_messages(array['تسجيل في ' || e.title_ar, 'Sign-up: ' || e.title_en],
      array[coalesce(nullif(v_cust->>'name', ''), 'ضيف') || ' · ' || p_seats, coalesce(nullif(v_cust->>'name', ''), 'Guest') || ' · ' || p_seats],
      '/staff#events', 'event-' || e.id, true));
  end if;
  return jsonb_build_object('ok', true, 'updated', not v_new, 'customer_code', v_cust->>'code',
    'seats_left', case when e.capacity is null then null else greatest(0, e.capacity - public.event_seats_taken(e.id)) end);
end $$;

create or replace function public.customer_event_cancel(p_event uuid, p_phone text, p_code text) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare v_key text := 'bill:' || public.normalize_phone(p_phone); c public.customers; e public.events;
begin
  if not public.throttle_check(v_key) then raise exception 'too_many_attempts'; end if;
  select * into c from public.customers where phone = public.normalize_phone(p_phone) and code = trim(coalesce(p_code, ''));
  if not found then
    insert into public.lookup_attempts (key, ok) values (v_key, false);
    raise exception 'customer_not_found';
  end if;
  select * into e from public.events where id = p_event;
  if not found then raise exception 'not_found'; end if;
  update public.event_signups set status = 'cancelled', updated_at = now() where event_id = p_event and customer_id = c.id and status = 'going';
  if not found then raise exception 'not_found'; end if;
  perform public.push_send(public.staff_push_messages(array['إلغاء تسجيل: ' || e.title_ar, 'Cancelled: ' || e.title_en],
    array[coalesce(nullif(c.name, ''), c.phone), coalesce(nullif(c.name, ''), c.phone)], '/staff#events', 'event-' || e.id, true));
  return jsonb_build_object('ok', true, 'seats_left', case when e.capacity is null then null else greatest(0, e.capacity - public.event_seats_taken(e.id)) end);
end $$;
grant execute on function public.customer_event_cancel(uuid, text, text) to anon, authenticated;

-- The guest's visit page lists their upcoming event seats (so they can cancel there too).
create or replace function public.customer_bill4(p_phone text, p_code text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r jsonb; c public.customers;
begin
  r := public.customer_bill3(p_phone, p_code);
  if r ? 'error' then return r; end if;
  select * into c from public.customers where phone = public.normalize_phone(p_phone) and code = trim(coalesce(p_code, ''));
  return r || jsonb_build_object('events', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'title_ar', e.title_ar, 'title_en', e.title_en,
      'starts_at', e.starts_at, 'seats', s.seats) order by e.starts_at)
    from public.event_signups s join public.events e on e.id = s.event_id
    where s.customer_id = c.id and s.status = 'going' and coalesce(e.ends_at, e.starts_at + interval '3 hours') > now()), '[]'::jsonb));
end $$;
grant execute on function public.customer_bill4(text, text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Room fee check (mirrors src/lib/billing.ts computeRoomFee, minute by minute)
-- ---------------------------------------------------------------------------
create or replace function public.happy_pct(p_kind text, p_mode uuid, p_at timestamptz) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(max(h.percent_off), 0) from public.happy_hours h
  cross join lateral (values ((p_at at time zone 'Africa/Cairo')::date), ((p_at at time zone 'Africa/Cairo')::date - 1)) d(day)
  where h.active and (h.applies_to = 'all' or h.applies_to = p_kind) and (h.mode_id is null or h.mode_id = p_mode)
    and extract(dow from d.day)::int = any(h.days)
    and p_at >= ((d.day + h.start_time) at time zone 'Africa/Cairo')
    and p_at < ((d.day + case when h.end_time <= h.start_time then 1 else 0 end + h.end_time) at time zone 'Africa/Cairo');
$$;

create or replace function public.room_fee_expected(p_session uuid) returns numeric
language plpgsql stable security definer set search_path = public as $$
declare s public.room_sessions; st public.settings; v_kind text; v_end timestamptz; v_eff timestamptz;
  g record; v_next timestamptz; v_send timestamptz; t timestamptz; v_slice numeric; v_mins numeric := 0; v_amount numeric := 0;
  v_billed numeric; v_extra numeric; v_last_rate numeric; v_last_mode uuid; v_n int := 0; v_pct numeric; v_step int;
begin
  select * into s from public.room_sessions where id = p_session;
  if not found or s.ended_at is null then return null; end if;
  select * into st from public.settings where id = 1;
  select kind into v_kind from public.places where id = s.place_id;
  v_end := s.ended_at;
  v_eff := v_end;
  if s.kind = 'fixed' and s.planned_end is not null then
    if extract(epoch from (v_end - s.planned_end)) / 60 > st.grace_minutes and coalesce(s.overstay_charged, true) then v_eff := v_end;
    else v_eff := least(v_end, s.planned_end); end if;
  end if;
  for g in select * from public.session_segments where session_id = s.id order by started_at loop
    select min(started_at) into v_next from public.session_segments where session_id = s.id and started_at > g.started_at;
    v_send := least(coalesce(g.ended_at, 'infinity'), coalesce(v_next, 'infinity'), v_eff);
    t := g.started_at;
    while t < v_send loop
      v_slice := extract(epoch from (least(t + interval '1 minute', v_send) - t)) / 60;
      v_mins := v_mins + v_slice;
      v_amount := v_amount + v_slice * g.rate / 60 * (1 - public.happy_pct(v_kind, g.mode_id, t) / 100);
      t := t + interval '1 minute';
    end loop;
    v_last_rate := g.rate; v_last_mode := g.mode_id; v_n := v_n + 1;
  end loop;
  if v_n = 0 then return 0; end if;
  v_step := greatest(1, st.billing_step_minutes);
  v_billed := case when v_mins <= 0 then 0 else ceil(round(v_mins, 3) / v_step - 1e-9) * v_step end;
  v_billed := greatest(st.min_session_minutes, v_billed);
  v_extra := greatest(0, v_billed - v_mins);
  v_pct := case when v_extra > 0 then public.happy_pct(v_kind, v_last_mode, greatest(s.started_at, v_eff - interval '1 millisecond')) else 0 end;
  return round(v_amount + v_extra * v_last_rate / 60 * (1 - v_pct / 100), 2);
end $$;
revoke execute on function public.happy_pct(text, uuid, timestamptz) from public, anon, authenticated;
revoke execute on function public.room_fee_expected(uuid) from public, anon, authenticated;

create table public.fee_checks (
  session_id uuid primary key references public.room_sessions(id) on delete cascade,
  charged numeric(10,2) not null,      -- room fee + any hour-bundle credit (before the bundle)
  expected numeric(10,2) not null,
  diff numeric(10,2) not null,
  by uuid,
  at timestamptz not null default now()
);
alter table public.fee_checks enable row level security;
create policy owner_read on public.fee_checks for select to authenticated using (public.is_owner());

-- ---------------------------------------------------------------------------
-- 4. Open-ended bookings
-- ---------------------------------------------------------------------------
alter table public.bookings add column open_ended boolean not null default false;

create or replace function public.customer_book2(p_phone text, p_name text, p_place_id uuid, p_mode_id uuid, p_starts_at timestamptz, p_duration int, p_open boolean, p_group_size int, p_note text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare r jsonb;
begin
  -- An open-ended booking holds the room for up to 12 hours from the start; the counter ends it.
  r := public.customer_book(p_phone, p_name, p_place_id, p_mode_id, p_starts_at, case when coalesce(p_open, false) then 720 else p_duration end, p_group_size, p_note);
  if coalesce(p_open, false) then update public.bookings set open_ended = true where id = (r->>'booking_id')::uuid; end if;
  return r;
end $$;
grant execute on function public.customer_book2(text, text, uuid, uuid, timestamptz, int, boolean, int, text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Counter ops wrapper: fee check after end_session, open-ended flag after booking_create.
-- ---------------------------------------------------------------------------
create or replace function public.staff_op5(op jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public, extensions as $$
declare
  v_res jsonb; p jsonb := coalesce(op->'payload', '{}'::jsonb); v_type text := op->>'type';
  s public.room_sessions; v_exp numeric; v_charged numeric; v_diff numeric; pl text[];
begin
  v_res := public.staff_op4(op);
  if coalesce((v_res->>'duplicate')::boolean, false) then return v_res; end if;
  if v_type = 'booking_create' and coalesce((p->>'open_ended')::boolean, false) then
    update public.bookings set open_ended = true where id = (p->>'id')::uuid;
  elsif v_type = 'end_session' then
    select * into s from public.room_sessions where id = (p->>'session_id')::uuid;
    v_exp := public.room_fee_expected(s.id);
    v_charged := round(coalesce(s.room_fee, 0) + coalesce((p->'bundle'->>'amount')::numeric, 0), 2);
    if v_exp is not null then
      v_diff := v_charged - v_exp;
      insert into public.fee_checks (session_id, charged, expected, diff, by) values (s.id, v_charged, v_exp, v_diff, auth.uid())
      on conflict (session_id) do update set charged = excluded.charged, expected = excluded.expected, diff = excluded.diff, at = now();
      -- Small gaps are rounding and seconds; a real gap tells the owner.
      if abs(v_diff) > greatest(5, v_exp * 0.03) then
        pl := public.place_label(s.place_id);
        perform public.audit('fee_mismatch', 'room_sessions', s.id::text, jsonb_build_object('charged', v_charged, 'expected', v_exp));
        perform public.push_send(public.staff_push_messages(array['فرق في حساب ' || pl[1], 'Room fee check: ' || pl[2]],
          array['اتحسب ' || v_charged || ' والمفروض ' || v_exp, 'Charged ' || v_charged || ', expected ' || v_exp], '/staff#reports', 'fee-' || s.id, true));
      end if;
    end if;
  end if;
  return v_res;
end $$;
grant execute on function public.staff_op5(jsonb) to authenticated;

create or replace function public.owner_fee_checks(p_from date, p_to date) returns jsonb
language sql stable security definer set search_path = public as $$
  select case when not public.is_owner() then '[]'::jsonb else coalesce(jsonb_agg(jsonb_build_object(
      'session_id', f.session_id, 'charged', f.charged, 'expected', f.expected, 'diff', f.diff, 'at', f.at,
      'place_ar', p.name_ar, 'place_en', p.name_en, 'by', sp.name) order by f.at desc), '[]'::jsonb) end
  from public.fee_checks f join public.room_sessions s on s.id = f.session_id join public.places p on p.id = s.place_id
  left join public.staff_profiles sp on sp.user_id = f.by
  where abs(f.diff) > greatest(5, f.expected * 0.03) and public.business_day(f.at) between p_from and p_to;
$$;
grant execute on function public.owner_fee_checks(date, date) to authenticated;

-- The old entry point skipped the checked-out rule.
revoke execute on function public.customer_call_staff(text, text) from public, anon, authenticated;
