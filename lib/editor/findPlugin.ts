import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import type { Node as PMNode } from "@tiptap/pm/model";

/**
 * Find and replace, built as a ProseMirror plugin that keeps ALL match state
 * (query, matches, active index, decorations) in plugin state. React owns only
 * the query / replacement / case-sensitivity inputs and reads the match count
 * and active index back out. Matches are plain (non-regex) substrings within a
 * single screenplayLine; they never span lines.
 */

export interface FindOpts {
  caseSensitive: boolean;
  wholeWord?: boolean;
  /** Restrict matches to one element type; empty/"all" searches everything. */
  element?: string;
}
export interface Match {
  from: number;
  to: number;
}
export interface FindState {
  query: string;
  caseSensitive: boolean;
  wholeWord: boolean;
  element: string;
  active: number;
  matches: Match[];
  deco: DecorationSet;
}

/** A word character for whole-word boundary checks (letters, digits, _). */
function isWordChar(ch: string | undefined): boolean {
  return !!ch && /[\p{L}\p{N}_]/u.test(ch);
}

export const findPluginKey = new PluginKey<FindState>("screenplayFind");

/** Keep the decoration tree bounded while retaining the complete match list. */
const MAX_DECORATIONS = 5000;

/** All non-overlapping matches of `query` within the lines of `doc`. */
export function findMatches(doc: PMNode, query: string, opts: FindOpts): Match[] {
  if (!query) return [];
  const matches: Match[] = [];
  const needle = opts.caseSensitive ? query : query.toLowerCase();
  const nlen = needle.length;

  const scope = opts.element && opts.element !== "all" ? opts.element : null;

  doc.forEach((node, offset) => {
    if (node.type.name !== "screenplayLine") return;
    if (scope && node.attrs.element !== scope) return;
    const raw = node.textContent;
    const hay = opts.caseSensitive ? raw : raw.toLowerCase();
    let i = hay.indexOf(needle);
    while (i !== -1) {
      const before = i > 0 ? hay[i - 1] : undefined;
      const after = i + nlen < hay.length ? hay[i + nlen] : undefined;
      const wordOk = !opts.wholeWord || (!isWordChar(before) && !isWordChar(after));
      if (wordOk) {
        const from = offset + 1 + i;
        matches.push({ from, to: from + nlen });
      }
      i = hay.indexOf(needle, i + nlen); // non-overlapping
    }
  });
  return matches;
}

function buildDeco(doc: PMNode, matches: Match[], active: number): DecorationSet {
  const visible = matches.slice(0, MAX_DECORATIONS).map((match, index) => ({
    match,
    index,
  }));
  if (active >= MAX_DECORATIONS && matches[active]) {
    visible.push({ match: matches[active], index: active });
  }
  return DecorationSet.create(
    doc,
    visible.map(({ match, index }) =>
      Decoration.inline(match.from, match.to, {
        class: index === active ? "find-mark find-mark-active" : "find-mark",
      })
    )
  );
}

export const FindReplace = Extension.create({
  name: "screenplayFind",
  addProseMirrorPlugins() {
    return [
      new Plugin<FindState>({
        key: findPluginKey,
        state: {
          init: () => ({
            query: "",
            caseSensitive: false,
            wholeWord: false,
            element: "all",
            active: 0,
            matches: [],
            deco: DecorationSet.empty,
          }),
          apply(tr, prev, _old, newState) {
            const meta = tr.getMeta(findPluginKey) as Partial<FindState> | undefined;
            let next = prev;
            if (meta) {
              next = { ...prev, ...meta };
              // A changed query / option resets the cursor to the first match.
              const queryChanged =
                meta.query !== undefined && meta.query !== prev.query;
              const caseChanged =
                meta.caseSensitive !== undefined &&
                meta.caseSensitive !== prev.caseSensitive;
              const wordChanged =
                meta.wholeWord !== undefined && meta.wholeWord !== prev.wholeWord;
              const elementChanged =
                meta.element !== undefined && meta.element !== prev.element;
              if (queryChanged || caseChanged || wordChanged || elementChanged) {
                next.active = 0;
              }
            }

            if (meta || tr.docChanged) {
              const matches = findMatches(newState.doc, next.query, {
                caseSensitive: next.caseSensitive,
                wholeWord: next.wholeWord,
                element: next.element,
              });
              const active = matches.length
                ? Math.min(Math.max(next.active, 0), matches.length - 1)
                : 0;
              next = { ...next, matches, active, deco: buildDeco(newState.doc, matches, active) };
            } else {
              // Cheap path on selection-only changes: keep highlights mapped.
              next = { ...next, deco: prev.deco.map(tr.mapping, tr.doc) };
            }
            return next;
          },
        },
        props: {
          decorations(state) {
            return findPluginKey.getState(state)?.deco ?? DecorationSet.empty;
          },
        },
      }),
    ];
  },
});

