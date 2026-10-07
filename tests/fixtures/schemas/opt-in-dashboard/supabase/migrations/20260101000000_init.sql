create table public.audit_log (
  id bigint generated always as identity primary key,
  entry text not null
);
