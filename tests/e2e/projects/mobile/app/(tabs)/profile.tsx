import { supabase } from '../../lib/supabase';

export async function logAction(action: string) {
  await supabase.from('audit_log').insert({ action });
}

export async function recentActions() {
  const { data } = await supabase.from('audit_log').select('action, created_at').limit(20);
  return data ?? [];
}

export function prefetchAvatar(path: string) {
  supabase.storage.from('avatars').download(path);
}

export function watchAudit(onChange: () => void) {
  return supabase
    .channel('audit')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'audit_log' }, onChange)
    .subscribe((status) => console.log(status));
}
