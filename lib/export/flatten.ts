import type { JSONContent } from "@tiptap/core";
import { DEFAULT_ELEMENT, type ElementType } from "@/lib/editor/elements";
import type { ScriptLine } from "@/types/screenplay";

/**
 * The interchange bridge between the ProseMirror document and the flat
 * `ScriptLine[]` shape that every exporter and importer speaks.
 *
 * Keeping all format code on one side of this bridge means the Fountain, FDX,
 * and PDF modules never have to know anything about ProseMirror nodes, and the
 * editor never has to know anything about file formats.
 */

const ELEMENT_SET: ReadonlySet<string> = new Set<ElementType>([
  "scene_heading",
  "action",
  "character",
  "parenthetical",
  "dialogue",
  "transition",
]);

/** Narrow an arbitrary value to one of the six element types. */
export function isElementType(value: unknown): value is ElementType {
  return typeof value === "string" && ELEMENT_SET.has(value);
}

/**
 * Concatenate all inline text under a single line node, verbatim (no whitespace
 * collapsing). This is the canonical per-line text rule; outline.ts mirrors it
 * via ProseMirror's node.textContent, which is the same concatenation.
 */
export function lineText(node: JSONContent): string {
  let text = "";
  const collect = (n?: JSONContent) => {
    if (!n) return;
    if (n.type === "text" && n.text) text += n.text;
    n.content?.forEach(collect);
  };
  node.content?.forEach(collect);
  return text;
}

/**
 * Flatten a ProseMirror doc into one ScriptLine per screenplayLine node.
 *
 * Text is concatenated verbatim (no whitespace collapsing) so a round trip
 * preserves the spacing inside an action paragraph or a line of dialogue.
 * Unknown / missing element attributes coerce to the default so a malformed
 * document can never produce an invalid element type downstream.
 */
export function docToLines(doc: JSONContent): ScriptLine[] {
  const lines: ScriptLine[] = [];
  for (const node of doc.content ?? []) {
    const raw = node.attrs?.element;
    const element = isElementType(raw) ? raw : DEFAULT_ELEMENT;
    lines.push({ element, text: lineText(node) });
  }
  return lines;
}

/**
 * Rebuild a ProseMirror doc from a ScriptLine[], using the exact node shape the
 * sample script emits. Always yields at least one line so the schema's
 * `screenplayLine+` content rule is never violated by an empty import.
 */
export function linesToDoc(lines: ScriptLine[]): JSONContent {
  const nodes: JSONContent[] = lines.map((line) => ({
    type: "screenplayLine",
    attrs: { element: isElementType(line.element) ? line.element : DEFAULT_ELEMENT },
    content: line.text ? [{ type: "text", text: line.text }] : [],
  }));

  if (nodes.length === 0) {
    nodes.push({
      type: "screenplayLine",
      attrs: { element: DEFAULT_ELEMENT },
      content: [],
    });
  }

  return { type: "doc", content: nodes };
}
