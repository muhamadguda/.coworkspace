-- dot round 4: Google review link and loyalty rewards (a free hour every N visits).
-- Additive only. Rewards reuse hour bundles, so they come off the room fee like a bought bundle.

alter table public.settings
  add column google_review_url text not null default '' check (google_review_url = '' or google_review_url ~ '^https://'),
  add column loyalty_every int not null default 0 check (loyalty_every between 0 and 100),          -- 0 = off
  add column loyalty_reward_minutes int not null default 60 check (loyalty_reward_minutes between 0 and 1440);

alter table public.customer_bundles
  add column source text not null default 'purchase' check (source in ('purchase', 'loyalty')),
  add column reward_visit int;
create unique index customer_bundles_loyalty_once on public.customer_bundles (customer_id, reward_visit) where source = 'loyalty';

-- A visit = a business day with at least one closed bill.
create or replace function public.customer_visits(p_customer uuid) returns int
language sql stable security definer set search_path = public as $$
  select count(distinct business_day)::int from public.bills
  where customer_id = p_customer and status = 'closed' and business_day is not null;
$$;

create or replace function public.trg_loyalty() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_every int; v_min int; v_visits int;
begin
  if new.status <> 'closed' or old.status = 'closed' then return new; end if;
  select loyalty_every, loyalty_reward_minutes into v_every, v_min from public.settings where id = 1;
  if coalesce(v_every, 0) <= 0 or coalesce(v_min, 0) <= 0 then return new; end if;
  v_visits := public.customer_visits(new.customer_id);
  if v_visits > 0 and v_visits % v_every = 0 then
    insert into public.customer_bundles (id, customer_id, plan_id, name_ar, name_en, mode_id, minutes_total, price, order_item_id, expires_at, source, reward_visit)
    values (gen_random_uuid(), new.customer_id, null, 'مكافأة الزيارات', 'Loyalty reward', null, v_min, 0, null, now() + interval '60 days', 'loyalty', v_visits)
    on conflict do nothing;
  end if;
  return new;
end $$;
create trigger loyalty_reward after update of status on public.bills
  for each row execute function public.trg_loyalty();

-- Customer bill page: adds hour-bundle balances and loyalty progress.
create or replace function public.customer_bill2(p_phone text, p_code text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r jsonb; c public.customers; st public.settings;
begin
  r := public.customer_bill(p_phone, p_code);
  if r ? 'error' then return r; end if;
  select * into c from public.customers where phone = public.normalize_phone(p_phone) and code = trim(coalesce(p_code, ''));
  select * into st from public.settings where id = 1;
  return r || jsonb_build_object(
    'bundles', coalesce((select jsonb_agg(jsonb_build_object('name_ar', b.name_ar, 'name_en', b.name_en, 'minutes_left', b.minutes_total - b.minutes_used,
        'expires_at', b.expires_at, 'mode_id', b.mode_id, 'source', b.source) order by b.expires_at)
      from public.customer_bundles b
      where b.customer_id = c.id and b.voided_at is null and b.expires_at > now() and b.minutes_total - b.minutes_used > 0.5), '[]'::jsonb),
    'loyalty', jsonb_build_object('visits', public.customer_visits(c.id), 'every', st.loyalty_every, 'reward_minutes', st.loyalty_reward_minutes),
    'review_url', st.google_review_url
  );
end $$;

create or replace function public.public_catalog2() returns jsonb
language sql stable security definer set search_path = public as $$
  select public.public_catalog() || jsonb_build_object(
    'bundle_plans', coalesce((select jsonb_agg(jsonb_build_object('id', b.id, 'name_ar', b.name_ar, 'name_en', b.name_en, 'hours', b.hours,
        'price', b.price, 'valid_days', b.valid_days, 'mode_id', b.mode_id) order by b.sort, b.hours)
      from public.bundle_plans b where b.active), '[]'::jsonb),
    'review_url', (select google_review_url from public.settings where id = 1),
    'loyalty', (select jsonb_build_object('every', loyalty_every, 'reward_minutes', loyalty_reward_minutes) from public.settings where id = 1));
$$;

-- Staff snapshot: visit counts per customer (for the loyalty badge).
create or replace function public.staff_snapshot2() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  return public.staff_snapshot() || jsonb_build_object(
    'bundle_plans', coalesce((select jsonb_agg(to_jsonb(b) order by b.sort, b.hours) from public.bundle_plans b), '[]'::jsonb),
    'customer_bundles', coalesce((select jsonb_agg(to_jsonb(c) order by c.created_at) from public.customer_bundles c
        where c.voided_at is null and (c.expires_at > now() - interval '14 days' or c.created_at > now() - interval '14 days')), '[]'::jsonb),
    'bundle_uses', coalesce((select jsonb_agg(to_jsonb(u) order by u.at) from public.bundle_uses u where u.at > now() - interval '35 days'), '[]'::jsonb),
    'stock_moves', coalesce((select jsonb_agg(to_jsonb(m) order by m.at desc) from (select * from public.stock_moves order by at desc limit 150) m), '[]'::jsonb),
    'visits', coalesce((select jsonb_object_agg(customer_id, n) from (
        select customer_id, count(distinct business_day)::int as n from public.bills
        where status = 'closed' and business_day is not null group by customer_id) v), '{}'::jsonb)
  );
end $$;

grant execute on function public.customer_bill2(text, text) to anon, authenticated;
