import { DEFAULT_ELEMENT, type ElementType } from "@/lib/editor/elements";
import type { ScriptLine, TextStyleRun } from "@/types/screenplay";
import { hasTitlePage, type TitlePage } from "./titlePage";
import { cleanHex, normalizeRuns, segments, type CharStyle } from "./styleRuns";

/**
 * Final Draft (.fdx) import and export.
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
  // literal embedded newlines); a run's Style (Bold, Italic, Underline) and
  // Background (a highlight) come along as the line's formatting. localName
  // (not tagName) so a namespace prefix like <fd:Text> still matches.
  let text = "";
  const runs: TextStyleRun[] = [];
  for (const child of Array.from(p.children)) {
    if (child.localName !== "Text") continue;
    const t = child.textContent ?? "";
    const style = fdxStyle(child);
    if (t && style) runs.push({ from: text.length, to: text.length + t.length, ...style });
    text += t;
  }
  // A Final Draft Number attribute is deliberately NOT folded into the text: the
  // editor, the scene navigator, find/replace and the Fountain exporter all read
  // line.text, so a synthetic " #N#" suffix would be visible everywhere the PDF
  // does not show it. Scene numbering stays the renderer's job.
  const line: ScriptLine = dual ? { element, text, dual: true } : { element, text };
  const marks = normalizeRuns(runs, text.length);
  if (marks.length) line.marks = marks;
  return line;
}

/** "#RRRRGGGGBBBB" (Final Draft's 16 bits a channel) or "#RRGGBB" as "#rrggbb". */
function fdxColor(v: string | null): string | undefined {
  const s = (v ?? "").trim();
  if (/^#[0-9a-f]{12}$/i.test(s)) return cleanHex("#" + s.slice(1, 3) + s.slice(5, 7) + s.slice(9, 11));
  return cleanHex(s);
}

/** A <Text> run's formatting, or null when it has none. */
function fdxStyle(el: Element): CharStyle | null {
  const tokens = (el.getAttribute("Style") ?? "").split("+").map((t) => t.trim().toLowerCase());
  const style: CharStyle = {};
  if (tokens.includes("bold")) style.bold = true;
  if (tokens.includes("italic")) style.italic = true;
  if (tokens.includes("underline")) style.underline = true;
  const bg = fdxColor(el.getAttribute("Background"));
  // White is Final Draft's "no highlight".
  if (bg && bg !== "#ffffff") style.highlight = bg;
  return style.bold || style.italic || style.underline || style.highlight ? style : null;
}

/** "#rrggbb" in Final Draft's 16-bits-a-channel spelling. */
const fdxColor16 = (hex: string) =>
  "#" + [1, 3, 5].map((i) => hex.slice(i, i + 2).toUpperCase().repeat(2)).join("");

/** A line's text as <Text> runs, each carrying its formatting. */
function runsXml(line: ScriptLine, indent: string): string {
  if (!line.marks?.length) return `${indent}<Text>${esc(line.text)}</Text>\n`;
  return segments(line.text, line.marks)
    .map(({ text, style }) => {
      const names = [style.bold && "Bold", style.italic && "Italic", style.underline && "Underline"].filter(Boolean);
      const attrs =
        (names.length ? ` Style="${names.join("+")}"` : "") +
        (style.highlight ? ` Background="${fdxColor16(style.highlight)}"` : "");
      return `${indent}<Text${attrs}>${esc(text)}</Text>\n`;
    })
    .join("");
}

/** Paragraph descendants in document order, without recursion on hostile depth. */
function descendantParagraphs(parent: Element): Element[] {
  const out: Element[] = [];
  const stack = Array.from(parent.children).reverse();
  while (stack.length) {
    const node = stack.pop()!;
    if (node.localName === "Paragraph") {
      out.push(node);
      continue;
    }
    const children = Array.from(node.children);
    for (let i = children.length - 1; i >= 0; i--) stack.push(children[i]);
  }
  return out;
}

/**
 * Emit a <DualDialogue>'s inner Paragraphs in order. The first speaker stays in
 * the left column; the SECOND speaker's cluster is marked dual (the right
 * column). A rare 3rd+ speaker (not produced by Final Draft itself) is left
 * non-dual so it renders as an ordinary cue rather than an unpaired right column.
 */
function emitDual(dualEl: Element, lines: ScriptLine[]): void {
  let speakers = 0;
  for (const inner of descendantParagraphs(dualEl)) {
    const el = TYPE_MAP[inner.getAttribute("Type") ?? ""] ?? DEFAULT_ELEMENT;
    if (el === "character") speakers++;
    const line = paragraphToLine(inner, speakers === 2);
    if (line.text !== "" || inner.getAttribute("LESSPreserveEmpty") === "true") {
      lines.push(line);
    }
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

  const taggedFields = new Set<keyof TitlePage>(Object.values(TITLE_KEY_MAP));
  const entries: { text: string; field?: keyof TitlePage }[] = [];
  for (const node of Array.from(content.children)) {
    if (node.localName !== "Paragraph") continue;
    let t = "";
    for (const c of Array.from(node.children)) {
      if (c.localName === "Text") t += c.textContent ?? "";
    }
    t = t.trim();
    const rawField = node.getAttribute("LESSField") as keyof TitlePage | null;
    const field = rawField && taggedFields.has(rawField) ? rawField : undefined;
    if (t) entries.push({ text: t, field });
  }
  if (entries.length === 0) return null;

  const tp: TitlePage = {};
  const leftover: string[] = [];
  const append = (field: keyof TitlePage, value: string) => {
    tp[field] = tp[field] ? `${tp[field]}\n${value}` : value;
  };
  for (const entry of entries) {
    if (entry.field) {
      append(entry.field, entry.text);
      continue;
    }
    const line = entry.text;
    const m = /^([^:]+):\s*(.*)$/.exec(line);
    const field = m ? TITLE_KEY_MAP[m[1].trim().toLowerCase()] : undefined;
    if (field && m![2].trim()) append(field, m![2].trim());
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
  if (root.localName !== "FinalDraft") {
    throw new Error("This file is not a Final Draft document.");
  }

  const titlePage = parseFdxTitlePage(root);

  // The screenplay body is the FIRST <Content> that is a direct child of the
  // root, NOT any nested Content inside <TitlePage>. localName (not tagName)
  // tolerates a namespace prefix like <fd:Content>.
  const content = childByName(root, "Content");
  if (!content) return { lines: [], titlePage };

  const lines: ScriptLine[] = [];
  const stack = Array.from(content.children).reverse();
  while (stack.length) {
    const node = stack.pop()!;
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
      else {
        const line = paragraphToLine(node);
        if (line.text !== "" || node.getAttribute("LESSPreserveEmpty") === "true") {
          lines.push(line);
        }
      }
    } else {
      const children = Array.from(node.children);
      for (let i = children.length - 1; i >= 0; i--) stack.push(children[i]);
    }
  }

  return { lines, titlePage };
}

/* --- Export ------------------------------------------------------------- */

/** LESS element -> Final Draft paragraph Type. */
const REVERSE_TYPE: Record<ElementType, string> = {
  scene_heading: "Scene Heading",
  action: "Action",
  character: "Character",
  parenthetical: "Parenthetical",
  dialogue: "Dialogue",
  transition: "Transition",
};

// Everything XML 1.0 forbids in character data, matched by code point (the /u
// flag) so an astral character counts once and a lone surrogate is caught.
const XML10_FORBIDDEN = /[^\u0009\u000A\u000D\u0020-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/gu;

function esc(s: string): string {
  return s
    // Drop characters XML 1.0 forbids (control chars often pasted from PDFs,
    // lone surrogates from a broken paste); leaving them in produces a .fdx the
    // app's own importer rejects. Strip rather than throw: the only caller is a
    // fire-and-forget export action, so throwing here makes "Export > Final
    // Draft" silently do nothing at all.
    .replace(XML10_FORBIDDEN, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function paragraphXml(line: ScriptLine, indent: string): string {
  const type = REVERSE_TYPE[line.element] ?? "Action";
  const preserveEmpty = line.text === "" ? ' LESSPreserveEmpty="true"' : "";
  return (
    `${indent}<Paragraph Type="${type}"${preserveEmpty}>\n` +
    runsXml(line, `${indent}  `) +
    `${indent}</Paragraph>`
  );
}

/** End (exclusive) of a cue cluster: the character cue + its parenthetical/dialogue. */
function clusterEnd(lines: ScriptLine[], start: number): number {
  let i = start + 1;
  while (
    i < lines.length &&
    (lines[i].element === "parenthetical" || lines[i].element === "dialogue")
  ) {
    i++;
  }
  return i;
}

function titlePageXml(tp: TitlePage): string {
  // LESSField is ignored by Final Draft's renderer but lets a later import
  // recover the optional fields without printing labels onto the title page.
  const para = (text: string, align: string, field: keyof TitlePage) =>
    `      <Paragraph Alignment="${align}" LESSField="${field}">\n        <Text>${esc(text)}</Text>\n      </Paragraph>`;
  const out: string[] = ["  <TitlePage>", "    <Content>"];
  if (tp.title) out.push(para(tp.title, "Center", "title"));
  if (tp.credit) out.push(para(tp.credit, "Center", "credit"));
  if (tp.author) out.push(para(tp.author, "Center", "author"));
  if (tp.source) out.push(para(tp.source, "Center", "source"));
  if (tp.draftDate) out.push(para(tp.draftDate, "Left", "draftDate"));
  if (tp.contact) {
    for (const cl of tp.contact.split("\n")) out.push(para(cl, "Left", "contact"));
  }
  if (tp.copyright) out.push(para(tp.copyright, "Left", "copyright"));
  out.push("    </Content>", "  </TitlePage>");
  return out.join("\n");
}

/**
 * Serialize to Final Draft (.fdx) XML, the near-symmetric inverse of parseFdx.
 * Dual dialogue is reconstructed: a non-dual cue cluster immediately followed by
 * a dual one is wrapped in <Paragraph><DualDialogue>...</DualDialogue></Paragraph>,
 * exactly the shape the importer reads.
 */
export function toFdx(lines: ScriptLine[], titlePage?: TitlePage | null): string {
  const parts: string[] = [
    '<?xml version="1.0" encoding="UTF-8" standalone="no"?>',
    '<FinalDraft DocumentType="Script" Template="No" Version="5">',
    "  <Content>",
  ];

  let i = 0;
  while (i < lines.length) {
    const l = lines[i];
    if (l.element === "character" && !l.dual) {
      const leftEnd = clusterEnd(lines, i);
      if (
        leftEnd < lines.length &&
        lines[leftEnd].element === "character" &&
        lines[leftEnd].dual
      ) {
        const rightEnd = clusterEnd(lines, leftEnd);
        parts.push("    <Paragraph>", "      <DualDialogue>");
        for (let k = i; k < rightEnd; k++) {
          parts.push(paragraphXml({ ...lines[k], dual: false }, "        "));
        }
        parts.push("      </DualDialogue>", "    </Paragraph>");
        i = rightEnd;
        continue;
      }
    }
    parts.push(paragraphXml(l, "    "));
    i++;
  }

  parts.push("  </Content>");
  if (hasTitlePage(titlePage)) parts.push(titlePageXml(titlePage!));
  parts.push("</FinalDraft>");
  return parts.join("\n") + "\n";
}
