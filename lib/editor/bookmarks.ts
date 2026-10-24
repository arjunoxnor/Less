import { Extension } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, TextSelection, type EditorState, type Transaction } from "@tiptap/pm/state";
import { finalChangedRanges } from "./changedRanges";
import { SKIP_REVISION_META } from "./revisions";
import {
  BOOKMARK_COLORS,
  BOOKMARK_NAME_MAX,
  bookmarkHex,
  cleanBookmarkName,
  isBookmarkColor,
  sanitizeBookmark,
  type Bookmark,
  type BookmarkColor,
} from "./bookmarkCore";

/**
 * Bookmarks: a coloured flag on a line, so a place being worked on is one
 * click away. A bookmark lives on its line as a sparse attribute (null on
 * every other line), so it moves with the line as text is written above it,
 * syncs and travels in history with the document, and never touches the
 * screenplay text or any export.
 *
 * Each bookmark carries a short id, so that when Enter splits a bookmarked
 * line the copy the split made is found and removed: the bookmark stays with
 * the text it was on (the first half, or the second when the split was at the
 * very start of the line). A pasted line never brings a bookmark with it.
 */

export { BOOKMARK_COLORS, BOOKMARK_NAME_MAX, bookmarkHex, cleanBookmarkName, isBookmarkColor, sanitizeBookmark };
export type { Bookmark, BookmarkColor };

export interface BookmarkEntry {
  /** The position before the bookmarked line, and after it. */
  pos: number;
  end: number;
  bookmark: Bookmark;
  /** The line's text (up to 120 characters). */
  text: string;
}

export function newBookmarkId(): string {
  let id = "";
  while (id.length < 8) id += Math.random().toString(36).slice(2);
  return id.slice(0, 8);
}

/** Every bookmarked line in a document, top to bottom. */
export function listBookmarks(doc: PMNode): BookmarkEntry[] {
  const out: BookmarkEntry[] = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    const bookmark = node.attrs.bookmark ? sanitizeBookmark(node.attrs.bookmark) : null;
    if (bookmark) out.push({ pos, end: pos + node.nodeSize, bookmark, text: node.textContent.slice(0, 120) });
    return false;
  });
  return out;
}

const sameEntries = (a: BookmarkEntry[], b: BookmarkEntry[]) =>
  a.length === b.length &&
  a.every((x, i) => {
    const y = b[i];
    return (
      x.pos === y.pos &&
      x.end === y.end &&
      x.text === y.text &&
      x.bookmark.id === y.bookmark.id &&
      x.bookmark.color === y.bookmark.color &&
      x.bookmark.name === y.bookmark.name
    );
  });

export const bookmarksKey = new PluginKey<BookmarkEntry[]>("bookmarks");

/** The document's bookmarks (the same array until one of them changes). */
export const bookmarksOf = (state: EditorState): BookmarkEntry[] => bookmarksKey.getState(state) ?? [];

/** The bookmarkable line holding a position: the innermost text line of an allowed type. */
function lineAt(state: EditorState, types: readonly string[], at?: number): { pos: number; node: PMNode } | null {
  if (at != null) {
    const node = state.doc.nodeAt(at);
    return node && types.includes(node.type.name) ? { pos: at, node } : null;
  }
  const $from = state.selection.$from;
  for (let d = $from.depth; d > 0; d--) {
    const node = $from.node(d);
    if (types.includes(node.type.name)) return { pos: $from.before(d), node };
  }
  return null;
}

/** The colour the last bookmark was given: the next one starts with it. */
let lastColor: BookmarkColor = "red";
export const lastBookmarkColor = () => lastColor;

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    bookmarks: {
      /** Bookmark a line (the caret's, or the one at pos), or recolour or rename its bookmark. */
      setBookmark: (attrs?: { color?: BookmarkColor; name?: string }, pos?: number) => ReturnType;
      /** Take the bookmark off a line (the caret's, or the one at pos). */
      removeBookmark: (pos?: number) => ReturnType;
      /** Bookmark the caret's line, or take its bookmark off. */
      toggleBookmark: () => ReturnType;
    };
  }
}

/** A remote collaborator's change: their editor already tidied it. */
const isRemote = (tr: Transaction) =>
  !!(tr.getMeta("y-sync$") as { isChangeOrigin?: boolean } | undefined)?.isChangeOrigin;

