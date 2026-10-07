import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { didYouMean } from './util/did-you-mean.js';

/** The database roles a Supabase client can run as. */
export const ROLES = ['anon', 'authenticated', 'service_role'] as const;
export type Role = (typeof ROLES)[number];

/** A `settings.supabase.clients` entry, with `role` normalised to a list. */
export interface ClientMapping {
  /** Path glob, relative to the project root, of the module that declares the client. */
  readonly module?: string;
  /** Name of the factory that creates the client, for example `createAdminClient`. */
  readonly callee?: string;
  readonly roles: readonly Role[];
}

/** `settings.supabase`, validated, with defaults applied and paths made absolute. */
export interface SupabaseSettings {
  /** Absolute project directory, or undefined to discover it from each linted file. */
  readonly projectDir: string | undefined;
  /** Absolute grants-lint config file, or undefined for grants-lint's own lookup. */
  readonly grantsLintConfig: string | undefined;
  readonly clients: readonly ClientMapping[];
  readonly defaultRoles: readonly Role[];
  readonly unknownKey: 'default' | 'skip';
  readonly migrationsHash: string | undefined;
}

export const SETTINGS_KEYS = [
  'projectDir',
  'grantsLintConfig',
  'clients',
  'defaultRoles',
  'unknownKey',
  'migrationsHash',
] as const;

/** Replay settings belong to grants-lint's config and are never read from ESLint settings. */
export const GRANTS_LINT_KEYS = [
  'migrations',
  'schemas',
  'since',
  'platformDefaults',
  'platformRevokeAtSince',
  'migrationRole',
  'clientRoles',
  'serviceRole',
  'autoRls',
  'platformPublications',
] as const;

export const DEFAULT_ROLES: readonly Role[] = ['anon', 'authenticated'];

/** grants-lint's config file name and `package.json` key. */
export const GRANTS_LINT_CONFIG_FILE = 'grants-lint.config.json';
export const GRANTS_LINT_PACKAGE_KEY = 'grantsLint';

/** An invalid `settings.supabase` value. `key` is the offending key path, such as `clients[0].role`. */
export class SettingsError extends Error {
  readonly key: string;

  constructor(key: string, problem: string) {
    const where = key === '' ? 'settings.supabase' : `settings.supabase.${key}`;
    super(`eslint-plugin-supabase: invalid ${where}: ${problem}`);
    this.name = 'SettingsError';
    this.key = key;
  }
}

function describe(value: unknown): string {
  if (value === null || value === undefined) return String(value);
  if (Array.isArray(value)) return 'an array';
  if (typeof value === 'string') return JSON.stringify(value);
  return typeof value === 'object' ? 'an object' : `a ${typeof value}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown, key: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value === '') {
    throw new SettingsError(key, `expected a non-empty string, got ${describe(value)}`);
  }
  return value;
}

function parseRole(value: unknown, key: string): Role {
  if (typeof value === 'string' && (ROLES as readonly string[]).includes(value)) {
    return value as Role;
  }
  const hint = typeof value === 'string' ? didYouMean(value, ROLES) : undefined;
  const suffix = hint === undefined ? '' : ` Did you mean "${hint}"?`;
  throw new SettingsError(
    key,
    `expected one of ${ROLES.join(', ')}, got ${describe(value)}.${suffix}`,
  );
}

function parseRoles(value: unknown, key: string): readonly Role[] {
  if (!Array.isArray(value)) return [parseRole(value, key)];
  if (value.length === 0) throw new SettingsError(key, 'expected at least one role');
  const roles = value.map((item, index) => parseRole(item, `${key}[${index}]`));
  if (new Set(roles).size !== roles.length) throw new SettingsError(key, 'lists a role twice');
  return roles;
}

function parseClient(value: unknown, key: string): ClientMapping {
  if (!isRecord(value)) throw new SettingsError(key, `expected an object, got ${describe(value)}`);
  rejectUnknownKeys(value, ['module', 'callee', 'role'], key);
  const module = optionalString(value.module, `${key}.module`);
  const callee = optionalString(value.callee, `${key}.callee`);
  if (module === undefined && callee === undefined) {
    throw new SettingsError(key, 'needs `module` or `callee` to say which client it maps');
  }
  if (value.role === undefined) throw new SettingsError(`${key}.role`, 'is required');
  const roles = parseRoles(value.role, `${key}.role`);
  return {
    ...(module === undefined ? {} : { module }),
    ...(callee === undefined ? {} : { callee }),
    roles,
  };
}

function rejectUnknownKeys(
  value: Record<string, unknown>,
  known: readonly string[],
  prefix: string,
) {
  for (const key of Object.keys(value)) {
    if (known.includes(key)) continue;
    const keyPath = prefix === '' ? key : `${prefix}.${key}`;
    if (prefix === '' && (GRANTS_LINT_KEYS as readonly string[]).includes(key)) {
      throw new SettingsError(
        keyPath,
        `is a grants-lint setting: set it in ${GRANTS_LINT_CONFIG_FILE} or package.json#${GRANTS_LINT_PACKAGE_KEY}, not in ESLint settings`,
      );
    }
    const hint = didYouMean(key, known);
    const suffix = hint === undefined ? '' : ` Did you mean "${hint}"?`;
    throw new SettingsError(keyPath, `is not a known setting.${suffix}`);
  }
}

