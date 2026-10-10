create table public.todos (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid(),
  title text not null,
  done boolean not null default false
);

alter table public.todos enable row level security;

create policy "owners read todos" on public.todos
  for select to authenticated using (auth.uid() = user_id);

create policy "owners add todos" on public.todos
  for insert to authenticated with check (auth.uid() = user_id);

create table public.orders (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  total numeric not null
);

alter table public.orders enable row level security;

create policy "owners add orders" on public.orders
  for insert to authenticated with check (auth.uid() = user_id);

create table public.messages (
  id bigint generated always as identity primary key,
  body text not null
);

alter publication supabase_realtime add table public.messages;
