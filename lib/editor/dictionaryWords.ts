/**
 * The rules of a spelling dictionary: what counts as a word, and how two copies
 * become one. Dependency-free, because the API applies them too.
 */

const WORD = /^[\p{L}\p{N}][\p{L}\p{N}'\u2019.-]{0,63}$/u;
export const DICTIONARY_MAX = 5000;

/** A dictionary read from storage or the network: only real words, each once. */
export function cleanDictionary(value: unknown): string[] {
  let v = value;
  if (typeof v === "string") {
    try {
      v = JSON.parse(v);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(v)) return [];
  return mergeDictionary(
    [],
    v.filter((w): w is string => typeof w === "string").map((w) => w.trim()).filter((w) => WORD.test(w))
  );
}

/** Both copies' words, the first copy's spelling and order first; case never makes a second entry. */
export function mergeDictionary(a: readonly string[], b: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const word of [...a, ...b]) {
    const key = word.toLowerCase();
    if (seen.has(key) || out.length >= DICTIONARY_MAX) continue;
    seen.add(key);
    out.push(word);
  }
  return out;
}
