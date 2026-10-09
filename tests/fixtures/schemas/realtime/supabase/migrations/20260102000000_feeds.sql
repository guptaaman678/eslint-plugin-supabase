alter publication supabase_realtime drop table public.orders;

create publication orders_feed for table public.orders;

create publication app_feed for tables in schema app;
