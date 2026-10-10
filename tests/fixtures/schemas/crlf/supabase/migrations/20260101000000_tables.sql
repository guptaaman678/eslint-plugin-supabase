-- Written with CRLF line endings, as an editor on Windows saves it.
-- `.gitattributes` keeps these files byte for byte (`-text`).
create table public.todos (
  id bigint generated always as identity primary key,
  title text not null
);

alter table public.todos enable row level security;

create policy "anyone reads todos" on public.todos
  for select to anon, authenticated
  using (true);

create table public.messages (
  id bigint generated always as identity primary key,
  body text not null
);

alter table public.messages enable row level security;
