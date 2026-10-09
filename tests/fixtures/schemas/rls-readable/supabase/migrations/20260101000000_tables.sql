-- The schema of tests/rules/rls-readable.test.ts (rule `rls-readable`, ADR-007).
create schema app;

-- RLS on; select, update and delete policies for authenticated only.
create table public.todos (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  title text not null
);

alter table public.todos enable row level security;

create policy "owners read" on public.todos
  for select to authenticated
  using (auth.uid() = user_id);

create policy "owners update" on public.todos
  for update to authenticated
  using (auth.uid() = user_id);

create policy "owners delete" on public.todos
  for delete to authenticated
  using (auth.uid() = user_id);

-- RLS on, no policy at all.
create table public.orders (
  id bigint generated always as identity primary key,
  total numeric not null
);

alter table public.orders enable row level security;

-- RLS on; one ALL policy for PUBLIC.
create table public.messages (
  id bigint generated always as identity primary key,
  body text not null
);

alter table public.messages enable row level security;

create policy "everyone" on public.messages
  for all to public
  using (true)
  with check (true);

-- RLS on; a restrictive select policy only, which admits nothing on its own.
create table public.scores (
  id bigint generated always as identity primary key,
  points integer not null
);

alter table public.scores enable row level security;

create policy "only positive" on public.scores
  as restrictive
  for select to anon, authenticated
  using (points > 0);

-- RLS on; a select policy that is literally false.
create table public.audit_log (
  id bigint generated always as identity primary key,
  entry text not null
);

alter table public.audit_log enable row level security;

create policy "nobody reads" on public.audit_log
  for select to anon, authenticated
  using (false);

-- A view over a table with RLS on.
create view public.todo_titles as select id, title from public.todos;

-- RLS off.
create table app.messages (
  id bigint generated always as identity primary key,
  body text not null
);

-- RLS on; update and delete policies, no select policy (a filter cannot find rows).
create table app.orders (
  id bigint generated always as identity primary key,
  total numeric not null
);

alter table app.orders enable row level security;

create policy "anyone updates" on app.orders
  for update to authenticated
  using (true);

create policy "anyone deletes" on app.orders
  for delete to authenticated
  using (true);

-- RLS on; a select policy for anon only.
create table app.scores (
  id bigint generated always as identity primary key,
  points integer not null
);

alter table app.scores enable row level security;

create policy "anon reads" on app.scores
  for select to anon
  using (true);

-- RLS on; an insert policy only (inserts and upserts fail loudly, so they are not checked).
create table app.audit_log (
  id bigint generated always as identity primary key,
  entry text not null
);

alter table app.audit_log enable row level security;

create policy "anyone writes" on app.audit_log
  for insert to anon, authenticated
  with check (true);
