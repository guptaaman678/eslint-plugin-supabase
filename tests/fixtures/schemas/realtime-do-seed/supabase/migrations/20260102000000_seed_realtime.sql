-- Publish tables idempotently, as a seed written after a baseline that missed them.
do $$
declare
  t text;
begin
  foreach t in array array['todos', 'messages', 'scores'] loop
    if exists (select 1 from pg_tables where schemaname = 'public' and tablename = t)
      and not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
      )
    then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end
$$;

alter publication supabase_realtime drop table public.scores;

alter publication supabase_realtime add table public.orders;
