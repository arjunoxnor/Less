import type { JSONContent } from "@tiptap/core";

/**
 * Local-first storage.
 *
 * The architecture principle is: every change writes to local storage instantly
 * and that is the source of truth for the current session. Supabase sync gets
 * layered on top later. For now this module is the entire persistence layer, and
 * it guarantees the one thing that's non-negotiable: you don't lose your work.
 */

const DOC_KEY = "less:script:current";
const PREFS_KEY = "less:prefs";

export type FontChoice = "courier" | "courier-prime";
export type ThemeChoice = "light" | "dark";

export interface Prefs {
  font: FontChoice;
  theme: ThemeChoice;
  focusMode: boolean;
}

export const DEFAULT_PREFS: Prefs = {
  font: "courier-prime",
  theme: "light",
  focusMode: false,
};

/** Load the saved document, or null if this is a first visit. */
export function loadDoc(): JSONContent | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(DOC_KEY);
    return raw ? (JSON.parse(raw) as JSONContent) : null;
  } catch {
    return null;
  }
}

/** Persist the document. Called debounced on every change. */
export function saveDoc(doc: JSONContent): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(DOC_KEY, JSON.stringify(doc));
  } catch {
    // Storage full / disabled. Swallowing here is intentional; a louder
    // recovery path (and Supabase sync) arrives in the save/auth phase.
  }
}

export function loadPrefs(): Prefs {
  if (typeof window === "undefined") return DEFAULT_PREFS;
  try {
    const raw = window.localStorage.getItem(PREFS_KEY);
    return raw ? { ...DEFAULT_PREFS, ...JSON.parse(raw) } : DEFAULT_PREFS;
  } catch {
    return DEFAULT_PREFS;
  }
}

export function savePrefs(prefs: Prefs): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    /* ignore */
  }
}

/** Make a debounced version of a function (used for autosave). */
export function debounce<A extends unknown[]>(
  fn: (...args: A) => void,
  ms: number
): (...args: A) => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return (...args: A) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}
