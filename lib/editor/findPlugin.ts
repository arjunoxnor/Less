import { Extension, getChangedRanges } from "@tiptap/core";
import { Plugin, PluginKey, TextSelection, type Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import type { Node as PMNode } from "@tiptap/pm/model";
import { changedTopLevelNodes } from "./changedRanges";

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
const MAX_DECORATIONS = 1000;

function matchesInLine(
  node: PMNode,
  offset: number,
  query: string,
  opts: FindOpts
): Match[] {
  if (!query || node.type.name !== "screenplayLine") return [];
  const scope = opts.element && opts.element !== "all" ? opts.element : null;
  if (scope && node.attrs.element !== scope) return [];

  const matches: Match[] = [];
  const needle = opts.caseSensitive ? query : query.toLowerCase();
  const raw = node.textContent;
  const hay = opts.caseSensitive ? raw : raw.toLowerCase();
  const nlen = needle.length;
  let index = hay.indexOf(needle);
  while (index !== -1) {
    const before = index > 0 ? hay[index - 1] : undefined;
    const after = index + nlen < hay.length ? hay[index + nlen] : undefined;
    const wordOk = !opts.wholeWord || (!isWordChar(before) && !isWordChar(after));
    if (wordOk) {
      const from = offset + 1 + index;
      matches.push({ from, to: from + nlen });
    }
    index = hay.indexOf(needle, index + nlen);
  }
  return matches;
}

/** All non-overlapping matches of `query` within the lines of `doc`. */
export function findMatches(doc: PMNode, query: string, opts: FindOpts): Match[] {
  if (!query) return [];
  const matches: Match[] = [];
  doc.forEach((node, offset) => {
    matches.push(...matchesInLine(node, offset, query, opts));
  });
  return matches;
}

function matchKey(match: Match): string {
  return `${match.from}:${match.to}`;
}

function visibleMatches(matches: Match[], active: number): Match[] {
  const visible = matches.slice(0, MAX_DECORATIONS);
  if (active >= MAX_DECORATIONS && matches[active]) visible.push(matches[active]);
  return visible;
}

function buildDeco(doc: PMNode, matches: Match[], active: number): DecorationSet {
  return DecorationSet.create(
    doc,
    visibleMatches(matches, active).map((match) =>
      Decoration.inline(
        match.from,
        match.to,
        {
          class: match === matches[active] ? "find-mark find-mark-active" : "find-mark",
        },
        { findActive: match === matches[active] }
      )
    )
  );
}

/**
 * Keep the mapped decoration tree and reconcile only membership/active styling.
 * At most MAX_DECORATIONS entries are inspected; unchanged marks retain their
 * Decoration objects instead of rebuilding a thousand DOM decorations per key.
 */
function reconcileDeco(
  doc: PMNode,
  mapped: DecorationSet,
  matches: Match[],
  active: number
): DecorationSet {
  const desired = visibleMatches(matches, active);
  const desiredKeys = new Set(desired.map(matchKey));
  const activeKey = matches[active] ? matchKey(matches[active]) : null;
  const current = mapped.find();
  const remove = current.filter((deco) => {
    const key = matchKey(deco);
    return (
      !desiredKeys.has(key) ||
      key === activeKey ||
      (deco.spec as { findActive?: boolean }).findActive === true
    );
  });
  let next = remove.length ? mapped.remove(remove) : mapped;
  const currentKeys = new Set(next.find().map((deco) => matchKey(deco)));
  const additions: Decoration[] = [];
  for (const match of desired) {
    const key = matchKey(match);
    if (currentKeys.has(key)) continue;
    const isActive = key === activeKey;
    additions.push(
      Decoration.inline(
        match.from,
        match.to,
        { class: isActive ? "find-mark find-mark-active" : "find-mark" },
        { findActive: isActive }
      )
    );
  }
  if (additions.length) next = next.add(doc, additions);
  return next;
}

function spanContains(span: [number, number], match: Match): boolean {
  return match.from >= span[0] && match.to <= span[1];
}

/** Rescan only top-level lines touched by an edit and map every other match. */
function updateMatches(
  transaction: Transaction,
  oldDoc: PMNode,
  newDoc: PMNode,
  previous: Match[],
  query: string,
  opts: FindOpts
): Match[] {
  const changes = getChangedRanges(transaction);
  if (!changes.length) {
    return previous.map((match) => ({
      from: transaction.mapping.map(match.from, 1),
      to: transaction.mapping.map(match.to, -1),
    }));
  }

  const oldRanges = changes.map(
    (change) => [change.oldRange.from, change.oldRange.to] as [number, number]
  );
  const newRanges = changes.map(
    (change) => [change.newRange.from, change.newRange.to] as [number, number]
  );
  const oldSpans = changedTopLevelNodes(oldDoc, oldRanges).map(
    ({ node, pos }) => [pos, pos + node.nodeSize] as [number, number]
  );
  const kept = previous
    .filter((match) => !oldSpans.some((span) => spanContains(span, match)))
    .map((match) => ({
      from: transaction.mapping.map(match.from, 1),
      to: transaction.mapping.map(match.to, -1),
    }));
  for (const { node, pos } of changedTopLevelNodes(newDoc, newRanges)) {
    kept.push(...matchesInLine(node, pos, query, opts));
  }
  kept.sort((a, b) => a.from - b.from || a.to - b.to);
  return kept.filter(
    (match, index) =>
      index === 0 ||
      match.from !== kept[index - 1].from ||
      match.to !== kept[index - 1].to
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
          apply(tr, prev, oldState, newState) {
            const meta = tr.getMeta(findPluginKey) as Partial<FindState> | undefined;
            let next = prev;
            let searchChanged = false;
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
              searchChanged = queryChanged || caseChanged || wordChanged || elementChanged;
              if (searchChanged) {
                next.active = 0;
              }
            }

            const opts = {
              caseSensitive: next.caseSensitive,
              wholeWord: next.wholeWord,
              element: next.element,
            };
            if (searchChanged) {
              const matches = findMatches(newState.doc, next.query, opts);
              const active = matches.length
                ? Math.min(Math.max(next.active, 0), matches.length - 1)
                : 0;
              next = { ...next, matches, active, deco: buildDeco(newState.doc, matches, active) };
            } else if (tr.docChanged) {
              const matches = updateMatches(
                tr,
                oldState.doc,
                newState.doc,
                prev.matches,
                next.query,
                opts
              );
              const active = matches.length
                ? Math.min(Math.max(next.active, 0), matches.length - 1)
                : 0;
              const mapped = prev.deco.map(tr.mapping, tr.doc);
              next = {
                ...next,
                matches,
                active,
                deco: reconcileDeco(newState.doc, mapped, matches, active),
              };
            } else if (meta) {
              const active = next.matches.length
                ? Math.min(Math.max(next.active, 0), next.matches.length - 1)
                : 0;
              next = {
                ...next,
                active,
                deco: reconcileDeco(newState.doc, prev.deco, next.matches, active),
              };
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
