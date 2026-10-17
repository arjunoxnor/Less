import { Extension, Node, mergeAttributes, type Editor, type JSONContent } from "@tiptap/core";
import { NodeSelection, Plugin, PluginKey, type EditorState } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";

/**
 * The three blocks that make a BOARD: a document for looking at things rather
 * than reading them. References, storyboards, palettes, style frames.
 *
 *   figure   one image with an editable caption (the caption is the node's own
 *            inline content, so it takes marks and needs no custom node view),
 *            and a check mark the writer can tick: "I like this one". A wall of
 *            references is only useful once it has been voted on, and the votes
 *            live in the document, so whoever built the wall can read them back.
 *            A picture comes off the board three ways: its remove button, a
 *            click on it and then Backspace or Delete, or Backspace from the
 *            start of its caption (which first selects it). Undo puts it back.
 *   board    a grid of figures, 2 to 6 columns: a reference wall, or a row of
 *            storyboard panels whose captions are the shot descriptions
 *   palette  a strip of named colors
 *
 * They are added to the plain schema only for the "board" project type (see
 * buildPlainExtensions), so ordinary documents, their paginator, and their
 * exporters never meet them.
 *
 * An image is a LINK, never bytes: a document body lives in localStorage and in
 * one D1 row, neither of which can hold pictures. The link is either an upload
 * (/api/assets/<id>, rules in lib/server/assets.ts) or an https URL. Anything
 * else is treated as no image at all, which also keeps a hostile imported body
 * from pointing the page at javascript: or data: URLs.
 */

export const ASSET_SRC = /^\/api\/assets\/[a-f0-9]{32}$/;

export function safeImageSrc(value: unknown): string {
  if (typeof value !== "string") return "";
  const src = value.trim();
  if (ASSET_SRC.test(src)) return src;
  try {
    const url = new URL(src);
    return url.protocol === "https:" ? url.toString() : "";
  } catch {
    return "";
  }
}

export interface Swatch {
  hex: string;
  name: string;
}

export function safeHex(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(v)) return v.toLowerCase();
  if (/^#[0-9a-fA-F]{3}$/.test(v)) {
    return ("#" + v[1] + v[1] + v[2] + v[2] + v[3] + v[3]).toLowerCase();
  }
  return null;
}

export const MAX_SWATCHES = 12;

export function cleanSwatches(value: unknown): Swatch[] {
  if (!Array.isArray(value)) return [];
  const out: Swatch[] = [];
  for (const item of value) {
    const hex = safeHex((item as Swatch | null)?.hex);
    if (!hex) continue;
    const name = String((item as Swatch | null)?.name ?? "").trim().slice(0, 40);
    out.push({ hex, name });
    if (out.length === MAX_SWATCHES) break;
  }
  return out;
}

/** "#e8b04a Steppe gold", one per line: the palette's editing format. */
export function swatchesToText(colors: Swatch[]): string {
  return colors.map((c) => (c.name ? `${c.hex} ${c.name}` : c.hex)).join("\n");
}

