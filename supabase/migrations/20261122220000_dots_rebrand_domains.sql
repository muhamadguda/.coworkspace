-- Rebrand to "dots". push_url stays on https://www.dotcowork.space/api/push: Vercel serves
-- the www host and the apex 308-redirects, which a pg_net POST would not follow.
alter table public.settings alter column venue_name set default 'dots';
update public.settings set venue_name = 'dots' where venue_name = 'dot';
