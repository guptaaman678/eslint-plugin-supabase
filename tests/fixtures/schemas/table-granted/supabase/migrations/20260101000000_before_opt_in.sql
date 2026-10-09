-- Created before the opt-in: the replayed default privileges grant everything.
create table public.todos (
  id bigint generated always as identity primary key,
  title text not null
);

create view public.todo_titles as select id, title from public.todos;
