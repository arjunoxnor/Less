import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, type EditorState, TextSelection } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { lineAt } from "./keymap";
import { cueBaseName, TIME_OF_DAY } from "./outline";
import {
  CHARACTER_EXTENSIONS,
  COMMON_SUBLOCATIONS,
  EXTENSION_HINTS,
  LONGEST_ACTION_CANDIDATE,
  SHOTS,
  TRANSITIONS,
} from "./smarttype-catalogs";
import type { ElementType } from "./elements";
import type { Outline } from "@/types/screenplay";

/**
 * Inline autocomplete (SmartType) for screenplays, built as a custom
 * ProseMirror plugin (not the Mention node, because the schema is strict and
 * stores plain text). The plugin owns the open-state and the candidate list;
 * the caret coordinates and that list are pushed to React through onState so a
 * styled dropdown can render next to the caret.
 *
 * Per element it offers what a professional expects:
 *  - scene heading: INT./EXT. openers, then previously-used LOCATIONS, then
 *    sub-locations and TIMES of day after the dash;
 *  - character cue: previously-used NAMES, then cue EXTENSIONS (V.O.), (O.S.)
 *    once you open a paren;
 *  - transition: the standard TRANSITIONS catalog;
 *  - action: SHOTS and transitions, but only while you type in all caps, so
 *    ordinary prose is never interrupted (accepting a transition retypes the
 *    line to a transition in one undo step).
 *
 * Candidates are ranked by frequency and recency from the live outline, with a
 * subsequence fuzzy fallback when nothing matches by prefix. Accepting replaces
 * only the relevant text segment.
 */

export interface AcItem {
  text: string;
  hint: string;
  /** When set, accepting also retypes the line to this element (one undo step). */
  retypeTo?: ElementType;
}

/** Internal plugin state (coords are added by the React-facing snapshot). */
interface AcPluginState {
  open: boolean;
  items: AcItem[];
  active: number;
  replaceFrom: number;
  replaceTo: number;
  /** First text position inside the active line (node pos is lineStart - 1). */
  lineStart: number;
}

/** What React needs to render the menu. */
export interface AcState {
  open: boolean;
  items: AcItem[];
  active: number;
  coords: { left: number; top: number; bottom: number } | null;
  replaceFrom: number;
  replaceTo: number;
}

export const autocompleteKey = new PluginKey<AcPluginState>("screenplayAutocomplete");

const CLOSED: AcPluginState = {
  open: false,
  items: [],
  active: 0,
  replaceFrom: 0,
  replaceTo: 0,
  lineStart: 0,
};

const MAX_ITEMS = 8;

const SLUG_PREFIX = /^\s*(INT\.?\/EXT\.?|EXT\.?\/INT\.?|I\/E\.?|INT\.?|EXT\.?|EST\.?)\b[.\s-]*/i;
const TIME_SEP = /\s+-{1,2}\s+/g;

// The standard slugline openers suggested as you start a scene heading, so
// typing "i" offers INT. and "e" offers EXT., the way the pros do it.
const SLUG_OPENERS = ["INT. ", "EXT. ", "INT./EXT. ", "EST. ", "I/E. "];

// The seed shown the instant you switch to an empty transition line.
const TRANSITION_SEED = ["CUT TO:", "DISSOLVE TO:", "SMASH CUT TO:"];

/* --- Candidate ranking ---------------------------------------------------- */

interface Cand {
  text: string;
  hint: string;
  /** Higher wins first (e.g. how many lines a character speaks). */
  freq?: number;
  /** Higher is more recent (the line index it was last seen at). */
  recency?: number;
  retypeTo?: ElementType;
}

/** Are all of `q`'s characters present in `s`, in order (loose fuzzy match)? */
function isSubsequence(q: string, s: string): boolean {
  let i = 0;
  for (let j = 0; j < s.length && i < q.length; j++) {
    if (s[j] === q[i]) i++;
  }
  return i === q.length;
}

/**
 * Filter a candidate pool by `query` (prefix first, fuzzy fallback) and rank by
 * frequency, then recency, then shortness, then alphabetically. Deterministic.
 */
