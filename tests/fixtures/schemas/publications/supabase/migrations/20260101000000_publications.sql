create table public.messages (
  id bigint generated always as identity primary key,
  body text not null
);

create table public.scores (
  id bigint generated always as identity primary key,
  points integer not null
);

create table public.orders (
  id bigint generated always as identity primary key,
  total numeric not null
);

alter publication supabase_realtime add table public.messages;

create publication orders_feed for table public.orders, public.scores;

alter publication orders_feed drop table public.scores;

create publication everything for all tables;

do $$
begin
  execute 'alter publication supabase_realtime add table public.scores';
end
$$;

alter publication supabase_realtime drop table public.messages;

drop table public.orders;
