/**
 * The writer's personal spelling dictionary: words they have chosen to keep.
 * Stored in localStorage so it survives reloads and works offline without an
 * account. Optional Supabase sync can layer on later.
 */

const KEY = "less:userDict";

function read(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    const arr: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.filter((w): w is string => typeof w === "string") : [];
  } catch {
    return [];
  }
}

function write(words: string[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(words));
  } catch {
    /* ignore quota / disabled storage */
  }
}

/** Every word the user has added, in insertion order. */
export function loadUserDictionary(): string[] {
  return read();
}

/** Add a word (case-preserved) if it is not already present. */
export function addUserWord(word: string): void {
  const w = word.trim();
  if (!w) return;
  const words = read();
  const lw = w.toLowerCase();
  if (words.some((x) => x.toLowerCase() === lw)) return;
  words.push(w);
  write(words);
}

/** Is this word in the personal dictionary (case-insensitive)? */
export function hasUserWord(word: string): boolean {
  const lw = word.toLowerCase();
  return read().some((x) => x.toLowerCase() === lw);
}
