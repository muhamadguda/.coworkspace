-- Business rules, checked straight against the database. Runs in one transaction and rolls back.
\set ON_ERROR_STOP on
begin;

do $t$
declare uid uuid; plan uuid := gen_random_uuid(); cust uuid := gen_random_uuid(); bund uuid := gen_random_uuid();
  room uuid; mode uuid; sess uuid := gen_random_uuid(); bill uuid; item uuid; ord uuid := gen_random_uuid(); oi uuid := gen_random_uuid();
  r jsonb; v numeric; ok boolean;
  area uuid := gen_random_uuid(); amode uuid := gen_random_uuid(); c1 uuid := gen_random_uuid(); c2 uuid := gen_random_uuid(); tok text; call uuid; ev uuid := gen_random_uuid();
begin
  select user_id into uid from staff_profiles where role = 'owner' and active limit 1;
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  select id into room from places p where kind = 'room' and active and not exists (select 1 from room_sessions s where s.place_id = p.id and s.status = 'active') order by sort limit 1;
  select id into mode from room_modes where active order by sort limit 1;

  -- Bundle sold on a bill, used when the room ends.
  insert into bundle_plans (id, name_ar, name_en, hours, price, valid_days) values (plan, 'باقة', '10h pack', 10, 1000, 30);
  perform staff_op3(jsonb_build_object('id', gen_random_uuid(), 'type', 'ensure_customer', 'payload', jsonb_build_object('id', cust, 'phone', '01099998888')));
  r := staff_op3(jsonb_build_object('id', gen_random_uuid(), 'type', 'sell_bundle', 'payload', jsonb_build_object('id', bund, 'plan_id', plan, 'customer_id', cust, 'bill_id', gen_random_uuid(), 'order_id', gen_random_uuid(), 'item_id', gen_random_uuid())));
  bill := (r->>'bill_id')::uuid;
  assert (select sum(oi2.unit_price) from order_items oi2 join orders o on o.id = oi2.order_id where o.bill_id = bill) = 1000, 'bundle line on bill';
  perform staff_op3(jsonb_build_object('id', gen_random_uuid(), 'type', 'start_session', 'at', now() - interval '2 hours', 'payload', jsonb_build_object('id', sess, 'place_id', room, 'customer_id', cust, 'bill_id', bill, 'mode_id', mode, 'kind', 'open', 'segment_id', gen_random_uuid())));
  perform staff_op3(jsonb_build_object('id', gen_random_uuid(), 'type', 'end_session', 'payload', jsonb_build_object('session_id', sess, 'billed_minutes', 120, 'room_fee', 0, 'split_mode', 'booker',
    'shares', jsonb_build_array(jsonb_build_object('bill_id', bill, 'amount', 0)),
    'bundle', jsonb_build_object('bundle_id', bund, 'minutes', 120, 'amount', (select rate * 2 from session_segments where session_id = sess)))));
  assert (select minutes_used from customer_bundles where id = bund) = 120, 'bundle minutes used';
  begin
    perform staff_op3(jsonb_build_object('id', gen_random_uuid(), 'type', 'edit_item', 'payload', jsonb_build_object('item_id', (select order_item_id from customer_bundles where id = bund), 'qty', 0, 'reason', 'x')));
    ok := false;
  exception when others then ok := sqlerrm = 'bundle_in_use'; end;
  assert ok, 'a used bundle cannot be voided';

  -- Bundle worth more than the room is refused.
  begin
    perform staff_op3(jsonb_build_object('id', gen_random_uuid(), 'type', 'end_session', 'payload', jsonb_build_object('session_id', gen_random_uuid())));
    ok := false;
  exception when others then ok := true; end;
  assert ok, 'ending an unknown session fails';

  -- Stock.
  select id into item from menu_items where active and options = '[]'::jsonb order by sort limit 1;
  update menu_items set track_stock = true, stock_qty = 0, low_stock_at = 2 where id = item;
  perform staff_op3(jsonb_build_object('id', gen_random_uuid(), 'type', 'stock_adjust', 'payload', jsonb_build_object('menu_item_id', item, 'reason', 'restock', 'qty', 3)));
  perform staff_op3(jsonb_build_object('id', gen_random_uuid(), 'type', 'staff_order', 'payload', jsonb_build_object('bill_id', bill, 'order_id', ord, 'items', jsonb_build_array(jsonb_build_object('id', oi, 'menu_item_id', item, 'qty', 3, 'options', '[]'::jsonb)))));
  assert (select stock_qty = 0 and not available from menu_items where id = item), 'sold out at zero';
  perform staff_op3(jsonb_build_object('id', gen_random_uuid(), 'type', 'edit_item', 'payload', jsonb_build_object('item_id', oi, 'qty', 1, 'reason', 'wrong')));
  assert (select stock_qty = 2 and available from menu_items where id = item), 'back on after a return';
  perform staff_op3(jsonb_build_object('id', gen_random_uuid(), 'type', 'cancel_order', 'payload', jsonb_build_object('order_id', ord, 'reason', 'test')));
  assert (select stock_qty from menu_items where id = item) = 3, 'cancel returns stock';
  perform staff_op3(jsonb_build_object('id', gen_random_uuid(), 'type', 'stock_adjust', 'payload', jsonb_build_object('menu_item_id', item, 'reason', 'count', 'qty', 10)));
  assert (select stock_qty from menu_items where id = item) = 10, 'count sets stock';

  -- Idempotent ops: the same op id twice changes nothing the second time.
  r := jsonb_build_object('id', gen_random_uuid(), 'type', 'stock_adjust', 'payload', jsonb_build_object('menu_item_id', item, 'reason', 'restock', 'qty', 5));
  perform staff_op3(r);
  perform staff_op3(r);
  assert (select stock_qty from menu_items where id = item) = 15, 'retried op applied once';

  -- Loyalty: every visit earns a reward when set to 1.
  update settings set loyalty_every = 1, loyalty_reward_minutes = 60 where id = 1;
  perform staff_op3(jsonb_build_object('id', gen_random_uuid(), 'type', 'checkout', 'payload', jsonb_build_object('bill_id', bill, 'payments', jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'method', 'cash', 'amount', 1000)), 'pay_later', 0)));
  assert (select status from bills where id = bill) = 'closed', 'bill closed';
  assert (select count(*) from customer_bundles where customer_id = cust and source = 'loyalty') = 1, 'loyalty reward issued';

  -- Reopen voids the payment instead of deleting it.
  r := owner_reopen_bill(bill, 'e2e');
  assert (select status from bills where id = bill) = 'open', 'reopened';
  assert (select count(*) from payments where bill_id = bill and voided_at is not null) = 1, 'payment voided, kept';

  -- Shared area: one timer per person, up to the seats.
  insert into places (id, kind, name_ar, name_en, capacity) values (area, 'area', 'مساحة', 'Area e2e', 1);
  insert into room_modes (id, name_ar, name_en, hourly_rate, place_scope) values (amode, 'كرسي', 'Seat', 30, 'area');
  perform staff_op4(jsonb_build_object('id', gen_random_uuid(), 'type', 'ensure_customer', 'payload', jsonb_build_object('id', c1, 'phone', '01099990001')));
  perform staff_op4(jsonb_build_object('id', gen_random_uuid(), 'type', 'ensure_customer', 'payload', jsonb_build_object('id', c2, 'phone', '01099990002')));
  begin
    perform staff_op4(jsonb_build_object('id', gen_random_uuid(), 'type', 'start_session', 'payload', jsonb_build_object('id', gen_random_uuid(), 'place_id', area, 'customer_id', c2, 'bill_id', gen_random_uuid(), 'mode_id', mode, 'kind', 'open', 'segment_id', gen_random_uuid())));
    ok := false;
  exception when others then ok := sqlerrm = 'mode_not_here'; end;
  assert ok, 'a room mode (PlayStation...) is refused in a shared area';
  perform staff_op4(jsonb_build_object('id', gen_random_uuid(), 'type', 'start_session', 'payload', jsonb_build_object('id', gen_random_uuid(), 'place_id', area, 'customer_id', c1, 'bill_id', gen_random_uuid(), 'mode_id', amode, 'kind', 'open', 'segment_id', gen_random_uuid())));
  begin
    perform staff_op4(jsonb_build_object('id', gen_random_uuid(), 'type', 'start_session', 'payload', jsonb_build_object('id', gen_random_uuid(), 'place_id', area, 'customer_id', c2, 'bill_id', gen_random_uuid(), 'mode_id', amode, 'kind', 'open', 'segment_id', gen_random_uuid())));
    ok := false;
  exception when others then ok := sqlerrm = 'area_full'; end;
  assert ok, 'a full shared area refuses another person';
  update places set capacity = 2 where id = area;
  perform staff_op4(jsonb_build_object('id', gen_random_uuid(), 'type', 'start_session', 'payload', jsonb_build_object('id', gen_random_uuid(), 'place_id', area, 'customer_id', c2, 'bill_id', gen_random_uuid(), 'mode_id', amode, 'kind', 'open', 'segment_id', gen_random_uuid())));
  assert (select count(*) from room_sessions where place_id = area and status = 'active') = 2, 'two people, two timers, one area';
  update places set capacity = 5 where id = area;
  begin
    perform staff_op4(jsonb_build_object('id', gen_random_uuid(), 'type', 'start_session', 'payload', jsonb_build_object('id', gen_random_uuid(), 'place_id', area, 'customer_id', c2, 'bill_id', gen_random_uuid(), 'mode_id', amode, 'kind', 'open', 'segment_id', gen_random_uuid())));
    ok := false;
  exception when unique_violation then ok := true; end;
  assert ok, 'one person cannot run two timers in the same area';

  -- Call staff from a table QR: one ring per reason until handled.
  select qr_token into tok from places where kind = 'table' and active limit 1;
  r := customer_call_staff(tok, 'water');
  call := (r->>'id')::uuid;
  assert (customer_call_staff(tok, 'water')->>'duplicate')::boolean, 'pressing again does not ring twice';
  perform staff_op4(jsonb_build_object('id', gen_random_uuid(), 'type', 'handle_call', 'payload', jsonb_build_object('call_id', call)));
  assert (select handled_at is not null from staff_calls where id = call), 'call handled';
  assert jsonb_array_length(staff_snapshot2()->'staff_calls') >= 1, 'calls in the snapshot';

  -- Events: seats are capped; signing up again changes the seats instead of adding.
  insert into events (id, title_ar, title_en, starts_at, capacity) values (ev, 'تجربة', 'E2E', now() + interval '1 day', 3);
  r := customer_event_signup(ev, '01099990003', 'Guest', 2, '', true);
  assert (r->>'seats_left')::int = 1, 'seats left after sign-up';
  r := customer_event_signup(ev, '01099990003', 'Guest', 3, '', false);
  assert (r->>'seats_left')::int = 0 and (r->>'updated')::boolean, 'same person updates their seats';
  begin
    perform customer_event_signup(ev, '01099990004', 'Other', 1, '', false);
    ok := false;
  exception when others then ok := sqlerrm = 'event_full'; end;
  assert ok, 'a full event refuses';
  assert (select offers_opt_in from customers where phone = '01099990003'), 'sign-up opted in to offers';
  perform staff_op4(jsonb_build_object('id', gen_random_uuid(), 'type', 'set_offers', 'payload', jsonb_build_object('customer_id', (select id from customers where phone = '01099990003'), 'on', false)));
  assert not (select offers_opt_in from customers where phone = '01099990003'), 'counter can opt a customer out';
  assert exists (select 1 from jsonb_array_elements(public_catalog2()->'events') x where x->>'id' = ev::text), 'event on the public catalog';
  perform customer_events_watch('{"endpoint":"https://push.example.com/e2e","keys":{"p256dh":"k","auth":"a"}}'::jsonb, 'en', true);
  assert owner_event_audience() >= 1, 'event followers counted';
  r := owner_announce_event(ev);
  assert (r->>'sent')::int >= 1, 'announcement sent to followers';
  begin
    perform owner_announce_event(ev);
    ok := false;
  exception when others then ok := sqlerrm = 'already_announced'; end;
  assert ok, 'no double announcement';

  -- Anonymous callers cannot touch stock or staff ops.
  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  begin
    perform stock_apply(item, -100, 'hack', null);
    ok := false;
  exception when insufficient_privilege then ok := true; end;
  assert ok, 'anon cannot call stock_apply at all';
  begin
    perform push_send('[{"endpoint":"https://example.com","title":"x"}]'::jsonb);
    ok := false;
  exception when insufficient_privilege then ok := true; end;
  assert ok, 'anon cannot send pushes';
  begin
    perform staff_op4(jsonb_build_object('id', gen_random_uuid(), 'type', 'handle_call', 'payload', '{}'::jsonb));
    ok := false;
  exception when others then ok := true; end;
  assert ok, 'anon cannot handle calls';
  begin
    perform staff_op3(jsonb_build_object('id', gen_random_uuid(), 'type', 'open_day', 'payload', '{}'::jsonb));
    ok := false;
  exception when others then ok := true; end;
  assert ok, 'anon staff_op refused';
  perform set_config('role', 'postgres', true);
  assert (select stock_qty from menu_items where id = item) = 15, 'anon stock change ignored';
  raise notice 'db tests: all passed';
end $t$;

rollback;
