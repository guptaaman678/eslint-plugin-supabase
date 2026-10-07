/** Levenshtein distance between two strings, compared case-insensitively. */
export function editDistance(a: string, b: string): number {
  const s = a.toLowerCase();
  const t = b.toLowerCase();
  let previous = Array.from({ length: t.length + 1 }, (_, j) => j);
  for (let i = 1; i <= s.length; i++) {
    const current = [i];
    for (let j = 1; j <= t.length; j++) {
      const substitution = previous[j - 1]! + (s[i - 1] === t[j - 1] ? 0 : 1);
      current.push(Math.min(previous[j]! + 1, current[j - 1]! + 1, substitution));
    }
    previous = current;
  }
  return previous[t.length]!;
}

/**
 * The closest candidate to `input`, or undefined when none is close enough: at most one edit
 * per three characters of the input (and at least one edit).
 */
export function didYouMean(input: string, candidates: readonly string[]): string | undefined {
  const limit = Math.max(1, Math.floor(input.length / 3));
  let best: string | undefined;
  let bestDistance = Infinity;
  for (const candidate of candidates) {
    const distance = editDistance(input, candidate);
    if (distance <= limit && distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}
