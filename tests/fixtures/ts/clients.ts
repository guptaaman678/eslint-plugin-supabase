// A module that other fixture files import clients and re-exports from.
import { createClient } from '@supabase/supabase-js';

export { createClient as makeClient } from '@supabase/supabase-js';
export type { SupabaseClient as Db } from '@supabase/supabase-js';

export const appDb = createClient('http://localhost:54321', 'sb_publishable_test', {
  db: { schema: 'app' },
});

export const auditDb = appDb.schema('audit');

export const tableName = 'scores';
