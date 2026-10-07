// A project's own client factories, which settings.supabase.clients can map by module or callee.
import { createClient } from '@supabase/supabase-js';

declare const env: { SUPABASE_SERVICE_ROLE_KEY: string };

const url = 'http://localhost:54321';

export const adminKey = env.SUPABASE_SERVICE_ROLE_KEY;

export function createAdminClient() {
  return createClient(url, 'sb_secret_test');
}

export function createServerDb() {
  return Promise.resolve(createClient(url, 'sb_publishable_test'));
}

export const adminDb = createClient(url, 'sb_secret_test');

export class Repo {
  client() {
    return createClient(url, 'sb_publishable_test');
  }
}
