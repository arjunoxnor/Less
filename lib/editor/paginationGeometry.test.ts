import { Editor, type JSONContent } from "@tiptap/core";
import Document from "@tiptap/extension-document";
import Text from "@tiptap/extension-text";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ScreenplayLine } from "./screenplayLine";
import { Pagination } from "./pagination";

/**
 * Contracts for the screenplay paginator's DOM measurement.
 *
 * Two regressions live here:
 *
 *  1. Pagination must decline to run when the editor has no layout. A hidden or
 *     collapsed column measures zero wide, every line wraps at one character,
 *     and a 682-word document once rendered as 114 sheets.
 *  2. Block geometry is cached by ProseMirror node identity, and node identity
 *     does not pin the DOM. The same node object comes back on a NEW element
 *     after a delete plus undo, and one node object can render at two positions
 *     after a duplicate paste. Measuring the stale element measures nothing:
 *     line boxes come back empty, every pass then forces the expensive full
 *     re-pass, mid-block splits stop happening (text runs past the bottom of
 *     the sheet), and the dead element stays pinned in memory.
 */

const LINE_TEXT =
  "The camera follows the traveller through the corridor with the silver revolver.";
const LINE_COUNT = 11;
/** 10 rendered rows per line: 110 rows against the 54-row sheet. */
const LINE_HEIGHT_PX = 160;

function docJSON(element: "action" | "scene_heading"): JSONContent {
  return {
    type: "doc",
    content: Array.from({ length: LINE_COUNT }, () => ({
      type: "screenplayLine",
      attrs: { element },
      content: [{ type: "text", text: LINE_TEXT }],
    })),
  };
}

const baseExtensions = [
  Document.extend({ content: "screenplayLine+" }),
  Text,
  ScreenplayLine,
];

/** jsdom has no layout engine, so stand in for one: a line that is in the
    document is ten rows tall, and a detached element has no layout at all,
    exactly as in a browser. */
function stubLayout(heightPx = LINE_HEIGHT_PX): () => void {
  const descriptor = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    "offsetHeight"
  );
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    get(this: HTMLElement) {
      if (!this.classList?.contains("sp-line")) return 0;
      return this.isConnected ? heightPx : 0;
    },
  });
  // jsdom's Range has no getClientRects at all. Returning none is the honest
  // stand-in for a document with no layout, and it is what the paginator's
  // "no usable line boxes" fallback already expects.
  const rangeProto = Range.prototype as unknown as {
    getClientRects?: () => DOMRect[];
  };
  const hadRects = "getClientRects" in Range.prototype;
  if (!hadRects) rangeProto.getClientRects = () => [];
  return () => {
    if (descriptor) {
      Object.defineProperty(HTMLElement.prototype, "offsetHeight", descriptor);
    } else {
      delete (HTMLElement.prototype as { offsetHeight?: number }).offsetHeight;
    }
    if (!hadRects) delete rangeProto.getClientRects;
  };
}

function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 400));
}

/** jsdom ships no ResizeObserver; the plugin needs one to construct. Width
    changes are driven explicitly here, so a no-op observer is enough. */
class NoopResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
let hadResizeObserver = true;

beforeAll(() => {
  hadResizeObserver = "ResizeObserver" in globalThis;
  if (!hadResizeObserver) {
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = NoopResizeObserver;
  }
});

afterAll(() => {
  if (!hadResizeObserver) {
    delete (globalThis as { ResizeObserver?: unknown }).ResizeObserver;
  }
});

describe("screenplay pagination refuses to run without layout", () => {
  it("runs no pagination pass while the editor has no measured width", async () => {
    const restoreLayout = stubLayout();
    const element = document.createElement("div");
    document.body.appendChild(element);
    const seen: number[] = [];
    const editor = new Editor({
      element,
      extensions: [
        ...baseExtensions,
        Pagination.configure({ onPages: (pages) => seen.push(pages) }),
      ],
      content: docJSON("scene_heading"),
    });

    await settle();

    expect(editor.view.dom.clientWidth).toBe(0);
    expect(seen).toEqual([]);
    expect(editor.view.dom.querySelectorAll(".pm-page-gap")).toHaveLength(0);

    editor.destroy();
    element.remove();
    restoreLayout();
  });

  it("paginates once the editor reports a width", async () => {
    const restoreLayout = stubLayout();
    const element = document.createElement("div");
    document.body.appendChild(element);
    const seen: number[] = [];
    const editor = new Editor({
      element,
      extensions: [
        ...baseExtensions,
        Pagination.configure({ onPages: (pages) => seen.push(pages) }),
      ],
      content: docJSON("scene_heading"),
    });
    // jsdom reports 0 for every element; stand in for a laid-out column.
    Object.defineProperty(editor.view.dom, "clientWidth", {
      value: 816,
      configurable: true,
    });

    await settle();

    // 11 headings of 10 rows each against a 54-row sheet.
    expect(seen[seen.length - 1]).toBe(3);
    expect(
      editor.view.dom.querySelectorAll(".pm-page-gap").length
    ).toBeGreaterThan(0);

    editor.destroy();
    element.remove();
    restoreLayout();
  });
});

