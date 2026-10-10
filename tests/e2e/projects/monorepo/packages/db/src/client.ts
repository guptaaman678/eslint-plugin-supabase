import { createClient } from '@supabase/supabase-js';

export function createAppClient(url: string, publishableKey: string) {
  return createClient(url, publishableKey);
}

export function createWorkerClient(url: string, key: string) {
  return createClient(url, key, { db: { schema: 'private' } });
}
