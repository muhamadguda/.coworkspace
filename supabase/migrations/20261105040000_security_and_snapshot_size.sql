-- dot round 5.
-- 1. Security: internal push helpers were callable by anyone through the API. push_send could
--    send any text and link to staff phones signed with dot's key; push_messages and
--    staff_push_messages returned subscription keys. Only the database's own triggers call these
--    (as security definer, so they keep working after the revoke).
-- 2. Size: the counter's snapshot sent every customer ever. Now only the ones the counter can
--    need: recent, owing, booked, or holding prepaid time. Older regulars are still matched by
--    phone when added again (ensure_customer finds them).

revoke execute on function public.push_send(jsonb) from public, anon, authenticated;
revoke execute on function public.push_messages(text, uuid, text[], text[], text, text) from public, anon, authenticated;
revoke execute on function public.staff_push_messages(text[], text[], text, text, boolean) from public, anon, authenticated;
revoke execute on function public.expire_watches(text, uuid) from public, anon, authenticated;
revoke execute on function public.customer_visits(uuid) from public, anon, authenticated;
revoke execute on function public.stock_apply(uuid, numeric, text, text, text) from public, anon, authenticated;
revoke execute on function public.bundle_void_for_item(uuid) from public, anon, authenticated;
revoke execute on function public.trg_bundle_item() from public, anon, authenticated;
revoke execute on function public.trg_bundle_order() from public, anon, authenticated;
revoke execute on function public.trg_item_stock() from public, anon, authenticated;
revoke execute on function public.trg_order_stock() from public, anon, authenticated;
revoke execute on function public.trg_loyalty() from public, anon, authenticated;
revoke execute on function public.notify_booking_change() from public, anon, authenticated;
revoke execute on function public.notify_order_change() from public, anon, authenticated;
revoke execute on function public.notify_room_free() from public, anon, authenticated;

create or replace function public.snapshot_customer_ids() returns setof uuid
language sql stable security definer set search_path = public as $$
  select c.id from public.customers c
  where c.created_at > now() - interval '120 days'
     or exists (select 1 from public.bills b where b.customer_id = c.id and (b.status = 'open' or b.opened_at > now() - interval '120 days'))
     or exists (select 1 from public.bookings k where k.customer_id = c.id and k.starts_at > now() - interval '1 day' and k.status in ('pending', 'confirmed'))
     or exists (select 1 from public.customer_bundles u where u.customer_id = c.id and u.voided_at is null and u.expires_at > now() and u.minutes_total > u.minutes_used)
     or public.customer_outstanding(c.id) > 0;
$$;
revoke execute on function public.snapshot_customer_ids() from public, anon, authenticated;

create or replace function public.staff_snapshot2() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  return public.staff_snapshot() || jsonb_build_object(
    'customers', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'phone', c.phone, 'name', c.name, 'code', c.code,
        'debt_limit', c.debt_limit, 'outstanding', public.customer_outstanding(c.id), 'created_at', c.created_at))
      from public.customers c where c.id in (select public.snapshot_customer_ids())), '[]'::jsonb),
    'bundle_plans', coalesce((select jsonb_agg(to_jsonb(b) order by b.sort, b.hours) from public.bundle_plans b), '[]'::jsonb),
    'customer_bundles', coalesce((select jsonb_agg(to_jsonb(c) order by c.created_at) from public.customer_bundles c
        where c.voided_at is null and (c.expires_at > now() - interval '14 days' or c.created_at > now() - interval '14 days')), '[]'::jsonb),
    'bundle_uses', coalesce((select jsonb_agg(to_jsonb(u) order by u.at) from public.bundle_uses u where u.at > now() - interval '35 days'), '[]'::jsonb),
    'stock_moves', coalesce((select jsonb_agg(to_jsonb(m) order by m.at desc) from (select * from public.stock_moves order by at desc limit 150) m), '[]'::jsonb),
    'visits', coalesce((select jsonb_object_agg(customer_id, n) from (
        select customer_id, count(distinct business_day)::int as n from public.bills
        where status = 'closed' and business_day is not null and customer_id in (select public.snapshot_customer_ids())
        group by customer_id) v), '{}'::jsonb)
  );
end $$;
