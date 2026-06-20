import type { JSONContent } from "@tiptap/core";
import type { TitlePage } from "@/lib/export/titlePage";

/**
 * Local-first storage.
 *
 * The architecture principle is: every change writes to local storage instantly
 * and that is the source of truth for the current session. Supabase sync gets
 * layered on top later. For now this module is the entire persistence layer, and
 * it guarantees the one thing that's non-negotiable: you don't lose your work.
 */

const DOC_KEY = "less:script:current";
const TITLE_PAGE_KEY = "less:titlePage";
const PREFS_KEY = "less:prefs";
const ACTIVE_ID_KEY = "less:activeScriptId";
const LAST_SAVED_KEY = "less:lastSavedAt";
const DIRTY_KEY = "less:dirty";

export type FontChoice = "courier" | "courier-prime";
export type ThemeChoice = "light" | "dark";

export interface Prefs {
  font: FontChoice;
  theme: ThemeChoice;
  focusMode: boolean;
  spellCheck: boolean;
  sceneNumbers: boolean;
  revisionMode: boolean;
  autoContd: boolean;
}

export const DEFAULT_PREFS: Prefs = {
  font: "courier-prime",
  theme: "light",
  focusMode: false,
  spellCheck: true,
  sceneNumbers: false,
  revisionMode: false,
  autoContd: false,
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

/** Load the saved title page, or null if there is none. */
export function loadTitlePage(): TitlePage | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(TITLE_PAGE_KEY);
    return raw ? (JSON.parse(raw) as TitlePage) : null;
  } catch {
    return null;
  }
}

/** Persist (or clear, when null) the title page on the same footing as the doc. */
export function saveTitlePage(tp: TitlePage | null): void {
  if (typeof window === "undefined") return;
  try {
    if (tp === null) window.localStorage.removeItem(TITLE_PAGE_KEY);
    else window.localStorage.setItem(TITLE_PAGE_KEY, JSON.stringify(tp));
  } catch {
    /* ignore */
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

/* --- Cloud-sync bookkeeping ------------------------------------------------
   Which cloud script this device is editing, when it was last pushed, and
   whether there are local edits not yet synced. These let us reconcile safely
   on reload and after going offline. */

function get(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}
function set(key: string, value: string | null): void {
  if (typeof window === "undefined") return;
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

export const getActiveScriptId = () => get(ACTIVE_ID_KEY);
export const setActiveScriptId = (id: string | null) => set(ACTIVE_ID_KEY, id);
export const getLastSavedAt = () => get(LAST_SAVED_KEY);
export const setLastSavedAt = (iso: string | null) => set(LAST_SAVED_KEY, iso);
export const isDirty = () => get(DIRTY_KEY) === "1";
export const setDirty = (dirty: boolean) => set(DIRTY_KEY, dirty ? "1" : "0");

// Low-level string get/set, reused by the multi-project storage module so all
// localStorage access shares the same SSR guard and swallow-on-failure behavior.
export { get as lsGet, set as lsSet };

/**
 * Make a debounced version of a function (used for autosave). The returned
 * function carries a `cancel()` that drops any pending call, so callers can
 * stop a stale save from firing when content is replaced out-of-band (e.g. an
 * import or a version restore that bypasses the editor's update event).
 */
export type Debounced<A extends unknown[]> = ((...args: A) => void) & {
  cancel: () => void;
};

export function debounce<A extends unknown[]>(
  fn: (...args: A) => void,
  ms: number
): Debounced<A> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const debounced = (...args: A) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
  debounced.cancel = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };
  return debounced;
}
