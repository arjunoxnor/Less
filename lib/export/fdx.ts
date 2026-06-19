import { DEFAULT_ELEMENT, type ElementType } from "@/lib/editor/elements";
import type { ScriptLine } from "@/types/screenplay";

/**
 * Final Draft (.fdx) importer. Import only; FDX export is out of Phase 3 scope.
 *
 * An .fdx file is UTF-8 XML: <FinalDraft> > <Content> > a flat list of
 * <Paragraph Type="..."> nodes, each holding one or more <Text> runs. We parse
 * with the browser-native DOMParser (no XML dependency) and collapse Final
 * Draft's larger element vocabulary onto LESS's six types.
 *
 * The two real traps, both handled below: the TitlePage has its OWN nested
 * <Content> (so we scope to the first Content that is a direct child of the
 * root, never getElementsByTagName), and dual dialogue is wrapped in a
 * <DualDialogue> element whose inner Paragraphs are not direct children of
 * Content (so we descend into it and flatten).
 */

const TYPE_MAP: Record<string, ElementType> = {
  "Scene Heading": "scene_heading",
  "Scene Heading (Top of Page)": "scene_heading",
  Action: "action",
  General: "action",
  Shot: "action",
  Character: "character",
  Parenthetical: "parenthetical",
  Dialogue: "dialogue",
  Transition: "transition",
  "Cast List": "action",
  "New Act": "action",
  "End of Act": "action",
  Lyrics: "dialogue",
  Song: "dialogue",
};

/** Read a single <Paragraph> into one ScriptLine. */
function paragraphToLine(p: Element): ScriptLine {
  const rawType = p.getAttribute("Type") ?? "";
  const element = TYPE_MAP[rawType] ?? DEFAULT_ELEMENT;

  // Concatenate only DIRECT <Text> children (handles multi-run lines and
  // literal embedded newlines); ignore styling attributes and metadata nodes.
  // localName (not tagName) so a namespace prefix like <fd:Text> still matches.
  let text = "";
  for (const child of Array.from(p.children)) {
    if (child.localName === "Text") text += child.textContent ?? "";
  }
  return { element, text: text.trim() };
}

/** Emit every <Paragraph> directly under a <DualDialogue>, in document order. */
function flattenDual(dual: Element, lines: ScriptLine[]): void {
  for (const inner of Array.from(dual.children)) {
    if (inner.localName === "Paragraph") lines.push(paragraphToLine(inner));
  }
}

export function parseFdx(xmlString: string): ScriptLine[] {
  const doc = new DOMParser().parseFromString(xmlString, "application/xml");
  if (doc.querySelector("parsererror")) {
    throw new Error("This file is not valid Final Draft XML.");
  }

  const root = doc.documentElement;
  if (!root) return [];

  // The screenplay body is the FIRST <Content> that is a direct child of the
  // root, NOT any nested Content inside <TitlePage>. localName (not tagName)
  // tolerates a namespace prefix like <fd:Content>.
  let content: Element | null = null;
  for (const child of Array.from(root.children)) {
    if (child.localName === "Content") {
      content = child;
      break;
    }
  }
  if (!content) return [];

  const lines: ScriptLine[] = [];
  for (const node of Array.from(content.children)) {
    if (node.localName === "DualDialogue") {
      // Rare: a DualDialogue placed directly under Content.
      flattenDual(node, lines);
    } else if (node.localName === "Paragraph") {
      // LESS has no dual dialogue. Final Draft normally wraps it in a
      // <Paragraph><DualDialogue>...</DualDialogue></Paragraph>, so look for a
      // nested DualDialogue and flatten it; otherwise it is an ordinary line.
      const dual = Array.from(node.children).find(
        (c) => c.localName === "DualDialogue"
      );
      if (dual) flattenDual(dual, lines);
      else lines.push(paragraphToLine(node));
    }
  }

  // Drop purely-empty lines so blank Final Draft spacing paragraphs do not
  // turn into a wall of empty action.
  return lines.filter((l) => l.text !== "");
}
