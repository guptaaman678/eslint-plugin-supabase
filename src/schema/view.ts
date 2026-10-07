import type { Role } from '../settings.js';
import type { MembershipFunction } from './engine-api.js';
import type {
  Membership,
  SchemaSnapshot,
  SnapshotMeta,
  SnapshotPolicy,
  SnapshotRelation,
} from './snapshot.js';

/** The table privileges the Data API needs for reads and writes. */
export type Privilege = 'select' | 'insert' | 'update' | 'delete';

/** The grantee name the snapshot uses for PUBLIC. */
export const PUBLIC = 'public';

/** The only questions rules may ask about the schema (§6.4, ADR-017 §6). */
export interface SchemaView {
  /** The relation, or `undefined` when the migrations never create it (skip: `unknown-relation`). */
  relation(schema: string, name: string): SnapshotRelation | undefined;
  /** The role, or PUBLIC, holds `privilege` on the relation, on the table or on some columns. */
  canUse(role: Role, schema: string, name: string, privilege: Privilege): boolean;
  /** Permissive policies for `command` (or `all`) whose roles include the role or PUBLIC. */
  policies(role: Role, schema: string, name: string, command: Privilege): readonly SnapshotPolicy[];
  /** Membership of table `schema.name` in publication `pub`. */
  inPublication(pub: string, schema: string, name: string): Membership;
  meta(): SnapshotMeta;
}

function key(schema: string, name: string): string {
  return `${schema}\u0000${name}`;
}

/**
 * A `SchemaView` over one snapshot. `membership` is the engine's `publicationMembership`, so the
 * plugin and grants-lint share one implementation (ADR-015).
 */
export function createSchemaView(
  snapshot: SchemaSnapshot,
  membership: MembershipFunction,
): SchemaView {
  const relations = new Map(snapshot.relations.map((r) => [key(r.schema, r.name), r]));
  const relation = (schema: string, name: string) => relations.get(key(schema, name));

  return {
    relation,
    canUse(role, schema, name, privilege) {
      const privileges = relation(schema, name)?.privileges;
      if (privileges === undefined) return false;
      return [role, PUBLIC].some((grantee) => privileges[grantee]?.[privilege] !== undefined);
    },
    policies(role, schema, name, command) {
      const policies = relation(schema, name)?.policies ?? [];
      return policies.filter(
        (policy) =>
          policy.permissive &&
          (policy.command === command || policy.command === 'all') &&
          (policy.roles.includes(role) || policy.roles.includes(PUBLIC)),
      );
    },
    inPublication: (pub, schema, name) => membership(snapshot, pub, schema, name),
    meta: () => snapshot.meta,
  };
}
