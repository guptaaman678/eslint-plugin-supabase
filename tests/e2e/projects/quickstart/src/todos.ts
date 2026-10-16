import { createClient } from '@supabase/supabase-js';

const supabase = createClient('https://example.supabase.co', 'sb_publishable_example');

export function addTodo(title: string) {
  void supabase.from('todos').insert({ title });
}

export async function todos() {
  const { data } = await supabase.from('todos').select('id, title');
  return data ?? [];
}

// The override turns this warning into an error.
export function watchTodos(onChange: () => void) {
  return supabase
    .channel('todos')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'todos' }, onChange)
    .subscribe();
}