describe("cached block geometry follows the node's current DOM", () => {
  it("never measures an element the node no longer renders as", async () => {
    // Sixty rows a line: taller than a page, so each line has to break on a
    // line boundary, and with no text model for it (jsdom has no column
    // width) the break is found from the line's own measured line boxes.
    const restoreLayout = stubLayout(60 * 16);
    const element = document.createElement("div");
    document.body.appendChild(element);
    const editor = new Editor({
      element,
      extensions: [...baseExtensions, Pagination],
      content: docJSON("action"),
    });
    Object.defineProperty(editor.view.dom, "clientWidth", {
      value: 816,
      configurable: true,
    });

    // Every per-line box measurement walks the block it was handed. Recording
    // those roots catches a pass that measured a detached element: the symptom
    // of a stale cache entry, not its implementation.
    const walked: Node[] = [];
    const originalWalker = document.createTreeWalker.bind(document);
    document.createTreeWalker = ((root: Node, ...rest: unknown[]) => {
      if ((root as HTMLElement).classList?.contains("sp-line")) walked.push(root);
      return (originalWalker as (r: Node, ...a: unknown[]) => TreeWalker)(root, ...rest);
    }) as typeof document.createTreeWalker;

    try {
      await settle();
      expect(walked.length).toBeGreaterThan(0);

      // Delete a whole line, then put the SAME node object back, which is what
      // undo (and a Duet peer's inverse step) produces.
      const index = 4;
      const posOf = (target: number): number => {
        let at = 0;
        for (let i = 0; i < target; i++) at += editor.state.doc.child(i).nodeSize;
        return at;
      };
      const pos = posOf(index);
      const node = editor.state.doc.child(index);
      editor.view.dispatch(editor.state.tr.delete(pos, pos + node.nodeSize));
      await settle();
      const detached = editor.view.nodeDOM(pos);
      editor.view.dispatch(editor.state.tr.insert(pos, node));
      await settle();

      const current = editor.view.nodeDOM(pos);
      expect(editor.state.doc.child(index)).toBe(node); // same node object
      expect(current).not.toBe(detached); // on a new element

      walked.length = 0;
      // One more pass over the restored document.
      editor.view.dispatch(editor.state.tr.insertText("!", 1));
      await settle();

      expect(walked.filter((root) => !root.isConnected)).toEqual([]);
      expect(walked).toContain(editor.view.nodeDOM(posOf(index)));
    } finally {
      document.createTreeWalker = originalWalker as typeof document.createTreeWalker;
      editor.destroy();
      element.remove();
      restoreLayout();
    }
  });
});

describe("an edit that wipes the page breaks always re-paginates", () => {
  it("re-lays the pages after the same document is loaded over itself", async () => {
    const restoreLayout = stubLayout();
    const element = document.createElement("div");
    document.body.appendChild(element);
    const editor = new Editor({
      element,
      extensions: [...baseExtensions, Pagination],
      content: docJSON("scene_heading"),
    });
    Object.defineProperty(editor.view.dom, "clientWidth", {
      value: 816,
      configurable: true,
    });
    try {
      await settle();
      const before = editor.view.dom.querySelectorAll(".pm-page-gap").length;
      expect(before).toBeGreaterThan(0);

      // A restore or an import swaps the whole document. Same blocks, same
      // heights: the cheap "nothing moved" check would pass, yet the swap
      // deleted every page break, so a full pass must still run.
      editor.commands.setContent(docJSON("scene_heading"));
      await Promise.resolve();
      await Promise.resolve();
      expect(editor.view.dom.querySelectorAll(".pm-page-gap").length).toBe(before);
    } finally {
      editor.destroy();
      element.remove();
      restoreLayout();
    }
  });
});
