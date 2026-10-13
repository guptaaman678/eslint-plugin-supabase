create table public.todos (id bigint primary key, title text);
alter table public.todos enable row level security;
grant select on public.todos to anon, authenticated;

create table public.orders (id bigint primary key, total numeric);
alter table public.orders enable row level security;
grant select on public.orders to anon, authenticated;

create table public.scores (id bigint primary key, points int);
grant select on public.scores to anon, authenticated;

-- The select policy on todos exists, but only a do block creates it (ADR-023).
do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'todos') then
    create policy "todos are readable" on public.todos for select to anon, authenticated using (true);
  end if;
end
$$;

-- RLS is off on scores, so its uncertain policies do not matter.
do $$
begin
  create policy "scores are readable" on public.scores for select using (true);
end
$$;
