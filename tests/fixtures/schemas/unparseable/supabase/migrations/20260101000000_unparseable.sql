create table public.todos (
  id bigint generated always as identity primary key
);

create tabel public.broken (id int);

alter table public.todos enable row level security;
