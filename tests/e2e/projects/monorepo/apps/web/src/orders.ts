import { createAppClient } from '../../../packages/db/src/client';

const db = createAppClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!);

export async function myOrders() {
  const { data } = await db.from('orders').select('id, status');
  return data ?? [];
}

export async function cancelOrder(id: number) {
  await db.from('orders').delete().eq('id', id);
}

export async function markShipped(id: number) {
  await db.from('orders').update({ status: 'shipped' }).eq('id', id);
}

export function watchOrders(onChange: () => void) {
  return db
    .channel('orders')
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'orders' }, onChange)
    .subscribe((status) => console.log(status));
}

export async function audit(action: string) {
  await db.from('audit_log').insert({ action });
}
