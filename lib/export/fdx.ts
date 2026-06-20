import { DEFAULT_ELEMENT, type ElementType } from "@/lib/editor/elements";
import type { ScriptLine } from "@/types/screenplay";
import { hasTitlePage, type TitlePage } from "./titlePage";

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
function paragraphToLine(p: Element, dual = false): ScriptLine {
  const rawType = p.getAttribute("Type") ?? "";
  const element = TYPE_MAP[rawType] ?? DEFAULT_ELEMENT;

  // Concatenate only DIRECT <Text> children (handles multi-run lines and
  // literal embedded newlines); ignore styling attributes and metadata nodes.
  // localName (not tagName) so a namespace prefix like <fd:Text> still matches.
  let text = "";
  for (const child of Array.from(p.children)) {
    if (child.localName === "Text") text += child.textContent ?? "";
  }
  return dual ? { element, text: text.trim(), dual: true } : { element, text: text.trim() };
}

/**
 * Emit a <DualDialogue>'s inner Paragraphs in order. The first speaker stays in
 * the left column; the SECOND speaker's cluster is marked dual (the right
 * column). A rare 3rd+ speaker (not produced by Final Draft itself) is left
 * non-dual so it renders as an ordinary cue rather than an unpaired right column.
 */
function emitDual(dualEl: Element, lines: ScriptLine[]): void {
  let speakers = 0;
  for (const inner of Array.from(dualEl.children)) {
    if (inner.localName !== "Paragraph") continue;
    const el = TYPE_MAP[inner.getAttribute("Type") ?? ""] ?? DEFAULT_ELEMENT;
    if (el === "character") speakers++;
    lines.push(paragraphToLine(inner, speakers === 2));
  }
}

/** Direct child of `el` with the given localName, or null. */
function childByName(el: Element, name: string): Element | null {
  for (const child of Array.from(el.children)) {
    if (child.localName === name) return child;
  }
  return null;
}

const TITLE_KEY_MAP: Record<string, keyof TitlePage> = {
  title: "title",
  credit: "credit",
  author: "author",
  authors: "author",
  source: "source",
  "draft date": "draftDate",
  contact: "contact",
  copyright: "copyright",
};

/**
 * Parse the top-level <TitlePage> (if any) into a TitlePage. FDX title pages are
 * usually unlabeled, formatting-only paragraphs, so we map "Key: Value" lines
 * when present and otherwise treat the first line as the title and the rest as
 * contact. Heuristic and user-correctable in the modal.
 */
function parseFdxTitlePage(root: Element): TitlePage | null {
  const titlePageEl = childByName(root, "TitlePage");
  if (!titlePageEl) return null;
  const content = childByName(titlePageEl, "Content");
  if (!content) return null;

  const texts: string[] = [];
  for (const node of Array.from(content.children)) {
    if (node.localName !== "Paragraph") continue;
    let t = "";
    for (const c of Array.from(node.children)) {
      if (c.localName === "Text") t += c.textContent ?? "";
    }
    t = t.trim();
    if (t) texts.push(t);
  }
  if (texts.length === 0) return null;

  const tp: TitlePage = {};
  const leftover: string[] = [];
  for (const line of texts) {
    const m = /^([^:]+):\s*(.*)$/.exec(line);
    const field = m ? TITLE_KEY_MAP[m[1].trim().toLowerCase()] : undefined;
    if (field && m![2].trim()) tp[field] = m![2].trim();
    else leftover.push(line);
  }
  if (!hasTitlePage(tp)) {
    tp.title = leftover.shift();
  }
  if (leftover.length && !tp.contact) {
    tp.contact = leftover.join("\n");
  }
  return hasTitlePage(tp) ? tp : null;
}

export function parseFdx(xmlString: string): {
  lines: ScriptLine[];
  titlePage: TitlePage | null;
} {
  const doc = new DOMParser().parseFromString(xmlString, "application/xml");
  if (doc.querySelector("parsererror")) {
    throw new Error("This file is not valid Final Draft XML.");
  }

  const root = doc.documentElement;
  if (!root) return { lines: [], titlePage: null };

  const titlePage = parseFdxTitlePage(root);

  // The screenplay body is the FIRST <Content> that is a direct child of the
  // root, NOT any nested Content inside <TitlePage>. localName (not tagName)
  // tolerates a namespace prefix like <fd:Content>.
  const content = childByName(root, "Content");
  if (!content) return { lines: [], titlePage };

  const lines: ScriptLine[] = [];
  for (const node of Array.from(content.children)) {
    if (node.localName === "DualDialogue") {
      // Rare: a DualDialogue placed directly under Content.
      emitDual(node, lines);
    } else if (node.localName === "Paragraph") {
      // Final Draft normally wraps dual dialogue in a
      // <Paragraph><DualDialogue>...</DualDialogue></Paragraph>; mark the second
      // speaker dual. Otherwise it is an ordinary line.
      const dual = Array.from(node.children).find(
        (c) => c.localName === "DualDialogue"
      );
      if (dual) emitDual(dual, lines);
      else lines.push(paragraphToLine(node));
    }
  }

  // Drop purely-empty lines so blank Final Draft spacing paragraphs do not
  // turn into a wall of empty action.
  return { lines: lines.filter((l) => l.text !== ""), titlePage };
}
