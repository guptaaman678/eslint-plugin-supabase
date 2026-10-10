create table public.scores (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid(),
  points integer not null default 0
);

alter table public.scores enable row level security;

create policy "anyone reads scores" on public.scores
  for select using (true);

create policy "players add scores" on public.scores
  for insert to authenticated with check (auth.uid() = user_id);

alter publication supabase_realtime add table public.scores;
