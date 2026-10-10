import { admin } from '../../lib/admin';
import { supabase } from '../../lib/supabase';

export async function listTodos() {
  const { data, error } = await supabase.from('todos').select('id, title, done');
  if (error) throw error;
  return data;
}

export function addTodo(title: string) {
  void supabase.from('todos').insert({ title });
}

export async function listOrders() {
  const { data } = await supabase.from('orders').select('id, total');
  return data ?? [];
}

export async function listAllOrders() {
  const { data } = await admin.from('orders').select('id, total');
  return data ?? [];
}

export async function countRows(table: string) {
  const { count } = await supabase.from(table).select('*', { count: 'exact', head: true });
  return count;
}
