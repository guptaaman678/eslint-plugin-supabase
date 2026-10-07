create table public.todos (
  id bigint generated always as identity primary key,
  title text not null
);

alter table public.todos enable row level security;

create table public.orders (
  id bigserial primary key,
  total numeric not null
);

create table public.audit_log (
  id bigint generated always as identity primary key,
  entry text not null
);

alter table public.audit_log enable row level security;

alter table public.audit_log force row level security;

create table public.messages (
  id bigint generated always as identity primary key,
  body text not null
);

alter table public.messages enable row level security;

alter table public.messages disable row level security;
