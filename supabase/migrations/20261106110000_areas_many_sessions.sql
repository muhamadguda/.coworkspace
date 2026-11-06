-- Shared areas hold many people's timers at once. The "one active session per place" index
-- still guards rooms; sessions in a shared area are marked and exempt, and one person can't
-- have two timers running in the same area.
alter table public.room_sessions add column shared boolean not null default false;

create or replace function public.trg_session_shared() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.shared := coalesce((select kind = 'area' from public.places where id = new.place_id), false);
  return new;
end $$;
revoke execute on function public.trg_session_shared() from public, anon, authenticated;
create trigger session_shared before insert on public.room_sessions
  for each row execute function public.trg_session_shared();

drop index public.room_sessions_one_active;
create unique index room_sessions_one_active on public.room_sessions (place_id) where status = 'active' and not shared;
create unique index room_sessions_one_person_per_area on public.room_sessions (place_id, booker_customer_id) where status = 'active' and shared;
