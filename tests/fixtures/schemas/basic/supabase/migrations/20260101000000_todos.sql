create table public.todos (
  id bigint generated always as identity primary key,
  title text not null,
  done boolean not null default false
);

alter table public.todos enable row level security;
