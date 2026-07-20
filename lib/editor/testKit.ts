import { Editor, type JSONContent } from "@tiptap/core";
import { buildExtensions } from "./buildExtensions";
import { EMPTY_OUTLINE } from "./outline";
import type { ElementType } from "./elements";
import type { Outline } from "@/types/screenplay";

/**
 * Shared helpers for the editor unit tests (vitest, jsdom environment).
 *
 * The tests drive a REAL headless TipTap editor built from the production
 * extension list, so every plugin that shapes a keystroke (AutoCaps,
 * AutoElement, autocomplete, history) runs exactly as it does in the app.
 * No spell checker is attached (that path needs the dictionary asset).
 */

/** Build a screenplayLine JSON node. */
export function line(
  element: ElementType,
  text: string,
  attrs: Record<string, unknown> = {}
): JSONContent {
  return {
    type: "screenplayLine",
    attrs: { element, ...attrs },
    ...(text ? { content: [{ type: "text", text }] } : {}),
  };
}

/** Build a whole document from lines. */
export function docOf(...lines: JSONContent[]): JSONContent {
  return { type: "doc", content: lines };
}

/** A headless editor over the real production extensions. */
export function makeEditor(content: JSONContent, outline?: Outline): Editor {
  return new Editor({
    element: document.createElement("div"),
    extensions: buildExtensions({
      getOutline: () => outline ?? EMPTY_OUTLINE,
    }),
    content,
  });
}

/** Document position just before top-level line `index`. */
export function lineStartPos(editor: Editor, index: number): number {
  let pos = 0;
  for (let i = 0; i < index; i++) pos += editor.state.doc.child(i).nodeSize;
  return pos;
}

/** Put the caret at the end of top-level line `index`'s text. */
export function setCaretAtLineEnd(editor: Editor, index: number): void {
  const node = editor.state.doc.child(index);
  editor.commands.setTextSelection(lineStartPos(editor, index) + 1 + node.content.size);
}

/**
 * Type text one character per dispatched transaction, the way real keystrokes
 * arrive, so appendTransaction plugins (AutoCaps, AutoElement) fire per key.
 */
export function typeText(editor: Editor, text: string): void {
  for (const ch of text) {
    const { state } = editor.view;
    editor.view.dispatch(
      state.tr.insertText(ch, state.selection.from, state.selection.to)
    );
  }
}

/** Flatten the document to an easy-to-assert shape. */
export function linesOf(
  editor: Editor
): { element: string; text: string; dual: boolean; note: string }[] {
  const out: { element: string; text: string; dual: boolean; note: string }[] = [];
  editor.state.doc.forEach((node) => {
    out.push({
      element: node.attrs.element as string,
      text: node.textContent,
      dual: !!node.attrs.dual,
      note: (node.attrs.note as string) ?? "",
    });
  });
  return out;
}
