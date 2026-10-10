import { supabase } from './client';

export async function todos() {
  const { data } = await supabase.from('todos').select('id, title');
  return data ?? [];
}

export async function rename(id: number, title: string) {
  await supabase.from('todos').update({ title }).eq('id', id);
}

export async function remove(id: number) {
  await supabase.from('todos').delete().eq('id', id);
}

export async function topScores() {
  const { data } = await supabase.from('scores').select('points').limit(10);
  return data ?? [];
}

export function watchMessages(onMessage: () => void) {
  return supabase
    .channel('messages')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, onMessage)
    .subscribe((status) => console.log(status));
}
