/**
 * Version stacks: several documents that are drafts of the same thing (four
 * one-pagers, three drafts of a pilot) shown on the desk as ONE cover with the
 * other versions stacked behind it, fanned out on demand.
 *
 * The model is two optional fields on each document, synced like any other:
 *   stackId   documents sharing one belong to the same stack
 *   stackTop  when this version was last made the current one (ISO time)
 * The current version (the one on top) is the member made current most
 * recently; with no choice made, the most recently edited. Every document stays
 * a normal document: in its folder, openable, searchable. A stack is only a way
 * of showing them, so taking a version out of a stack loses nothing.
 */

export interface Stackable {
  id: string;
  title: string;
  updatedAt: string;
  createdAt: string;
  stackId?: string;
  stackTop?: string;
}

export interface StackGroup<T extends Stackable> {
  /** The stack id, or the document id for a document on its own. */
  key: string;
  /** The current version, drawn on top. */
  head: T;
  /** Every version, current first, then newest made first. */
  members: T[];
}

function byCurrent<T extends Stackable>(a: T, b: T): number {
  const top = (b.stackTop ?? "").localeCompare(a.stackTop ?? "");
  if (top !== 0) return top;
  return b.updatedAt.localeCompare(a.updatedAt);
}

/** The version on top of a stack. */
export function headOf<T extends Stackable>(members: readonly T[]): T {
  return [...members].sort(byCurrent)[0];
}

/**
 * Group one container's documents (already in the writer's order) into
 * stacks. A stack sits where its first member sits in that order, so making
 * a different version current never moves the stack on the desk.
 */
export function groupStacks<T extends Stackable>(items: readonly T[]): StackGroup<T>[] {
  const groups: { key: string; members: T[] }[] = [];
  const byKey = new Map<string, { key: string; members: T[] }>();
  for (const item of items) {
    const key = item.stackId ? `s:${item.stackId}` : `d:${item.id}`;
    let g = byKey.get(key);
    if (!g) {
      g = { key, members: [] };
      byKey.set(key, g);
      groups.push(g);
    }
    g.members.push(item);
  }
  return groups.map((g) => {
    const head = headOf(g.members);
    const rest = g.members
      .filter((m) => m !== head)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return { key: g.key, head, members: [head, ...rest] };
  });
}

/* ---- Suggestions: drafts already side by side ---------------------------- */

const MARKER_WORDS = new Set([
  "copy",
  "final",
  "revised",
  "rewrite",
  "polish",
  "polished",
  "new",
  "old",
  "latest",
  "current",
  "updated",
  "wip",
  "edit",
  "edited",
  "draft",
]);
const MONTH = "(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?";

/**
 * The part of a title that names the work, with version markers removed:
 * "Pitch One-Pager, Oct 17", "Pitch one pager v3" and "Pitch One-Pager
 * (copy 2)" all read as "pitch one pager". Conservative on purpose: a bare
 * trailing number is kept, so "Episode 1" and "Episode 2" stay apart.
 */
export function versionRoot(title: string): string {
  let t = ` ${title.toLowerCase()} `;
  t = t.replace(/\((?:copy|draft|version|v|rev)[^)]*\)/g, " ");
  t = t.replace(/\b(?:draft|version|rev(?:ision)?|take|pass)\s*#?\s*\d+(?:\.\d+)*\b/g, " ");
  t = t.replace(/\bv\s?\d+(?:\.\d+)*\b/g, " ");
  t = t.replace(new RegExp(`\\b${MONTH}\\s+\\d{1,2}(?:st|nd|rd|th)?(?:,?\\s+\\d{2,4})?\\b`, "g"), " ");
  t = t.replace(/\b\d{4}[./-]\d{1,2}[./-]\d{1,2}\b|\b\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b/g, " ");
  const words = t.replace(/[^\p{L}\p{N}]+/gu, " ").trim().split(/\s+/).filter(Boolean);
  // Strip marker words only at the edges ("Final draft of X", "X revised").
  while (words.length && MARKER_WORDS.has(words[0])) words.shift();
  while (words.length && MARKER_WORDS.has(words[words.length - 1])) words.pop();
  return words.join(" ");
}

/**
 * The shared name of a set of versions, as the writer spells it, for showing:
 * "Gods one-pager v3" and "Pitch, Oct 17" read as "Gods one-pager" and
 * "Pitch". Falls back to the title when nothing is left.
 */
export function versionName(title: string): string {
  let t = ` ${title} `;
  t = t.replace(/\((?:copy|draft|version|v|rev)[^)]*\)/gi, " ");
  t = t.replace(/\b(?:draft|version|rev(?:ision)?|take|pass)\s*#?\s*\d+(?:\.\d+)*\b/gi, " ");
  t = t.replace(/\bv\s?\d+(?:\.\d+)*\b/gi, " ");
  t = t.replace(new RegExp(`\\b${MONTH}\\s+\\d{1,2}(?:st|nd|rd|th)?(?:,?\\s+\\d{2,4})?\\b`, "gi"), " ");
  t = t.replace(/\b\d{4}[./-]\d{1,2}[./-]\d{1,2}\b|\b\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b/g, " ");
  const words = t.trim().split(/\s+/).filter(Boolean);
  const marker = (w: string) => MARKER_WORDS.has(w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, ""));
  const before = words.length;
  while (words.length && marker(words[0])) words.shift();
  // "Final draft of The Lighthouse": the "of" went with the marker.
  if (words.length < before && words.length > 1 && words[0].toLowerCase() === "of") words.shift();
  while (words.length && marker(words[words.length - 1])) words.pop();
  const name = words.join(" ").replace(/[\s,;:.\-–—]+$/u, "").trim();
  return name || title.trim();
}

export interface StackSuggestion {
  /** Stable key for remembering a dismissal. */
  key: string;
  /** The shared name, as the current version spells it. */
  label: string;
  /** Members to stack, the suggested current version first. */
  ids: string[];
}

/**
 * Groups of documents in one container that look like versions of each other
 * (same kind, same root title) and are not already one stack. `kindOf` keeps
 * a treatment and a script of the same title apart.
 */
export function suggestStacks<T extends Stackable>(
  items: readonly T[],
  kindOf: (item: T) => string
): StackSuggestion[] {
  const byRoot = new Map<string, T[]>();
  for (const item of items) {
    const root = versionRoot(item.title);
    // "Untitled" is not a name: three blank pages are not drafts of one thing.
    if (root.length < 3 || /^untitled\b/.test(root)) continue;
    const key = `${kindOf(item)}|${root}`;
    const list = byRoot.get(key) ?? [];
    list.push(item);
    byRoot.set(key, list);
  }
  const out: StackSuggestion[] = [];
  for (const [key, list] of byRoot) {
    if (list.length < 2) continue;
    const stacks = new Set(list.map((m) => m.stackId ?? `d:${m.id}`));
    if (stacks.size < 2) continue; // already one stack
    const head = headOf(list);
    out.push({
      key,
      label: versionName(head.title),
      ids: [head.id, ...list.filter((m) => m !== head).map((m) => m.id)],
    });
  }
  return out;
}
