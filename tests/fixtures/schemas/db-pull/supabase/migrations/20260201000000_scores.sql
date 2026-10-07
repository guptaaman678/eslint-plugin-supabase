create table public.scores (
  id bigint generated always as identity primary key,
  points integer not null
);