/**
 * Validates raw `settings.supabase` and applies defaults. Relative paths are resolved against
 * `cwd` (ESLint's working directory), and an explicit `grantsLintConfig` must exist.
 * Throws `SettingsError` naming the offending key.
 */
export function parseSettings(raw: unknown, cwd: string): SupabaseSettings {
  if (raw === undefined) raw = {};
  if (!isRecord(raw)) throw new SettingsError('', `expected an object, got ${describe(raw)}`);
  rejectUnknownKeys(raw, SETTINGS_KEYS, '');

  const projectDir = optionalString(raw.projectDir, 'projectDir');
  const grantsLintConfig = optionalString(raw.grantsLintConfig, 'grantsLintConfig');
  const configPath =
    grantsLintConfig === undefined ? undefined : path.resolve(cwd, grantsLintConfig);
  if (configPath !== undefined && !isFile(configPath)) {
    throw new SettingsError('grantsLintConfig', `file not found: ${configPath}`);
  }

  let clients: readonly ClientMapping[] = [];
  if (raw.clients !== undefined) {
    if (!Array.isArray(raw.clients)) {
      throw new SettingsError('clients', `expected an array, got ${describe(raw.clients)}`);
    }
    clients = raw.clients.map((entry, index) => parseClient(entry, `clients[${index}]`));
  }

  const defaultRoles =
    raw.defaultRoles === undefined ? DEFAULT_ROLES : parseRoles(raw.defaultRoles, 'defaultRoles');

  const unknownKey = raw.unknownKey ?? 'default';
  if (unknownKey !== 'default' && unknownKey !== 'skip') {
    throw new SettingsError(
      'unknownKey',
      `expected "default" or "skip", got ${describe(unknownKey)}`,
    );
  }

  return {
    projectDir: projectDir === undefined ? undefined : path.resolve(cwd, projectDir),
    grantsLintConfig: configPath,
    clients,
    defaultRoles,
    unknownKey,
    migrationsHash: optionalString(raw.migrationsHash, 'migrationsHash'),
  };
}

/** The part of a rule context that settings depend on. */
export interface SettingsContext {
  readonly settings: Readonly<Record<string, unknown>>;
  readonly cwd: string;
}

const cache = new WeakMap<object, Map<string, SupabaseSettings>>();
const NO_SETTINGS = {};

/** `settings.supabase` of a rule context, parsed once per settings object and working directory. */
export function readSettings(context: SettingsContext): SupabaseSettings {
  const raw = context.settings.supabase;
  if (raw !== undefined && !isRecord(raw)) return parseSettings(raw, context.cwd);
  const key = raw ?? NO_SETTINGS;
  let byCwd = cache.get(key);
  if (byCwd === undefined) {
    byCwd = new Map();
    cache.set(key, byCwd);
  }
  let settings = byCwd.get(context.cwd);
  if (settings === undefined) {
    settings = parseSettings(raw, context.cwd);
    byCwd.set(context.cwd, settings);
  }
  return settings;
}

function isFile(file: string): boolean {
  return existsSync(file) && statSync(file).isFile();
}

/**
 * The files grants-lint reads its config from for a project, lowest precedence first:
 * `package.json` when it has a `grantsLint` key, `grants-lint.config.json`, then the explicit
 * `grantsLintConfig` file. These are inputs of the replay, so the cache and `migrationsHash`
 * watch them. A `package.json` that does not parse is listed, since grants-lint would report it.
 */
export function grantsLintConfigFiles(
  projectDir: string,
  explicit: string | undefined,
): readonly string[] {
  const files: string[] = [];
  const pkgPath = path.join(projectDir, 'package.json');
  if (isFile(pkgPath) && packageHasGrantsLintKey(pkgPath)) files.push(pkgPath);
  const defaultPath = path.join(projectDir, GRANTS_LINT_CONFIG_FILE);
  if (isFile(defaultPath) && defaultPath !== explicit) files.push(defaultPath);
  if (explicit !== undefined) files.push(explicit);
  return files;
}

function packageHasGrantsLintKey(pkgPath: string): boolean {
  try {
    const pkg: unknown = JSON.parse(readFileSync(pkgPath, 'utf8'));
    return isRecord(pkg) && pkg[GRANTS_LINT_PACKAGE_KEY] !== undefined;
  } catch {
    return true;
  }
}