export function swatchesFromText(text: string): Swatch[] {
  return cleanSwatches(
    text.split(/\r?\n/).map((line) => {
      const m = line.trim().match(/^(#[0-9a-fA-F]{3,6})\s*(.*)$/);
      return m ? { hex: m[1], name: m[2] } : null;
    })
  );
}

export const clampColumns = (value: unknown): number => {
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? Math.min(6, Math.max(2, n)) : 3;
};

const positiveInt = (value: unknown): number | null => {
  const n = Math.round(Number(value));
  return Number.isFinite(n) && n > 0 && n < 100000 ? n : null;
};

export const Figure = Node.create({
  name: "figure",
  group: "block",
  content: "inline*",
  draggable: true,
  isolating: true,

  addAttributes() {
    return {
      src: {
        default: "",
        rendered: false,
        parseHTML: (el: HTMLElement) =>
          safeImageSrc(el.querySelector("img")?.getAttribute("src") ?? ""),
      },
      alt: {
        default: "",
        rendered: false,
        parseHTML: (el: HTMLElement) => el.querySelector("img")?.getAttribute("alt") ?? "",
      },
      // Natural size, so the box holds its shape before the image loads and the
      // page does not jump under the writer as a wall of references streams in.
      width: {
        default: null,
        rendered: false,
        parseHTML: (el: HTMLElement) => positiveInt(el.querySelector("img")?.getAttribute("width")),
      },
      height: {
        default: null,
        rendered: false,
        parseHTML: (el: HTMLElement) => positiveInt(el.querySelector("img")?.getAttribute("height")),
      },
      liked: {
        default: false,
        rendered: false,
        parseHTML: (el: HTMLElement) => el.getAttribute("data-liked") === "true",
      },
    };
  },

  parseHTML() {
    return [{ tag: "figure[data-figure]", contentElement: "figcaption" }];
  },

  // The check mark and the remove button are plain DOM inside the figure, so
  // a click on them never reaches the document as an edit. This turns those
  // clicks into edits, makes a click on the picture select it (so Backspace or
  // Delete removes it), and marks the picture the writer is working in, which
  // is where its buttons and its caption hint show.
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("figureLike"),
        props: {
          handleDOMEvents: {
            mousedown: (_view, event) => {
              if (!figureButtonOf(event.target)) return false;
              event.preventDefault(); // no node selection, no drag
              return true;
            },
            click: (view, event) => {
              const button = figureButtonOf(event.target);
              if (!button) return false;
              event.preventDefault();
              const figure = button.closest("figure[data-figure]");
              const caption = figure?.querySelector("figcaption");
              if (!caption) return true;
              const pos = view.posAtDOM(caption, 0);
              return button.classList.contains("brd-remove") ? removeFigureAt(view, pos) : toggleLikeAt(view, pos);
            },
          },
          handleClickOn: (view, _pos, node, nodePos, event) => {
            if (node.type.name !== "figure") return false;
            const target = event.target instanceof HTMLElement ? event.target : null;
            if (!target?.closest(".brd-media") || figureButtonOf(target)) return false;
            view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, nodePos)));
            return true;
          },
          decorations: (state) => {
            const at = figureAt(state, state.selection.from);
            if (!at) return null;
            return DecorationSet.create(state.doc, [
              Decoration.node(at.pos, at.pos + at.node.nodeSize, { class: "brd-figure-current" }),
            ]);
          },
        },
      }),
    ];
  },


  renderHTML({ node }) {
    const src = safeImageSrc(node.attrs.src);
    const width = positiveInt(node.attrs.width);
    const height = positiveInt(node.attrs.height);
    const media = src
      ? [
          "img",
          {
            src,
            alt: String(node.attrs.alt ?? ""),
            loading: "lazy",
            decoding: "async",
            draggable: "false",
            // A reference can be a picture on someone else's site. Do not tell
            // that site which private document is looking at it.
            referrerpolicy: "no-referrer",
            ...(width && height ? { width: String(width), height: String(height) } : {}),
          },
        ]
      : ["div", { class: "brd-empty", contenteditable: "false" }, "Drop an image here"];
    const liked = node.attrs.liked === true;
    const like = [
      "button",
      {
        type: "button",
        class: "brd-like",
        contenteditable: "false",
        tabindex: "-1",
        "aria-pressed": liked ? "true" : "false",
        "aria-label": liked ? "Liked. Click to undo" : "Like this one",
        title: liked ? "Liked. Click to undo" : "Like this one",
      },
    ];
    const remove = [
      "button",
      {
        type: "button",
        class: "brd-remove",
        contenteditable: "false",
        tabindex: "-1",
        "aria-label": "Remove this picture",
        title: "Remove this picture (Ctrl+Z puts it back)",
      },
    ];
    return [
      "figure",
      {
        "data-figure": "",
        ...(liked ? { "data-liked": "true" } : {}),
        class: src ? "brd-figure" : "brd-figure brd-figure-empty",
      },
      ["div", { class: "brd-media", contenteditable: "false" }, media, ...(src ? [like, remove] : [remove])],
      ["figcaption", { class: "brd-caption" }, 0],
    ];
  },
});

function figureButtonOf(target: EventTarget | null): HTMLElement | null {
  return target instanceof HTMLElement ? target.closest<HTMLElement>(".brd-like, .brd-remove") : null;
}

/** The figure at or around `pos`: selected as a whole, or holding the caret. */
export function figureAt(state: EditorState, pos: number): { pos: number; node: import("@tiptap/pm/model").Node } | null {
  const doc = state.doc;
  const at = Math.max(0, Math.min(pos, doc.content.size));
  const direct = doc.nodeAt(at);
  if (direct?.type.name === "figure" && state.selection instanceof NodeSelection && state.selection.from === at) {
    return { pos: at, node: direct };
  }
  const $pos = doc.resolve(at);
  for (let depth = $pos.depth; depth > 0; depth--) {
    if ($pos.node(depth).type.name === "figure") return { pos: $pos.before(depth), node: $pos.node(depth) };
  }
  return null;
}

