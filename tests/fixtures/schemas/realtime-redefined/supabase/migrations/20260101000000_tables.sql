create table public.todos (
  id bigint generated always as identity primary key,
  title text not null
);

create table public.messages (
  id bigint generated always as identity primary key,
  body text not null
);

do $$
begin
  execute 'alter publication supabase_realtime add table public.todos';
end
$$;
