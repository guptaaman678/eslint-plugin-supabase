import { createWorkerClient } from '../../../packages/db/src/client';

const worker = createWorkerClient(process.env.SUPABASE_URL!, process.env.WORKER_KEY!);

export async function nextJob() {
  const { data } = await worker.from('jobs').select('id, kind').limit(1).single();
  return data;
}

export async function recentOrders() {
  const { data } = await worker.schema('public').from('orders').select('id, status');
  return data ?? [];
}