export const Bookmarks = Extension.create<{ types: string[] }>({
  name: "bookmarks",
  // Ahead of StarterKit's Mod-Shift-b (block quote) in documents.
  priority: 150,

  addOptions() {
    return { types: ["paragraph", "heading"] };
  },

  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: {
          bookmark: {
            default: null,
            // A new line made by Enter starts unmarked.
            keepOnSplit: false,
            // Never read back from HTML, so pasting never brings one in
            // (documents load from JSON, which keeps it).
            parseHTML: () => null,
            renderHTML: (attrs) => {
              const b = attrs.bookmark ? sanitizeBookmark(attrs.bookmark) : null;
              return b ? { "data-bookmark": b.color } : {};
            },
          },
        },
      },
    ];
  },

  addCommands() {
    const types = this.options.types;
    return {
      setBookmark:
        (attrs = {}, at) =>
        ({ state, tr, dispatch }) => {
          const line = lineAt(state, types, at);
          if (!line) return false;
          const old = sanitizeBookmark(line.node.attrs.bookmark);
          const color = attrs.color ?? old?.color ?? lastColor;
          const next: Bookmark = {
            id: old?.id ?? newBookmarkId(),
            color,
            name: attrs.name != null ? cleanBookmarkName(attrs.name) : old?.name ?? "",
          };
          if (old && old.color === next.color && old.name === next.name) return true;
          if (attrs.color) lastColor = attrs.color;
          if (dispatch) {
            tr.setNodeMarkup(line.pos, undefined, { ...line.node.attrs, bookmark: next });
            tr.setMeta(SKIP_REVISION_META, true);
          }
          return true;
        },
      removeBookmark:
        (at) =>
        ({ state, tr, dispatch }) => {
          const line = lineAt(state, types, at);
          if (!line || !line.node.attrs.bookmark) return false;
          if (dispatch) {
            tr.setNodeMarkup(line.pos, undefined, { ...line.node.attrs, bookmark: null });
            tr.setMeta(SKIP_REVISION_META, true);
          }
          return true;
        },
      toggleBookmark:
        () =>
        ({ state, commands }) => {
          const line = lineAt(state, types);
          if (!line) return false;
          return line.node.attrs.bookmark ? commands.removeBookmark() : commands.setBookmark();
        },
    };
  },

  addKeyboardShortcuts() {
    return {
      // B for bookmark. Always handled on a line, so the browser's own
      // Ctrl+Shift+B (its bookmarks bar) never fires from the page.
      "Mod-Shift-b": () => this.editor.commands.toggleBookmark(),
    };
  },

  addProseMirrorPlugins() {
    return [
      new Plugin<BookmarkEntry[]>({
        key: bookmarksKey,
        state: {
          init: (_, state) => listBookmarks(state.doc),
          apply: (tr, prev) => {
            if (!tr.docChanged) return prev;
            const next = listBookmarks(tr.doc);
            return sameEntries(prev, next) ? prev : next;
          },
        },
        // A split copies the line's bookmark onto both halves: keep it on the
        // half with the text it was on, take the copy off the other.
        appendTransaction: (transactions, _old, state) => {
          const ranges = finalChangedRanges(transactions, (tr) => tr.docChanged && !isRemote(tr));
          if (!ranges.length) return null;
          const size = state.doc.content.size;
          const byId = new Map<string, Map<number, PMNode>>();
          for (const [from, to] of ranges) {
            state.doc.nodesBetween(Math.max(0, from - 1), Math.min(size, to + 1), (node, pos) => {
              if (!node.isTextblock) return true;
              const id = (node.attrs.bookmark as { id?: unknown } | null)?.id;
              if (typeof id === "string") {
                if (!byId.has(id)) byId.set(id, new Map());
                byId.get(id)!.set(pos, node);
              }
              return false;
            });
          }
          let tr: Transaction | null = null;
          for (const lines of byId.values()) {
            if (lines.size < 2) continue;
            const ordered = [...lines.entries()].sort((a, b) => a[0] - b[0]);
            const keep = ordered.find(([, node]) => node.content.size > 0) ?? ordered[0];
            for (const [pos, node] of ordered) {
              if (pos === keep[0]) continue;
              tr ??= state.tr;
              tr.setNodeMarkup(pos, undefined, { ...node.attrs, bookmark: null });
            }
          }
          return tr ? tr.setMeta(SKIP_REVISION_META, true) : null;
        },
      }),
    ];
  },
});

/** Put the caret on a bookmarked line and bring it to a third of the way down. */
export function jumpToBookmark(view: import("@tiptap/pm/view").EditorView, pos: number): void {
  const doc = view.state.doc;
  if (pos < 0 || pos >= doc.content.size) return;
  const sel = TextSelection.near(doc.resolve(Math.min(doc.content.size, pos + 1)));
  view.dispatch(view.state.tr.setSelection(sel).setMeta("addToHistory", false));
  view.focus();
  const box = view.dom.closest<HTMLElement>(".page-scroll");
  if (!box) return;
  try {
    const caret = view.coordsAtPos(sel.head);
    const frame = box.getBoundingClientRect();
    box.scrollTo({ top: box.scrollTop + caret.top - frame.top - frame.height * 0.33, behavior: "smooth" });
  } catch {
    /* not laid out: the caret is there, scrolled or not */
  }
}
