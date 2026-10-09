-- The schema the rule docs' examples are linted against (tests/rules/docs-examples.test.ts).
create table public.todos (
  id bigint generated always as identity primary key,
  title text not null
);

create table public.messages (
  id bigint generated always as identity primary key,
  body text not null
);

alter publication supabase_realtime add table public.messages;