/** Update the search inputs (does not move the caret or touch history). */
export function setFindQuery(
  view: EditorView,
  patch: Partial<Pick<FindState, "query" | "caseSensitive" | "wholeWord" | "element" | "active">>
): void {
  view.dispatch(view.state.tr.setMeta(findPluginKey, patch).setMeta("addToHistory", false));
}

/** The nearest scrollable ancestor of the editor (the `.page-scroll` viewport). */
function scrollParent(el: HTMLElement | null): HTMLElement | null {
  let n: HTMLElement | null = el;
  while (n && n !== document.body) {
    const oy = getComputedStyle(n).overflowY;
    if ((oy === "auto" || oy === "scroll") && n.scrollHeight > n.clientHeight) return n;
    n = n.parentElement;
  }
  return null;
}

/**
 * Scroll a document position to the center of the editor's scroll viewport.
 * ProseMirror's own transaction `.scrollIntoView()` does not move the paginated
 * container reliably when focus is on the Find panel rather than the editor, so
 * we scroll from the match's measured DOM coordinates instead.
 */
export function scrollPosToCenter(view: EditorView, pos: number): void {
  const scroller = scrollParent(view.dom as HTMLElement);
  if (!scroller) return;
  let coords: { top: number; bottom: number };
  try {
    coords = view.coordsAtPos(pos);
  } catch {
    return;
  }
  const sRect = scroller.getBoundingClientRect();
  const matchMid = (coords.top + coords.bottom) / 2;
  const delta = matchMid - (sRect.top + scroller.clientHeight / 2);
  // Only scroll when the match is not already comfortably inside the viewport.
  if (coords.top < sRect.top + 60 || coords.bottom > sRect.bottom - 60) {
    scroller.scrollTo({ top: scroller.scrollTop + delta, behavior: "smooth" });
  }
}

/** Make `index` (wrapped) the active match and scroll it into view. */
export function gotoMatch(view: EditorView, index: number): void {
  const s = findPluginKey.getState(view.state);
  if (!s || s.matches.length === 0) return;
  const len = s.matches.length;
  const i = ((index % len) + len) % len;
  const m = s.matches[i];
  view.dispatch(
    view.state.tr
      .setMeta(findPluginKey, { active: i })
      .setMeta("addToHistory", false)
      .setSelection(TextSelection.create(view.state.doc, m.from, m.to))
      .scrollIntoView()
  );
  scrollPosToCenter(view, m.from);
}

/** Replace the active match, then advance to the next match past the insertion. */
export function replaceOne(view: EditorView, replaceText: string): boolean {
  const s = findPluginKey.getState(view.state);
  if (!s || s.matches.length === 0) return false;
  const m = s.matches[s.active];
  // Position just past the inserted text in the new document.
  const after = m.from + replaceText.length;
  view.dispatch(view.state.tr.insertText(replaceText, m.from, m.to));

  // Advance to the first match at/after the insertion so a replacement that
  // itself contains the query (e.g. "a" -> "aa") does not get stuck in place.
  const s2 = findPluginKey.getState(view.state);
  if (s2 && s2.matches.length > 0) {
    let idx = s2.matches.findIndex((mm) => mm.from >= after);
    if (idx === -1) idx = 0; // wrap to the first match
    const next = s2.matches[idx];
    view.dispatch(
      view.state.tr
        .setMeta(findPluginKey, { active: idx })
        .setMeta("addToHistory", false)
        .setSelection(TextSelection.create(view.state.doc, next.from, next.to))
        .scrollIntoView()
    );
    scrollPosToCenter(view, next.from);
  }
  return true;
}

/** Replace every match in a single undo step; returns how many. */
export function replaceAll(view: EditorView, replaceText: string): number {
  const s = findPluginKey.getState(view.state);
  if (!s || s.matches.length === 0) return 0;
  const tr = view.state.tr;
  // Apply last-to-first so earlier positions stay valid as we edit.
  for (let i = s.matches.length - 1; i >= 0; i--) {
    const m = s.matches[i];
    tr.insertText(replaceText, m.from, m.to);
  }
  view.dispatch(tr);
  return s.matches.length;
}