/**
 * Take a picture off the board. The last picture in a grid takes the grid
 * with it (a grid cannot be empty), and a board is never left with no block
 * at all: an empty line stays, ready to type or drop into.
 */
export function removeFigureAt(view: EditorView, pos: number): boolean {
  const found = figureAt(view.state, pos);
  if (!found) return false;
  const doc = view.state.doc;
  const $figure = doc.resolve(found.pos);
  let from = found.pos;
  let to = found.pos + found.node.nodeSize;
  if ($figure.parent.type.name === "board" && $figure.parent.childCount === 1 && $figure.depth > 0) {
    from = $figure.before();
    to = $figure.after();
  }
  const tr = view.state.tr;
  const onlyBlock = from === 0 && to === doc.content.size;
  if (onlyBlock) tr.replaceWith(from, to, view.state.schema.nodes.paragraph.create());
  else tr.delete(from, to);
  view.dispatch(tr.scrollIntoView());
  view.focus();
  return true;
}

/** The picture the caret is in or that is selected, for the toolbar. */
export function currentFigure(editor: Editor): { pos: number } | null {
  const found = figureAt(editor.state, editor.state.selection.from);
  return found ? { pos: found.pos } : null;
}

/** Flip the check mark of the figure that contains `pos`. */
export function toggleLikeAt(view: EditorView, pos: number): boolean {
  const $pos = view.state.doc.resolve(Math.max(0, Math.min(pos, view.state.doc.content.size)));
  for (let depth = $pos.depth; depth > 0; depth--) {
    const node = $pos.node(depth);
    if (node.type.name !== "figure") continue;
    view.dispatch(
      view.state.tr.setNodeMarkup($pos.before(depth), undefined, {
        ...node.attrs,
        liked: node.attrs.liked !== true,
      })
    );
    return true;
  }
  return false;
}

/** How many pictures there are, and how many carry the check mark. */
export function likeTally(editor: Editor): { figures: number; liked: number } {
  let figures = 0;
  let liked = 0;
  editor.state.doc.descendants((node) => {
    if (node.type.name !== "figure" || !safeImageSrc(node.attrs.src)) return;
    figures++;
    if (node.attrs.liked === true) liked++;
  });
  return { figures, liked };
}

export const Board = Node.create({
  name: "board",
  group: "block",
  content: "figure+",
  defining: true,

  addAttributes() {
    return {
      columns: {
        default: 3,
        parseHTML: (el: HTMLElement) => clampColumns(el.getAttribute("data-cols")),
        renderHTML: (attrs: { columns?: unknown }) => {
          const cols = clampColumns(attrs.columns);
          return { "data-cols": String(cols), style: `--brd-cols:${cols}` };
        },
      },
    };
  },

  parseHTML() {
    return [{ tag: "div[data-board]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-board": "", class: "brd-grid" }), 0];
  },
});

export const Palette = Node.create({
  name: "palette",
  group: "block",
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      colors: {
        default: [],
        rendered: false,
        parseHTML: (el: HTMLElement) => {
          try {
            return cleanSwatches(JSON.parse(el.getAttribute("data-colors") || "[]"));
          } catch {
            return [];
          }
        },
      },
    };
  },

  parseHTML() {
    return [{ tag: "div[data-palette]" }];
  },

  renderHTML({ node }) {
    const colors = cleanSwatches(node.attrs.colors);
    return [
      "div",
      {
        "data-palette": "",
        "data-colors": JSON.stringify(colors),
        class: "brd-palette",
        contenteditable: "false",
      },
      ...colors.map((c) => [
        "div",
        { class: "brd-swatch" },
        ["span", { class: "brd-chip", style: `background:${c.hex}` }],
        ["span", { class: "brd-swatch-name" }, c.name || c.hex],
        ["span", { class: "brd-swatch-hex" }, c.hex],
      ]),
    ];
  },
});

/**
 * The keys that take a picture off the board, in an extension of their own:
 * they have to run before the paragraph keymaps (which would swallow a
 * Backspace at the start of a caption), and raising the figure node's own
 * priority would also move it ahead of paragraph in the schema, which would
 * make an empty board start as an empty picture frame.
 *
 * Backspace at the very start of a caption selects the picture (a second
 * Backspace removes it); with the picture selected, Backspace or Delete
 * removes it, along with its grid when it was the grid's last one.
 */
