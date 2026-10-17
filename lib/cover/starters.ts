import type { JSONContent } from "@tiptap/core";
import type { DocKind } from "./kinds";

/**
 * What a new document of each kind starts with. Deliberately thin: a frame to
 * write into, never placeholder prose to delete. A kind without a frame (a
 * treatment is just prose) starts as an empty page.
 */

const para = (text?: string): JSONContent =>
  text ? { type: "paragraph", content: [{ type: "text", text }] } : { type: "paragraph" };
const heading = (text: string): JSONContent => ({
  type: "heading",
  attrs: { level: 2 },
  content: [{ type: "text", text }],
});
const emptyList = (): JSONContent => ({
  type: "bulletList",
  content: [{ type: "listItem", content: [para()] }],
});

export function starterFor(kind: DocKind): JSONContent | undefined {
  switch (kind) {
    case "onepager":
      return { type: "doc", content: [para("Logline: "), heading("Synopsis"), para()] };
    case "outline":
      return {
        type: "doc",
        content: [heading("Act One"), emptyList(), heading("Act Two"), emptyList(), heading("Act Three"), emptyList()],
      };
    default:
      return undefined;
  }
}

/** The name a new document of each kind is born with (selected, ready to type over). */
export const NEW_TITLE: Partial<Record<DocKind, string>> = {
  onepager: "Untitled one-pager",
  treatment: "Untitled treatment",
  outline: "Untitled outline",
  characters: "Untitled characters",
  notes: "Untitled notes",
};
