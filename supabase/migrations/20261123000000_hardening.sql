-- Hardening (additive; safe while the old app is still live).
-- 1. Superseded function versions: nobody signed out may call them any more. The app calls
--    customer_bill4, customer_book2, customer_place_order2, public_catalog2 and staff_op5;
--    those wrap the old versions internally, which still works (they run as the owner).
--    staff_op..staff_op4 keep their signed-in grant so a counter with queued ops from an
--    older page can still drain them.
do $$
declare f text;
begin
  foreach f in array array[
    'public.customer_bill(text, text)',
    'public.customer_bill2(text, text)',
    'public.customer_bill3(text, text)',
    'public.public_catalog()',
    'public.customer_book(text, text, uuid, uuid, timestamptz, integer, integer, text)',
    'public.customer_place_order(uuid, text, text, text, text, jsonb, text)',
    'public.staff_op2(jsonb)', 'public.staff_op3(jsonb)', 'public.staff_op4(jsonb)'
  ] loop
    if to_regprocedure(f) is not null then
      execute format('revoke execute on function %s from public, anon', f);
    end if;
  end loop;
end $$;

-- Old customer bill/catalog versions: signed-in staff don't need them either.
do $$
declare f text;
begin
  foreach f in array array['public.customer_bill(text, text)', 'public.customer_bill2(text, text)', 'public.customer_bill3(text, text)', 'public.public_catalog()'] loop
    if to_regprocedure(f) is not null then
      execute format('revoke execute on function %s from authenticated', f);
    end if;
  end loop;
end $$;

-- 2. Fixed search_path (advisor: function_search_path_mutable).
alter function public.events_ref() set search_path = public;

-- 3. Indexes for the busiest foreign keys (reports, bills, customer history).
create index if not exists orders_customer_id_idx on public.orders (customer_id);
create index if not exists orders_place_id_idx on public.orders (place_id);
create index if not exists order_items_menu_item_id_idx on public.order_items (menu_item_id);
create index if not exists bills_place_id_idx on public.bills (place_id);
create index if not exists bookings_customer_id_idx on public.bookings (customer_id);
create index if not exists room_sessions_booking_id_idx on public.room_sessions (booking_id);
create index if not exists room_sessions_booker_customer_id_idx on public.room_sessions (booker_customer_id);
create index if not exists event_signups_customer_id_idx on public.event_signups (customer_id);
create index if not exists staff_calls_place_id_idx on public.staff_calls (place_id);
create index if not exists customer_aliases_customer_id_idx on public.customer_aliases (customer_id);
