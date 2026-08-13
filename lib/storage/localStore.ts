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
/** Plain-document fonts (prose), separate from the Courier-only screenplay font. */
export type DocFontChoice =
  | "calibri"
  | "arial"
  | "times"
  | "georgia"
  | "verdana"
  | "proxima"
  | "futura"
  | "courier-prime";
export type ThemeChoice = "light" | "dark" | "system";

export interface Prefs {
  font: FontChoice;
  docFont: DocFontChoice;
  /** Base font size (px) for plain documents. Screenplays are fixed at 12pt. */
  docFontSize: number;
  theme: ThemeChoice;
  focusMode: boolean;
  /** Typewriter scrolling: keep the caret line vertically centered (2F). */
  focusTypewriter: boolean;
  spellCheck: boolean;
  sceneNumbers: boolean;
  revisionMode: boolean;
  autoContd: boolean;
  breakdownHighlight: boolean;
}

export const DEFAULT_PREFS: Prefs = {
  font: "courier-prime",
  docFont: "calibri",
  docFontSize: 16,
  theme: "light",
  focusMode: false,
  focusTypewriter: false,
  spellCheck: true,
  sceneNumbers: false,
  revisionMode: false,
  // ON for new installs (Superaudit 2, 2G). Existing installs that saved prefs
  // before this field existed keep the old default: loadPrefs pins autoContd
  // to false when a stored prefs object is missing the key, so flipping this
  // default never silently changes a working setup.
  autoContd: true,
  breakdownHighlight: true,
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
    if (!raw) return DEFAULT_PREFS;
    const parsed = JSON.parse(raw) as Partial<Prefs>;
    // A stored prefs object that predates the autoContd key means an existing
    // install from the era when the default was OFF. Preserve that behavior:
    // the flipped default (ON) applies only where no prefs were ever saved,
    // i.e. genuinely new installs. Documented choice per Superaudit 2 task 12.
    if (parsed.autoContd === undefined) parsed.autoContd = false;
    return { ...DEFAULT_PREFS, ...parsed };
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
let notifyingStorageFull = false;

function writeStorageValue(key: string, value: string | null): void {
  if (value === null) window.localStorage.removeItem(key);
  else window.localStorage.setItem(key, value);
}

function signalStorageFull(): void {
  // dispatchEvent is synchronous. A listener may free recoverable storage, so
  // the failed write gets one retry below. Guard re-entrancy because the
  // listener's own bookkeeping writes can also hit the same full quota.
  if (notifyingStorageFull) return;
  notifyingStorageFull = true;
  try {
    window.dispatchEvent(new CustomEvent("less:storagefull"));
  } catch {
    /* ignore */
  } finally {
    notifyingStorageFull = false;
  }
}

function set(key: string, value: string | null): boolean {
  if (typeof window === "undefined") return false;
  try {
    writeStorageValue(key, value);
    return true;
  } catch {
    // Storage full or disabled. Return false so callers that persist real work
    // (the document autosave) can surface a visible "not saved" warning instead
    // of showing a false "Saved". Also broadcast a global signal so writes that
    // do NOT thread the boolean back to the UI (folder state, cloud bookkeeping)
    // still make a full disk visible instead of silently corrupting sync state.
    signalStorageFull();
    // The storage-pressure handler runs synchronously and may have made room.
    // Retrying here means the keystroke that discovered a full disk can still
    // land; without it the writer had to type another character to retry.
    try {
      writeStorageValue(key, value);
      return true;
    } catch {
      return false;
    }
  }
}

/** Enumerate localStorage defensively. Private mode can throw even on length. */
export function lsKeys(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const out: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (key !== null) out.push(key);
    }
    return out;
  } catch {
    return [];
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
  ms: number,
  maxWait?: number
): Debounced<A> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let firstPendingAt = 0;
  const fire = (args: A) => {
    timer = null;
    firstPendingAt = 0;
    fn(...args);
  };
  const debounced = (...args: A) => {
    if (timer) clearTimeout(timer);
    const now = Date.now();
    if (!firstPendingAt) firstPendingAt = now;
    // With maxWait set, never wait longer than maxWait from the first pending
    // call, so a long uninterrupted typing burst still flushes periodically
    // instead of being held entirely in memory until the typist pauses.
    const wait =
      maxWait != null
        ? Math.max(0, Math.min(ms, maxWait - (now - firstPendingAt)))
        : ms;
    timer = setTimeout(() => fire(args), wait);
  };
  debounced.cancel = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    firstPendingAt = 0;
  };
  return debounced;
}
