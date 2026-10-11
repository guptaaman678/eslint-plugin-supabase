import { supabase } from './supabase';

export function sendMessage(body: string) {
  void supabase.from('messages').insert({ body });
}

export function watchMessages(onMessage: (body: string) => void) {
  return supabase
    .channel('room')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, (payload) =>
      onMessage(String(payload.new.body)),
    )
    .subscribe((status, err) => {
      if (status === 'CHANNEL_ERROR') console.error(err);
    });
}