function rankCandidates(
  query: string,
  pool: Cand[],
  opts?: { fuzzy?: boolean }
): AcItem[] {
  const q = query.toUpperCase();
  const byRank = (a: Cand, b: Cand) =>
    (b.freq ?? 0) - (a.freq ?? 0) ||
    (b.recency ?? 0) - (a.recency ?? 0) ||
    a.text.length - b.text.length ||
    a.text.localeCompare(b.text);

  let hits = pool.filter((c) => {
    const u = c.text.toUpperCase();
    return u.startsWith(q) && u !== q;
  });
  if (hits.length === 0 && opts?.fuzzy && q.length >= 2) {
    hits = pool.filter((c) => {
      const u = c.text.toUpperCase();
      return u !== q && isSubsequence(q, u);
    });
  }
  return hits
    .sort(byRank)
    .slice(0, MAX_ITEMS)
    .map((c) => ({
      text: c.text,
      hint: c.hint,
      ...(c.retypeTo ? { retypeTo: c.retypeTo } : {}),
    }));
}

function closed(lineStart: number): AcPluginState {
  return { ...CLOSED, lineStart };
}

function open(
  items: AcItem[],
  replaceFrom: number,
  replaceTo: number,
  lineStart: number
): AcPluginState {
  return { open: true, items, active: 0, replaceFrom, replaceTo, lineStart };
}

/* --- Per-element computation ---------------------------------------------- */

function computeCharacter(
  fullText: string,
  caretOffset: number,
  lineStart: number,
  outline: Outline
): AcPluginState {
  const upToCaret = fullText.slice(0, caretOffset);

  // Extension mode: once a name is in place and the writer opens a paren, offer
  // the standard cue extensions (V.O.), (O.S.), (CONT'D), and so on.
  const openParen = upToCaret.lastIndexOf("(");
  if (openParen >= 0 && upToCaret.slice(0, openParen).trim()) {
    const extQuery = upToCaret.slice(openParen);
    const base = cueBaseName(fullText).toUpperCase();
    const ce = outline.characters.find((c) => c.name.toUpperCase() === base);
    const lastExt = ce?.lastExtension?.toUpperCase();
    const pool: Cand[] = CHARACTER_EXTENSIONS.map((e) => ({
      text: e,
      hint: EXTENSION_HINTS[e] ?? "",
      // Pin this character's last-used extension to the very top.
      freq: lastExt && e.toUpperCase() === lastExt ? 1 : 0,
    }));
    const items = rankCandidates(extQuery, pool);
    if (items.length === 0) return closed(lineStart);
    return open(items, lineStart + openParen, lineStart + caretOffset, lineStart);
  }

  // Name mode: complete a previously-used character, ranked by how much they
  // speak (and recency) so the leads surface first.
  const query = cueBaseName(upToCaret);
  if (!query) return closed(lineStart);
  const ownName = cueBaseName(fullText).toUpperCase();
  const pool: Cand[] = outline.characters
    .filter((c) => c.name.toUpperCase() !== ownName)
    .map((c) => ({
      text: c.name,
      hint: c.lines === 1 ? "1 line" : `${c.lines} lines`,
      freq: c.lines,
      recency: c.lastIndex,
    }));
  const items = rankCandidates(query, pool, { fuzzy: true });
  if (items.length === 0) return closed(lineStart);
  const lead = upToCaret.length - upToCaret.trimStart().length;
  return open(items, lineStart + lead, lineStart + caretOffset, lineStart);
}

