-- No `enable row level security` here: the `ensure_rls` trigger turns it on.
create table public.todos (
  id bigint generated always as identity primary key,
  title text not null
);

create table public.messages (
  id bigint generated always as identity primary key,
  body text not null
);

create policy "everyone reads" on public.messages
  for select to anon, authenticated
  using (true);

-- An explicit `disable` wins over the trigger.
create table public.scores (
  id bigint generated always as identity primary key,
  points integer not null
);

alter table public.scores disable row level security;
