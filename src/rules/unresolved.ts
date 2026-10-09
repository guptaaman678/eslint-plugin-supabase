import type { StatsReason } from '../stats.js';

/**
 * The second half of a schema rule's `unresolved` message (`reportUnresolved`, §6.5): why the
 * call is not checked, and the fix. `table` is the qualified name, for the per-table reasons.
 */
export function unresolvedReason(reason: StatsReason, table?: string): string {
  switch (reason) {
    case 'dynamic-schema':
      return 'its `schema` is not a string literal. Use a literal schema name.';
    case 'dynamic-table':
      return 'its `table` is not a string literal or a union of at most five. Use a literal table name.';
    case 'dynamic-event':
      return 'its `event` is not a string literal. Use a literal event name.';
    case 'realtime-all-tables':
      return 'it listens to every table of a schema. Subscribe to each table by name to have it checked.';
    case 'unknown-operation':
      return 'its operation is not chained to `.from()`. Chain `.select()`, `.update()` or `.delete()` to it in one expression.';
    case 'unknown-client':
      return 'its client is a parameter, a `let` or a property, so the role it runs as is unknown. Use a client created in a `const`, or map it in `settings.supabase.clients`.';
    case 'unknown-key':
      return 'the key of its client is not visibly a publishable or service role key, and `settings.supabase.unknownKey` is `skip`. Map the client in `settings.supabase.clients`.';
    case 'no-project':
      return 'no `supabase/migrations` folder was found above this file. Set `settings.supabase.projectDir`.';
    case 'engine-error':
      return 'replaying your migrations failed. Run `npx supabase-grants-lint check` to see why.';
    case 'unknown-relation':
      return `\`${table}\` is not created in your migrations. Create it in a migration.`;
    case 'unknown-table':
      return `\`${table}\` is not created as a table in your migrations. Set \`reportUnknownTables\` to report it.`;
    case 'view':
      return `\`${table}\` is a view, and row level security applies to the tables it reads. Check the policies of those tables.`;
    case 'publication-uncertain':
      return `a migration changes the publication in a way this rule cannot read (a \`do\` block or a function body), so whether \`${table}\` is a member is unknown.`;
  }
}
