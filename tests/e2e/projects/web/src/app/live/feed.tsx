import { supabase } from '../../lib/supabase';

export function watchMessages(onMessage: (body: string) => void) {
  return supabase
    .channel('messages')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, (payload) =>
      onMessage(String(payload.new.body)),
    )
    .subscribe((status, err) => {
      if (status === 'CHANNEL_ERROR') console.error(err);
    });
}

export function watchTodos(onChange: () => void) {
  return supabase
    .channel('todos')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'todos' }, onChange)
    .subscribe();
}
