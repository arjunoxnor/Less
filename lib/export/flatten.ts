import type { JSONContent } from "@tiptap/core";
import { DEFAULT_ELEMENT, type ElementType } from "@/lib/editor/elements";
import type { ScriptLine, TextStyleRun } from "@/types/screenplay";
import { nodesFromRuns, runsFromLine, shiftRuns } from "./styleRuns";

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

/** Elements that screenplay format prints in capitals. On screen these are
 *  uppercased by CSS, and the stored text deliberately keeps whatever case the
 *  writer typed so that changing a line's element type is lossless. Output has
 *  to be correct regardless, so the capitals are applied here, at the one
 *  bridge every exporter crosses. */
const UPPERCASE_ELEMENTS: ReadonlySet<ElementType> = new Set<ElementType>([
  "scene_heading",
  "character",
  "transition",
]);

/** Supply screenplay punctuation without changing the stored editor document. */
export function ensureParentheticalParens(text: string): string {
  const trimmed = text.trim();
  // Supply only the bracket that is missing: "(beat" prints "(beat)", not
  // "((beat)". The screen shows the same brackets (parentheticalBrackets in
  // lib/editor/parenthetical.ts), so the line wraps alike in both places.
  return (trimmed.startsWith("(") ? "" : "(") + trimmed + (trimmed.endsWith(")") ? "" : ")");
}

/**
 * Flatten a ProseMirror doc into one ScriptLine per screenplayLine node.
 *
 * Text is concatenated verbatim (no whitespace collapsing) so a round trip
 * preserves the spacing inside an action paragraph or a line of dialogue.
 * Unknown / missing element attributes coerce to the default so a malformed
 * document can never produce an invalid element type downstream.
 *
 * Every caller is a read-only consumer (export, the breakdown, the page lock),
 * so applying the format's capitals here never writes back into the document.
 * Uppercasing cannot change wrapping either: the script face is monospace.
 */
export function docToLines(doc: JSONContent): ScriptLine[] {
  const lines: ScriptLine[] = [];
  for (const node of doc.content ?? []) {
    const raw = node.attrs?.element;
    const element = isElementType(raw) ? raw : DEFAULT_ELEMENT;
    // Carry the dual + revised flags, omitting them when false so lines stay minimal.
    const raw_text = lineText(node);
    const line: ScriptLine = {
      element,
      text: UPPERCASE_ELEMENTS.has(element)
        ? raw_text.toUpperCase()
        : element === "parenthetical"
          ? ensureParentheticalParens(raw_text)
          : raw_text,
    };
    if (node.attrs?.dual === true) line.dual = true;
    if (node.attrs?.revised === true) line.revised = true;
    const marks = lineMarks(node, raw_text, line.text, element);
    if (marks.length) line.marks = marks;
    lines.push(line);
  }
  return lines;
}

/**
 * A line's bold, italic, underline and highlight, moved to match the text as
 * printed: capitals keep every offset (unless a letter grows when
 * capitalized, when the styling is dropped rather than misplaced), and a
 * parenthetical's supplied bracket and trimmed spaces shift it.
 */
function lineMarks(node: JSONContent, raw: string, printed: string, element: ElementType): TextStyleRun[] {
  const runs = runsFromLine(node);
  if (runs.length === 0) return runs;
  if (element === "parenthetical") {
    // Only what survives the trim moves across, one along if a bracket was supplied.
    const lead = raw.length - raw.trimStart().length;
    const end = raw.trimEnd().length;
    const kept = runs
      .map((r) => ({ ...r, from: Math.max(r.from, lead), to: Math.min(r.to, end) }))
      .filter((r) => r.to > r.from);
    const shift = (raw.trim().startsWith("(") ? 0 : 1) - lead;
    return shiftRuns(kept, shift, printed.length);
  }
  return printed.length === raw.length ? runs : [];
}

/**
 * Rebuild a ProseMirror doc from a ScriptLine[], using the exact node shape the
 * sample script emits. Always yields at least one line so the schema's
 * `screenplayLine+` content rule is never violated by an empty import.
 */
export function linesToDoc(lines: ScriptLine[]): JSONContent {
  const nodes: JSONContent[] = lines.map((line) => ({
    type: "screenplayLine",
    attrs: {
      element: isElementType(line.element) ? line.element : DEFAULT_ELEMENT,
      // Set the attr only when true, so docs without dual serialize unchanged.
      ...(line.dual ? { dual: true } : {}),
      ...(line.revised ? { revised: true } : {}),
    },
    content: nodesFromRuns(line.text ?? "", line.marks),
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
