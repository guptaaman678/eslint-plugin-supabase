create table public.todos (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  title text not null
);

alter table public.todos enable row level security;

create policy "owners read" on public.todos
  for select to authenticated
  using (auth.uid() = user_id);

create policy "owners write" on public.todos
  for insert to authenticated
  with check (auth.uid() = user_id);

create policy "anyone reads nothing" on public.todos
  for select to anon
  using (false);

create policy "service manages" on public.todos
  for all to public
  using (auth.role() = 'service_role');

create policy "no deletes" on public.todos
  as restrictive
  for delete to authenticated
  using (false);

alter policy "owners read" on public.todos to authenticated, anon;
