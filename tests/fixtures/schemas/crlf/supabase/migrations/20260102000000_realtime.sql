-- Publish todos, then messages from a block.
-- A line counter that treated CRLF as two line breaks would place the block
-- at line 11 instead of 6.

alter publication supabase_realtime add table public.todos;
do $$
begin
  execute 'alter publication supabase_realtime add table public.messages';
end
$$;
