-- Event announcements: customers opt in to "new events" notifications on /events; the owner
-- presses Announce on an event to push it to them. Only people who asked get it.
do $$
declare c text;
begin
  select conname into c from pg_constraint where conrelid = 'public.push_watches'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%kind%';
  execute format('alter table public.push_watches drop constraint %I', c);
end $$;
alter table public.push_watches add constraint push_watches_kind_check check (kind in ('order', 'booking', 'room', 'staff', 'events'));

alter table public.events add column announced_at timestamptz;

-- All event followers share one watch "ref".
create or replace function public.events_ref() returns uuid language sql immutable as $$ select '00000000-0000-0000-0000-00000000e7e7'::uuid $$;

create or replace function public.customer_events_watch(p_sub jsonb, p_lang text, p_on boolean) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare v_endpoint text;
begin
  v_endpoint := public.push_save_subscription(p_sub);
  if coalesce(p_on, true) then
    insert into public.push_watches (endpoint, kind, ref, lang, expires_at)
    values (v_endpoint, 'events', public.events_ref(), case when p_lang = 'en' then 'en' else 'ar' end, now() + interval '1 year')
    on conflict (endpoint, kind, ref) do update set expires_at = excluded.expires_at, lang = excluded.lang;
  else
    update public.push_watches set expires_at = now() where endpoint = v_endpoint and kind = 'events';
  end if;
  return jsonb_build_object('ok', true, 'on', coalesce(p_on, true));
end $$;
grant execute on function public.customer_events_watch(jsonb, text, boolean) to anon, authenticated;

create or replace function public.owner_event_audience() returns int
language sql stable security definer set search_path = public as $$
  select case when public.is_owner() then (
    select count(*)::int from public.push_watches w join public.push_subscriptions s on s.endpoint = w.endpoint
    where w.kind = 'events' and w.ref = public.events_ref() and w.expires_at > now() and not s.gone) else 0 end;
$$;
grant execute on function public.owner_event_audience() to authenticated;

create or replace function public.owner_announce_event(p_event uuid) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare e public.events; v jsonb; v_when text;
begin
  if not public.is_owner() then raise exception 'not_owner'; end if;
  select * into e from public.events where id = p_event for update;
  if not found or not e.active or coalesce(e.ends_at, e.starts_at + interval '3 hours') < now() then raise exception 'not_found'; end if;
  -- One announcement per event per 12 hours: nobody gets the same push twice by accident.
  if e.announced_at > now() - interval '12 hours' then raise exception 'already_announced'; end if;
  v_when := to_char(e.starts_at at time zone 'Africa/Cairo', 'DD/MM · HH24:MI');
  v := public.push_messages('events', public.events_ref(),
    array['إيفنت جديد في dot: ' || e.title_ar, 'New at dot: ' || e.title_en],
    array[v_when || case when e.price > 0 then ' · ' || rtrim(rtrim(e.price::text, '0'), '.') || ' ج.م' else ' · ببلاش' end || ' · احجز مكانك',
          v_when || case when e.price > 0 then ' · EGP ' || rtrim(rtrim(e.price::text, '0'), '.') else ' · Free' end || ' · Save your seat'],
    '/events#' || e.id, 'event-' || e.id);
  perform public.push_send(v);
  update public.events set announced_at = now() where id = e.id;
  perform public.audit('announce_event', 'events', e.id::text, jsonb_build_object('sent', jsonb_array_length(v)));
  return jsonb_build_object('ok', true, 'sent', jsonb_array_length(v));
end $$;
grant execute on function public.owner_announce_event(uuid) to authenticated;