function computeTransition(
  fullText: string,
  caretOffset: number,
  lineStart: number,
  outline: Outline
): AcPluginState {
  const upToCaret = fullText.slice(0, caretOffset);
  const typed = upToCaret.trimStart();
  const lead = upToCaret.length - typed.length;

  // Seed the common transitions the moment you land on an empty transition line.
  if (!typed) {
    const items = TRANSITION_SEED.map((t) => ({ text: t, hint: "" }));
    return open(items, lineStart + lead, lineStart + caretOffset, lineStart);
  }

  const pool: Cand[] = TRANSITIONS.map((t) => ({ text: t, hint: "" }));
  for (const tr of outline.transitions) {
    const ex = pool.find((p) => p.text.toUpperCase() === tr.text.toUpperCase());
    if (ex) {
      ex.freq = tr.count;
      ex.recency = tr.lastIndex;
    } else {
      pool.push({ text: tr.text, hint: "", freq: tr.count, recency: tr.lastIndex });
    }
  }
  const items = rankCandidates(typed, pool, { fuzzy: true });
  if (items.length === 0) return closed(lineStart);
  return open(items, lineStart + lead, lineStart + caretOffset, lineStart);
}

function computeAction(
  fullText: string,
  caretOffset: number,
  lineStart: number
): AcPluginState {
  const upToCaret = fullText.slice(0, caretOffset);
  const trimmed = upToCaret.trimStart();
  // Strict gate so ordinary prose is never interrupted: at least two characters,
  // typed in all caps, no sentence punctuation, and not longer than the longest
  // catalog entry.
  if (trimmed.length < 2) return closed(lineStart);
  if (trimmed !== trimmed.toUpperCase()) return closed(lineStart);
  if (/[.,!?;:]/.test(trimmed)) return closed(lineStart);
  if (trimmed.length > LONGEST_ACTION_CANDIDATE) return closed(lineStart);

  const pool: Cand[] = [
    ...SHOTS.map((s) => ({ text: s, hint: "shot" })),
    ...TRANSITIONS.map((t) => ({
      text: t,
      hint: "transition",
      retypeTo: "transition" as ElementType,
    })),
  ];
  const items = rankCandidates(trimmed, pool);
  if (items.length === 0) return closed(lineStart);
  const lead = upToCaret.length - trimmed.length;
  return open(items, lineStart + lead, lineStart + caretOffset, lineStart);
}

function computeSceneHeading(
  fullText: string,
  caretOffset: number,
  lineStart: number,
  outline: Outline
): AcPluginState {
  // No complete prefix yet: suggest the slugline openers as the writer types one
  // (e.g. "i" -> INT. / INT./EXT. / I/E.). Only when the caret text so far is
  // the start of a known opener, so an ordinary heading is never interrupted.
  const pm = SLUG_PREFIX.exec(fullText);
  if (!pm) {
    const upToCaret = fullText.slice(0, caretOffset);
    const typed = upToCaret.trimStart().toUpperCase();
    if (!typed) return closed(lineStart);
    const items = SLUG_OPENERS.filter(
      (o) => o.toUpperCase().startsWith(typed) && o.toUpperCase() !== typed
    ).map((o) => ({ text: o, hint: "" }));
    if (items.length === 0) return closed(lineStart);
    const lead = upToCaret.length - upToCaret.trimStart().length;
    return open(items, lineStart + lead, lineStart + caretOffset, lineStart);
  }
  const prefixEnd = pm[0].length;
  if (caretOffset <= prefixEnd) return closed(lineStart);

  // Find the last separator after the prefix and count how many there are.
  let sepIdx = -1;
  let sepLen = 0;
  let sepCount = 0;
  TIME_SEP.lastIndex = 0;
  let sep: RegExpExecArray | null;
  while ((sep = TIME_SEP.exec(fullText)) !== null) {
    if (sep.index >= prefixEnd) {
      sepIdx = sep.index;
      sepLen = sep[0].length;
      sepCount++;
    }
  }

  // The trailing segment counts as the time/sub-location slot if it reads as a
  // time of day, or if the caret is in it (the writer is typing there).
  const caretInTrailing = sepIdx >= 0 && caretOffset >= sepIdx + sepLen;
  const trailingUpper =
    sepIdx >= 0 ? fullText.slice(sepIdx + sepLen).trim().toUpperCase() : "";
  const trailingIsTime = TIME_OF_DAY.some(
    (t) => trailingUpper === t || trailingUpper.startsWith(t + " ") || t.startsWith(trailingUpper)
  );
  const hasTime = sepIdx >= 0 && (trailingIsTime || caretInTrailing);

  if (caretInTrailing) {
    // Trailing slot. Offer times, plus sub-locations when this is the first
    // separator (e.g. "INT. HOUSE - KIT" -> KITCHEN). query and replace span
    // both run to the caret, mirroring the original time behavior.
    const segStart = sepIdx + sepLen;
    const query = fullText.slice(segStart, caretOffset).trim().toUpperCase();
    const pool: Cand[] = TIME_OF_DAY.map((t) => ({ text: t, hint: "" }));
    if (sepCount === 1) {
      const parent = fullText.slice(prefixEnd, sepIdx).trim().toUpperCase();
      const le = outline.locations.find((l) => l.name === parent);
      const subs = new Set<string>([
        ...(le?.subLocations ?? []),
        ...COMMON_SUBLOCATIONS,
      ]);
      for (const s of subs) pool.push({ text: s, hint: "room" });
    }
    const items = rankCandidates(query, pool);
    if (items.length === 0) return closed(lineStart);
    return open(items, lineStart + segStart, lineStart + caretOffset, lineStart);
  }

  // Location segment: prefix end to the time separator (or end of line). The
  // query is the WHOLE segment so query and replace range share a boundary and
  // nothing after the caret is clobbered.
  const locEnd = hasTime ? sepIdx : fullText.length;
  const query = fullText.slice(prefixEnd, locEnd).trim().toUpperCase();
  if (!query) return closed(lineStart);
  const pool: Cand[] = outline.locations.map((l) => ({
    text: l.name,
    hint: l.scenes === 1 ? "1 scene" : `${l.scenes} scenes`,
    freq: l.scenes,
    recency: l.lastIndex,
  }));
  const items = rankCandidates(query, pool, { fuzzy: true });
  if (items.length === 0) return closed(lineStart);
  return open(items, lineStart + prefixEnd, lineStart + locEnd, lineStart);
}

