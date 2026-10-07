create table public.scores (
  id bigint generated always as identity primary key,
  player text not null,
  points integer not null
);

grant select on public.scores to authenticated;

grant update (points) on public.scores to authenticated;

grant select, insert, update, delete on public.scores to service_role;
