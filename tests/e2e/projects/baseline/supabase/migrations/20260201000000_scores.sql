create table public.scores (
  id bigint generated always as identity primary key,
  points integer not null
);

grant select on public.scores to anon, authenticated;