/** Build the open/closed plugin state from the current selection and outline. */
function compute(state: EditorState, getOutline: () => Outline): AcPluginState {
  const sel = state.selection;
  if (!sel.empty) return CLOSED;

  const line = lineAt(sel.$from);
  if (!line) return CLOSED;

  const element = line.node.attrs.element as ElementType;
  if (
    element !== "scene_heading" &&
    element !== "character" &&
    element !== "transition" &&
    element !== "action"
  )
    return CLOSED;

  const lineStart = line.pos + 1; // first text position inside the line
  const caretOffset = sel.$from.parentOffset; // char index within the line
  const fullText = line.node.textContent;
  const outline = getOutline();

  switch (element) {
    case "character":
      return computeCharacter(fullText, caretOffset, lineStart, outline);
    case "transition":
      return computeTransition(fullText, caretOffset, lineStart, outline);
    case "action":
      return computeAction(fullText, caretOffset, lineStart);
    default:
      return computeSceneHeading(fullText, caretOffset, lineStart, outline);
  }
}

/** Accept the suggestion at `index`, replacing the relevant text segment. */
export function acceptAutocomplete(view: EditorView, index: number): boolean {
  const st = autocompleteKey.getState(view.state);
  if (!st || !st.open || index < 0 || index >= st.items.length) return false;
  const item = st.items[index];
  const tr = view.state.tr.insertText(item.text, st.replaceFrom, st.replaceTo);

  // Promote the line's element in the SAME transaction (one undo step) when the
  // chosen item asks for it, e.g. accepting a transition typed on an action line.
  if (item.retypeTo) {
    const nodePos = st.lineStart - 1;
    const node = view.state.doc.nodeAt(nodePos);
    if (node && node.type.name === "screenplayLine") {
      tr.setNodeMarkup(nodePos, undefined, { ...node.attrs, element: item.retypeTo });
    }
  }

  const caret = st.replaceFrom + item.text.length;
  tr.setSelection(TextSelection.create(tr.doc, caret));
  tr.setMeta(autocompleteKey, { open: false, items: [] });
  view.dispatch(tr);
  view.focus();
  return true;
}

