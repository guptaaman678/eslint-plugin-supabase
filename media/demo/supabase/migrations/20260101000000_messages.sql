create table public.messages (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid(),
  body text not null
);

alter table public.messages enable row level security;

create policy "members read messages" on public.messages
  for select to authenticated using (true);

create policy "members send messages" on public.messages
  for insert to authenticated with check (auth.uid() = user_id);
