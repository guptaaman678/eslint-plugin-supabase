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
