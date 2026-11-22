-- Rebrand to "dots" and split domains: staff side (and the push endpoint) lives on
-- dotcowork.space without www; customers use dotswork.space. Only rows still on the old
-- defaults are touched, so a value the owner changed stays.
alter table public.app_secrets alter column push_url set default 'https://dotcowork.space/api/push';
update public.app_secrets set push_url = 'https://dotcowork.space/api/push'
  where push_url = 'https://www.dotcowork.space/api/push';

alter table public.settings alter column venue_name set default 'dots';
update public.settings set venue_name = 'dots' where venue_name = 'dot';
