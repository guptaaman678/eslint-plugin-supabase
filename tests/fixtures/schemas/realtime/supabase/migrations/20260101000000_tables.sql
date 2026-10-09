create table public.todos (
  id bigint generated always as identity primary key,
  title text not null
);

create table public.messages (
  id bigint generated always as identity primary key,
  body text not null
);

create table public.orders (
  id bigint generated always as identity primary key,
  total numeric not null
);

create table public.scores (
  id bigint generated always as identity primary key,
  points integer not null
);

create schema app;

create table app.audit_log (
  id bigint generated always as identity primary key,
  action text not null
);

create view public.todo_titles as select id, title from public.todos;

alter publication supabase_realtime add table public.messages, public.orders;
