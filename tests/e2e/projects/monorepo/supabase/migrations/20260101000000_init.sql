create table public.orders (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  status text not null default 'new'
);

alter table public.orders enable row level security;

create policy "owners read orders" on public.orders
  for select to authenticated using (auth.uid() = user_id);

create policy "owners cancel orders" on public.orders
  for delete to authenticated using (auth.uid() = user_id);

create table public.audit_log (
  id bigint generated always as identity primary key,
  action text not null
);

alter table public.audit_log enable row level security;

create schema private;

create table private.jobs (
  id bigint generated always as identity primary key,
  kind text not null
);
