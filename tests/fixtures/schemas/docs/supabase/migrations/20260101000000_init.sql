-- The schema the rule docs' examples are linted against (tests/rules/docs-examples.test.ts).
create table public.todos (
  id bigint generated always as identity primary key,
  title text not null
);

create table public.messages (
  id bigint generated always as identity primary key,
  body text not null
);

alter publication supabase_realtime add table public.messages;

-- Row level security on, no policy.
create table public.orders (
  id bigint generated always as identity primary key,
  total numeric not null
);

alter table public.orders enable row level security;

-- Row level security on, with select and update policies for authenticated.
create table public.scores (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  points integer not null
);

alter table public.scores enable row level security;

create policy "owners read" on public.scores
  for select to authenticated
  using (auth.uid() = user_id);

create policy "owners update" on public.scores
  for update to authenticated
  using (auth.uid() = user_id);
