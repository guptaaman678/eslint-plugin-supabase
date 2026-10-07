import path from 'node:path';

const SPECIAL = /[.*+?^${}()|[\]\\]/g;

/**
 * A `settings.supabase.clients[].module` glob as a regular expression over a `/`-separated path
 * relative to the project root. `**` matches across directories (`**\/` also matches none), `*`
 * and `?` stay within one path segment, and `{a,b}` is one level of alternatives. A leading `./`
 * is ignored. Undefined when a `{` is not closed.
 */
export function globToRegExp(glob: string): RegExp | undefined {
  const pattern = glob.startsWith('./') ? glob.slice(2) : glob;
  let source = '';
  let inBraces = false;
  for (let index = 0; index < pattern.length; index++) {
    const char = pattern[index]!;
    if (char === '*' && pattern[index + 1] === '*') {
      const dirs = pattern[index + 2] === '/';
      source += dirs ? '(?:.*/)?' : '.*';
      index += dirs ? 2 : 1;
    } else if (char === '*') source += '[^/]*';
    else if (char === '?') source += '[^/]';
    else if (char === '{' && !inBraces) {
      inBraces = true;
      source += '(?:';
    } else if (char === '}' && inBraces) {
      inBraces = false;
      source += ')';
    } else if (char === ',' && inBraces) source += '|';
    else source += char.replace(SPECIAL, '\\$&');
  }
  return inBraces ? undefined : new RegExp(`^${source}$`);
}

const compiled = new Map<string, RegExp | undefined>();

/** Whether `file` (absolute) matches `glob` relative to `projectDir`. Never matches outside it. */
export function matchesGlob(glob: string, file: string, projectDir: string): boolean {
  if (!compiled.has(glob)) compiled.set(glob, globToRegExp(glob));
  const regExp = compiled.get(glob);
  const relative = path.relative(projectDir, file).replaceAll('\\', '/');
  if (regExp === undefined || relative.startsWith('../') || path.isAbsolute(relative)) {
    return false;
  }
  return regExp.test(relative);
}