export const FigureKeys = Extension.create({
  name: "figureKeys",
  priority: 1100,

  addKeyboardShortcuts() {
    const removeSelected = () => {
      const { state, view } = this.editor;
      const sel = state.selection;
      if (!(sel instanceof NodeSelection) || sel.node.type.name !== "figure") return false;
      return removeFigureAt(view, sel.from);
    };
    return {
      Backspace: () => {
        if (removeSelected()) return true;
        const { state, view } = this.editor;
        const { selection } = state;
        if (!selection.empty || selection.$from.parent.type.name !== "figure" || selection.$from.parentOffset !== 0) {
          return false;
        }
        view.dispatch(state.tr.setSelection(NodeSelection.create(state.doc, selection.$from.before())));
        return true;
      },
      Delete: () => removeSelected(),
    };
  },
});

export const boardExtensions = [Figure, Board, Palette, FigureKeys];

/* --- Editing helpers ------------------------------------------------------ */

export interface PlacedImage {
  src: string;
  width?: number | null;
  height?: number | null;
  caption?: string;
}

function figureJson(image: PlacedImage): JSONContent {
  return {
    type: "figure",
    attrs: {
      src: safeImageSrc(image.src),
      alt: image.caption ?? "",
      width: image.width ?? null,
      height: image.height ?? null,
    },
    ...(image.caption ? { content: [{ type: "text", text: image.caption }] } : {}),
  };
}

/** Where a drop or an insert should land so the result is always valid: inside
 *  a grid it goes after the figure under the pointer; anywhere else it goes
 *  after the top-level block, never inside a paragraph or a caption. */
export function placementFor(editor: Editor, pos: number): { at: number; inBoard: boolean } {
  const size = editor.state.doc.content.size;
  const $pos = editor.state.doc.resolve(Math.max(0, Math.min(pos, size)));
  for (let depth = $pos.depth; depth > 0; depth--) {
    if ($pos.node(depth).type.name === "figure" && depth > 1 &&
        $pos.node(depth - 1).type.name === "board") {
      return { at: $pos.after(depth), inBoard: true };
    }
  }
  if ($pos.depth === 0) return { at: $pos.pos, inBoard: false };
  return { at: $pos.after(1), inBoard: false };
}

/** Insert uploaded images. One image becomes a figure; several become a grid,
 *  unless they are dropped into a grid that is already there. */
export function insertImages(editor: Editor, images: PlacedImage[], pos?: number): boolean {
  const usable = images.filter((i) => safeImageSrc(i.src));
  if (usable.length === 0) return false;
  const { at, inBoard } = placementFor(editor, pos ?? editor.state.selection.head);
  const figures = usable.map(figureJson);
  const content: JSONContent | JSONContent[] =
    inBoard || figures.length === 1
      ? figures
      : { type: "board", attrs: { columns: Math.min(4, Math.max(2, figures.length)) }, content: figures };
  return editor.chain().insertContentAt(at, content).run();
}

/** The grid the selection is in, if any. */
export function currentBoard(editor: Editor): { pos: number; columns: number } | null {
  const { $from } = editor.state.selection;
  for (let depth = $from.depth; depth > 0; depth--) {
    const node = $from.node(depth);
    if (node.type.name === "board") {
      return { pos: $from.before(depth), columns: clampColumns(node.attrs.columns) };
    }
  }
  const selected = editor.state.doc.nodeAt(editor.state.selection.from);
  if (selected?.type.name === "board") {
    return { pos: editor.state.selection.from, columns: clampColumns(selected.attrs.columns) };
  }
  return null;
}

export function setBoardColumns(editor: Editor, columns: number): boolean {
  const board = currentBoard(editor);
  if (!board) return false;
  return editor
    .chain()
    .command(({ tr }) => {
      tr.setNodeMarkup(board.pos, undefined, { columns: clampColumns(columns) });
      return true;
    })
    .run();
}

/** The palette under the selection, if any. */
export function currentPalette(editor: Editor): { pos: number; colors: Swatch[] } | null {
  const node = editor.state.doc.nodeAt(editor.state.selection.from);
  if (node?.type.name !== "palette") return null;
  return { pos: editor.state.selection.from, colors: cleanSwatches(node.attrs.colors) };
}

export function putPalette(editor: Editor, colors: Swatch[]): boolean {
  const clean = cleanSwatches(colors);
  if (clean.length === 0) return false;
  const existing = currentPalette(editor);
  if (existing) {
    return editor
      .chain()
      .command(({ tr }) => {
        tr.setNodeMarkup(existing.pos, undefined, { colors: clean });
        return true;
      })
      .run();
  }
  const { at } = placementFor(editor, editor.state.selection.head);
  return editor.chain().insertContentAt(at, { type: "palette", attrs: { colors: clean } }).run();
}
