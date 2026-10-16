// A Deno edge function: no tsconfig includes it, and neither the typed-linting block nor
// `recommended` lints it.
import { createClient } from 'jsr:@supabase/supabase-js@2';

Deno.serve(async () => {
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!);
  void supabase.from('todos').insert({ title: 'from an edge function' });
  return new Response('ok');
});
