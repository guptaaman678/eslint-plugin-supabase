create table public.todos (
  id bigint generated always as identity primary key,
  title text not null
);

alter table public.todos enable row level security;

create policy "todos are readable" on public.todos
  for select to anon, authenticated using (true);

create policy "todos are insertable" on public.todos
  for insert to anon, authenticated with check (true);

alter publication supabase_realtime add table public.todos;
