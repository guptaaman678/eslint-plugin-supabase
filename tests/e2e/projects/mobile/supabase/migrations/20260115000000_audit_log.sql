create table public.audit_log (
  id bigint generated always as identity primary key,
  action text not null,
  created_at timestamptz not null default now()
);

alter table public.audit_log enable row level security;

create policy "players log actions" on public.audit_log
  for insert to authenticated with check (true);
