# Disallow `void` and unsent Supabase query builders

📝 Disallow `void` and unsent Supabase query builders.

💼 This rule is enabled in the ✅ `recommended` config.

💡 This rule is manually fixable by [editor suggestions](https://eslint.org/docs/latest/use/core-concepts#rule-suggestions).

💭 This rule requires [type information](https://typescript-eslint.io/linting/typed-linting).

<!-- end auto-generated rule header -->

A supabase-js query is lazy. `supabase.from('todos').insert(row)` builds a request, and nothing is
sent until something calls the builder's `then` method, which is what `await` does. A builder that
is discarded with `void`, or left as a statement on its own, is never sent: there is no error and no
rejected promise, the row is simply never written.

Storage downloads work the same way: `supabase.storage.from(bucket).download(path)` and
`.download(path).asStream()` return lazy builders too. Every other storage method (`upload`, `list`,
`remove`, `createSignedUrl`, ...), `functions.invoke` and the `auth` methods send at once, and this
rule leaves them alone.

## Rule details

This rule reports a lazy Supabase builder in two places:

- after `void`;
- as a statement on its own, also inside a callback such as a `forEach` body.

A lazy builder is a value whose type is one of `PostgrestBuilder`, `PostgrestTransformBuilder` and
`PostgrestFilterBuilder` (from `@supabase/postgrest-js`) or `BlobDownloadBuilder` and
`StreamDownloadBuilder` (from `@supabase/storage-js`), a subclass of one, or a union or intersection
that contains one. The rule reads types, so it also finds a builder held in a variable, returned by a
helper or made by `.rpc()`, and it ignores a local class that happens to share one of those names.

Not reported: `await`, `return`, assignment to a variable, passing the builder as an argument,
putting it in an array or object, and `.then()` or `.catch()` chains. Each of these sends the request
or hands the builder on.

Also not reported: a statement that refines a builder held in a variable or parameter, such as
`if (done) query.eq('done', true);`. Filters (`eq`, `in`, `or`, ...) and transforms (`order`,
`limit`, `range`, ...) change the builder they are called on and return it, so the query is sent
later with the refinement. A chain that starts at the client (`supabase.from(...)`), or that ends in
a method returning another builder (`single`, `maybeSingle`, `csv`, `geojson`, `explain`,
`throwOnError`), is still reported, and so is the variable on its own (`query;`). The rule cannot
see whether such a variable is ever sent.

The rule has no options.

Examples of **incorrect** code for this rule:

```ts
import { createClient } from '@supabase/supabase-js';

const supabase = createClient('https://example.supabase.co', 'sb_publishable_example');

// `void` discards the builder before it is sent.
void supabase.from('todos').insert({ title: 'Write the docs' });

// A statement on its own is never sent either.
supabase.rpc('add_points', { points: 10 });

const rows = [{ title: 'one' }, { title: 'two' }];
rows.forEach((row) => {
  supabase.from('todos').insert(row);
});

// Storage downloads are lazy too.
void supabase.storage.from('avatars').download('me.png');
```

Examples of **correct** code for this rule:

```ts
import { createClient } from '@supabase/supabase-js';

const supabase = createClient('https://example.supabase.co', 'sb_publishable_example');

export async function save(title: string) {
  const { error } = await supabase.from('todos').insert({ title });
  if (error) throw error;
}

// `.then()` sends the request without waiting for it.
void supabase
  .from('audit_log')
  .insert({ action: 'login' })
  .then(({ error }) => {
    if (error) console.error(error);
  });

// Uploads are sent at once, so `void` is harmless here.
void supabase.storage.from('avatars').upload('me.png', new Blob(['avatar']));

// A filter refines the query in place; `await` sends it.
export async function list(done?: boolean) {
  const query = supabase.from('todos').select();
  if (done !== undefined) query.eq('done', done);
  return await query;
}
```

### Suggestions

The rule offers two suggestions, not autofixes, because each changes what runs:

- `await` the builder (offered only inside an async function);
- `void <builder>.then()`, which sends the request without waiting. Handle `error` in a callback
  if the result matters.

## How this relates to typescript-eslint

typescript-eslint's `no-floating-promises` checks promises, and a Supabase builder is a thenable,
not a promise:

- In its default setup, a forgotten builder is not reported at all.
- On an eager Supabase call, such as `supabase.functions.invoke('hello')`, it advises `void`, which
  is harmless there.
- With `checkThenables: true` it reports a builder, and its first suggestion is `void`, which drops
  the request.

This rule closes that gap and never suggests a bare `void`. `no-misused-promises` (on by default in
typescript-eslint's type-checked configs) already reports builders returned into `void` callbacks
or used as conditions, so this rule does not repeat those reports.

## When not to use it

Keep it on wherever you use `@supabase/supabase-js`: a builder that is never sent never does
anything. If you build a query on purpose without sending it (for example to inspect the builder in
a test), disable the rule for that line with an `eslint-disable-next-line` comment.