/**
 * Build the autocomplete extension. priority 200 puts its keydown handler ahead
 * of the screenplay keymap, but it only consumes keys while the menu is open,
 * so Enter / Tab / Mod-number keep their normal behavior otherwise.
 */
export function buildAutocomplete(
  getOutline: () => Outline,
  onState?: (s: AcState | null) => void
): Extension {
  return Extension.create({
    name: "screenplayAutocomplete",
    priority: 200,
    addProseMirrorPlugins() {
      return [
        new Plugin<AcPluginState>({
          key: autocompleteKey,
          state: {
            init: () => CLOSED,
            apply(tr, prev, _old, newState) {
              const meta = tr.getMeta(autocompleteKey) as Partial<AcPluginState> | undefined;
              if (meta) return { ...prev, ...meta };
              return compute(newState, getOutline);
            },
          },
          props: {
            handleKeyDown(view, event) {
              const st = autocompleteKey.getState(view.state);
              if (!st || !st.open || st.items.length === 0) return false;
              const n = st.items.length;
              // Stop the key from bubbling to the window-level Escape handlers
              // (focus mode, find panel) once the menu has consumed it.
              const consume = () => event.stopPropagation();
              switch (event.key) {
                case "ArrowDown":
                  consume();
                  view.dispatch(
                    view.state.tr
                      .setMeta(autocompleteKey, { active: (st.active + 1) % n })
                      .setMeta("addToHistory", false)
                  );
                  return true;
                case "ArrowUp":
                  consume();
                  view.dispatch(
                    view.state.tr
                      .setMeta(autocompleteKey, { active: (st.active - 1 + n) % n })
                      .setMeta("addToHistory", false)
                  );
                  return true;
                case "Tab":
                  // Shift+Tab must still cycle the element type backward.
                  if (event.shiftKey) return false;
                  consume();
                  return acceptAutocomplete(view, st.active);
                case "Enter":
                  // Let modified Enter fall through to the keymap / default.
                  if (event.shiftKey || event.metaKey || event.ctrlKey || event.altKey)
                    return false;
                  consume();
                  return acceptAutocomplete(view, st.active);
                case "Escape":
                  consume();
                  view.dispatch(
                    view.state.tr
                      .setMeta(autocompleteKey, { open: false, items: [] })
                      .setMeta("addToHistory", false)
                  );
                  return true;
                default:
                  return false;
              }
            },
          },
          view(editorView) {
            // TipTap calls plugin view updates on every React re-render, so we
            // dedupe: only notify React when the snapshot actually changed.
            // Otherwise pushing a fresh object each render would loop
            // (setState -> render -> view update -> setState) while open.
            let last = "null";
            const push = () => {
              const st = autocompleteKey.getState(editorView.state);
              let next: AcState | null = null;
              if (st && st.open && st.items.length > 0) {
                try {
                  const c = editorView.coordsAtPos(editorView.state.selection.head);
                  next = {
                    open: true,
                    items: st.items,
                    active: st.active,
                    coords: { left: c.left, top: c.top, bottom: c.bottom },
                    replaceFrom: st.replaceFrom,
                    replaceTo: st.replaceTo,
                  };
                } catch {
                  next = null;
                }
              }
              const sig = next ? JSON.stringify(next) : "null";
              if (sig === last) return;
              last = sig;
              onState?.(next);
            };
            // Re-anchor the menu when the page scrolls or the window resizes;
            // those do not dispatch a transaction, so the cached caret coords
            // would otherwise go stale and the dropdown would detach.
            const scroller =
              editorView.dom.closest(".page-scroll") ?? (window as unknown as HTMLElement);
            const reposition = () => push();
            scroller.addEventListener("scroll", reposition, { passive: true });
            window.addEventListener("resize", reposition);

            push();
            return {
              update: () => push(),
              destroy: () => {
                scroller.removeEventListener("scroll", reposition);
                window.removeEventListener("resize", reposition);
                if (last !== "null") onState?.(null);
              },
            };
          },
        }),
      ];
    },
  });
}
