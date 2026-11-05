-- The counter reloads on live updates instead of every 30 s, so every table it shows must announce changes.
alter publication supabase_realtime add table public.order_items, public.session_segments, public.customers, public.cash_days, public.cash_outs, public.customer_bundles;
