import { supabase, subscribeLogged } from '../../lib/supabase';

export async function loadScores() {
  const { data } = await supabase.from('scores').select('id, points').order('points');
  return data ?? [];
}

export function bumpScore(id: number, points: number) {
  supabase.from('scores').update({ points }).eq('id', id);
}

export async function resetScore(id: number) {
  await supabase.from('scores').update({ points: 0 }).eq('id', id);
}

export function liveScores(onChange: () => void) {
  const channel = supabase
    .channel('scores')
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'scores' }, onChange);
  return subscribeLogged(channel);
}
