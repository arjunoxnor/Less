import type { ScriptLine } from "@/types/screenplay";
import type { ElementType } from "@/lib/editor/elements";

/**
 * Import for the "office" document formats: Word (.docx), OpenDocument (.odt),
 * and Rich Text (.rtf). These differ from Fountain in one crucial way: every
 * element is its own paragraph (carrying a style name), with no blank lines
 * between them. So we classify paragraph by paragraph using the style name when
 * a screenplay tool wrote it (Final Draft, Celtx, Fade In, WriterDuet and
 * Highland all name styles "Scene Heading", "Character", "Dialogue", etc.), and
 * fall back to text heuristics for plain prose or hand-typed scripts.
 *
 * Everything here runs only in the browser, on a user file-picker action.
 */

const W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const ODF_TEXT_NS = "urn:oasis:names:tc:opendocument:xmlns:text:1.0";

const SCENE_PREFIX = /^(INT|EXT|EST|INT\.?\/EXT|INT\/EXT|I\/E)[.\s]/i;
const isAllCaps = (t: string): boolean => /[A-Za-z]/.test(t) && t === t.toUpperCase();
// Terminal transitions that end in a period (no "TO:"), so the heuristic path
// recognizes them instead of demoting them to action. Mirrors the editor's
// SmartType transition catalog.
const TERMINAL_TRANSITION =
  /^(FADE (IN|OUT)|FADE TO (BLACK|WHITE)|SMASH CUT|MATCH CUT|JUMP CUT|TIME CUT|DISSOLVE|CUT TO BLACK|END(\s+OF\s+\w+)?|THE END)\.?:?\s*$/;

interface Para {
  text: string;
  /** Paragraph style name (when the producer named it), e.g. "Scene Heading". */
  style?: string;
  /** "center" | "right" when the paragraph is explicitly aligned. */
  align?: string;
}

/** Normalize a style name to letters only so "Scene Heading" === "SceneHeading". */
function normStyle(s?: string): string {
  return (s ?? "").toLowerCase().replace(/[^a-z]/g, "");
}

// Explicit screenplay paragraph styles -> element. Generic styles ("Normal",
// "Body Text", "Heading 1") are deliberately absent so they fall through to the
// text heuristics rather than being forced into a screenplay element.
const STYLE_ELEMENT: Record<string, ElementType> = {
  sceneheading: "scene_heading",
  scenehead: "scene_heading",
  scene: "scene_heading",
  slugline: "scene_heading",
  sluglines: "scene_heading",
  action: "action",
  actions: "action",
  generaltext: "action",
  description: "action",
  character: "character",
  characters: "character",
  charactername: "character",
  cast: "character",
  charactercue: "character",
  speaker: "character",
  dialogue: "dialogue",
  dialog: "dialogue",
  dialogues: "dialogue",
  speech: "dialogue",
  parenthetical: "parenthetical",
  parenthetic: "parenthetical",
  paren: "parenthetical",
  wryly: "parenthetical",
  transition: "transition",
  transitions: "transition",
  shot: "action",
};

function pushLine(out: ScriptLine[], element: ElementType, text: string): void {
  // Collapse tabs / soft breaks / runs of spaces so one paragraph = one line.
  let t = text.replace(/\s+/g, " ").trim();
  if (!t) return;
  if (element === "parenthetical" && !/^\(.*\)$/.test(t)) t = `(${t})`;
  out.push({ element, text: t });
}

/**
 * Turn an ordered list of paragraphs into screenplay lines. Style names win when
 * present; otherwise the shape of the text decides.
 */
function classifyParagraphs(paras: Para[]): ScriptLine[] {
  const out: ScriptLine[] = [];
  let inDialogue = false;

  // Drop empty paragraphs entirely. Office formats are classified by style name
  // and element adjacency, not by blank-line structure, so a blank paragraph
  // (common in double-spaced hand-typed scripts) only breaks the cue/dialogue
  // run and the look-ahead. Removing them makes single- and double-spaced
  // documents classify identically.
  const ps = paras.filter((p) => (p.text || "").replace(/\s+/g, " ").trim().length > 0);

  for (let i = 0; i < ps.length; i++) {
    const t = ps[i].text.replace(/\s+/g, " ").trim();

    const styled = STYLE_ELEMENT[normStyle(ps[i].style)];
    if (styled) {
      pushLine(out, styled, t);
      inDialogue = styled === "character" || styled === "parenthetical" || styled === "dialogue";
      continue;
    }

    // --- heuristic fallback (no usable style name) ---
    if (SCENE_PREFIX.test(t)) {
      pushLine(out, "scene_heading", t);
      inDialogue = false;
      continue;
    }
    if (/^\(.*\)$/.test(t)) {
      pushLine(out, "parenthetical", t);
      inDialogue = true;
      continue;
    }
    const align = ps[i].align;
    if (isAllCaps(t) && (/TO:\s*$/.test(t) || align === "right" || TERMINAL_TRANSITION.test(t))) {
      pushLine(out, "transition", t);
      inDialogue = false;
      continue;
    }
    // A character cue: a short all-caps line (a trailing "(V.O.)" / "(CONT'D)"
    // extension is allowed) that is centered or is followed by a non-caps line
    // (its dialogue). All-caps lines with no following dialogue stay as action.
    const core = t.replace(/\s*\([^)]*\)\s*$/, "");
    const looksCharacter =
      isAllCaps(core) && core.length > 0 && t.length <= 38 && !/[.!?]$/.test(core);
    const nextRaw = (ps[i + 1]?.text ?? "").replace(/\s+/g, " ").trim();
    const nextCore = nextRaw.replace(/\s*\([^)]*\)\s*$/, "");
    const dialogueFollows = nextRaw.length > 0 && !isAllCaps(nextCore);
    if (looksCharacter && (align === "center" || dialogueFollows)) {
      pushLine(out, "character", t);
      inDialogue = true;
      continue;
    }
    if (inDialogue) {
      pushLine(out, "dialogue", t);
      continue;
    }
    pushLine(out, "action", t);
  }

  return out;
}

// ---------------------------------------------------------------------------
// ZIP-based formats (.docx, .odt): unzip one entry, parse its XML.
// ---------------------------------------------------------------------------

async function unzipEntry(buf: ArrayBuffer, path: string): Promise<string | null> {
  const { unzipSync } = await import("fflate");
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(new Uint8Array(buf));
  } catch {
    throw new Error("That file is not a valid Word or OpenDocument file.");
  }
  const bytes = files[path];
  if (!bytes) return null;
  return new TextDecoder("utf-8").decode(bytes);
}

function parseXml(xml: string): Document {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  if (doc.getElementsByTagName("parsererror").length) {
    throw new Error("Could not read the document's contents.");
  }
  return doc;
}

function childNS(parent: Element, ns: string, ln: string): Element | null {
  for (let n = parent.firstChild; n; n = n.nextSibling) {
    if (n.nodeType === 1) {
      const el = n as Element;
      if (el.localName === ln && el.namespaceURI === ns) return el;
    }
  }
  return null;
}

function docxParaText(p: Element): string {
  let s = "";
  const walk = (node: Node): void => {
    for (let n = node.firstChild; n; n = n.nextSibling) {
      if (n.nodeType !== 1) continue;
      const el = n as Element;
      if (el.namespaceURI === W_NS) {
        if (el.localName === "t") {
          s += el.textContent ?? "";
          continue;
        }
        if (el.localName === "tab") {
          s += "\t";
          continue;
        }
        if (el.localName === "br" || el.localName === "cr") {
          s += "\n";
          continue;
        }
        if (el.localName === "delText") continue; // tracked-change deletion
      }
      walk(el);
    }
  };
  walk(p);
  return s;
}

function docxParaStyle(p: Element): string | undefined {
  const pPr = childNS(p, W_NS, "pPr");
  if (!pPr) return undefined;
  const st = childNS(pPr, W_NS, "pStyle");
  return st?.getAttributeNS(W_NS, "val") ?? undefined;
}

function docxParaAlign(p: Element): string | undefined {
  const pPr = childNS(p, W_NS, "pPr");
  if (!pPr) return undefined;
  const jc = childNS(pPr, W_NS, "jc");
  const v = jc?.getAttributeNS(W_NS, "val");
  if (v === "center") return "center";
  if (v === "right" || v === "end") return "right";
  return undefined;
}

export async function docxToLines(buf: ArrayBuffer): Promise<ScriptLine[]> {
  const xml = await unzipEntry(buf, "word/document.xml");
  if (!xml) throw new Error("That .docx file has no document body.");
  const doc = parseXml(xml);
  const pEls = doc.getElementsByTagNameNS(W_NS, "p");
  const paras: Para[] = [];
  for (let i = 0; i < pEls.length; i++) {
    const p = pEls[i];
    paras.push({ text: docxParaText(p), style: docxParaStyle(p), align: docxParaAlign(p) });
  }
  return classifyParagraphs(paras);
}

function odtParaText(p: Element): string {
  let s = "";
  const walk = (node: Node): void => {
    for (let n = node.firstChild; n; n = n.nextSibling) {
      if (n.nodeType === 3) {
        s += n.nodeValue ?? "";
        continue;
      }
      if (n.nodeType !== 1) continue;
      const el = n as Element;
      if (el.namespaceURI === ODF_TEXT_NS) {
        if (el.localName === "tab") {
          s += "\t";
          continue;
        }
        if (el.localName === "line-break") {
          s += "\n";
          continue;
        }
        if (el.localName === "s") {
          const c = parseInt(el.getAttributeNS(ODF_TEXT_NS, "c") ?? "1", 10);
          s += " ".repeat(Number.isNaN(c) ? 1 : Math.max(1, c));
          continue;
        }
      }
      walk(el);
    }
  };
  walk(p);
  return s;
}

export async function odtToLines(buf: ArrayBuffer): Promise<ScriptLine[]> {
  const xml = await unzipEntry(buf, "content.xml");
  if (!xml) throw new Error("That .odt file has no content.");
  const doc = parseXml(xml);
  const paras: Para[] = [];
  const collect = (node: Node): void => {
    for (let n = node.firstChild; n; n = n.nextSibling) {
      if (n.nodeType !== 1) continue;
      const el = n as Element;
      if (el.namespaceURI === ODF_TEXT_NS && (el.localName === "p" || el.localName === "h")) {
        paras.push({
          text: odtParaText(el),
          style: el.getAttributeNS(ODF_TEXT_NS, "style-name") ?? undefined,
        });
      } else {
        collect(el);
      }
    }
  };
  collect(doc.documentElement);
  return classifyParagraphs(paras);
}

// ---------------------------------------------------------------------------
// Rich Text Format (.rtf): strip control words to plain paragraphs.
// ---------------------------------------------------------------------------

// Windows-1252 high range (0x80-0x9F) -> Unicode, for \'xx byte escapes.
const CP1252_EXTRA: Record<number, number> = {
  0x80: 0x20ac, 0x82: 0x201a, 0x83: 0x0192, 0x84: 0x201e, 0x85: 0x2026,
  0x86: 0x2020, 0x87: 0x2021, 0x88: 0x02c6, 0x89: 0x2030, 0x8a: 0x0160,
  0x8b: 0x2039, 0x8c: 0x0152, 0x8e: 0x017d, 0x91: 0x2018, 0x92: 0x2019,
  0x93: 0x201c, 0x94: 0x201d, 0x95: 0x2022, 0x96: 0x2013, 0x97: 0x2014,
  0x98: 0x02dc, 0x99: 0x2122, 0x9a: 0x0161, 0x9b: 0x203a, 0x9c: 0x0153,
  0x9e: 0x017e, 0x9f: 0x0178,
};
const cp1252 = (code: number): string => String.fromCharCode(CP1252_EXTRA[code] ?? code);

// Destination groups whose text is metadata, not body content.
const IGNORE_DEST = new Set([
  "fonttbl", "colortbl", "stylesheet", "info", "pict", "object", "themedata",
  "colorschememapping", "latentstyles", "datastore", "operator", "generator",
  "filetbl", "listtable", "listoverridetable", "rsidtbl", "mmathpr",
  "wgrffmtfilter", "xmlnstbl", "fldinst", "header", "footer", "pgdsctbl",
]);

function rtfToParagraphs(rtf: string): string[] {
  const n = rtf.length;
  let text = "";
  const stack: { ignore: boolean; ucskip: number }[] = [{ ignore: false, ucskip: 1 }];
  let top = stack[0];
  let skip = 0; // count of fallback chars to swallow after a \uN unicode escape
  let i = 0;

  const emit = (ch: string): void => {
    if (!top.ignore) text += ch;
  };

  while (i < n) {
    const c = rtf[i];
    if (c === "{") {
      const t = { ignore: top.ignore, ucskip: top.ucskip };
      stack.push(t);
      top = t;
      i++;
      continue;
    }
    if (c === "}") {
      if (stack.length > 1) stack.pop();
      top = stack[stack.length - 1];
      i++;
      continue;
    }
    if (c === "\\") {
      const next = rtf[i + 1];
      if (next === "\\" || next === "{" || next === "}") {
        i += 2;
        if (skip > 0) skip--;
        else emit(next);
        continue;
      }
      if (next === "'") {
        const code = parseInt(rtf.substr(i + 2, 2), 16);
        i += 4;
        if (skip > 0) skip--;
        else if (!Number.isNaN(code)) emit(cp1252(code));
        continue;
      }
      if (next === "*") {
        top.ignore = true;
        i += 2;
        continue;
      }
      if (next === "\n" || next === "\r") {
        i += 2;
        emit("\n");
        continue;
      }
      const m = /^\\([a-zA-Z]+)(-?\d+)? ?/.exec(rtf.slice(i));
      if (m) {
        i += m[0].length;
        const word = m[1];
        const param = m[2];
        switch (word) {
          case "par":
          case "line":
          case "sect":
          case "row":
            emit("\n");
            break;
          case "cell":
          case "tab":
            emit("\t");
            break;
          case "uc":
            top.ucskip = param ? Math.max(0, parseInt(param, 10)) : 1;
            break;
          case "u": {
            let code = param ? parseInt(param, 10) : 0;
            if (code < 0) code += 65536;
            if (!Number.isNaN(code)) emit(String.fromCharCode(code));
            skip = top.ucskip;
            break;
          }
          case "emdash": emit("—"); break;
          case "endash": emit("–"); break;
          case "lquote": emit("‘"); break;
          case "rquote": emit("’"); break;
          case "ldblquote": emit("“"); break;
          case "rdblquote": emit("”"); break;
          case "bullet": emit("•"); break;
          default:
            if (IGNORE_DEST.has(word.toLowerCase())) top.ignore = true;
            break;
        }
        continue;
      }
      i += 2; // unknown control symbol
      continue;
    }
    if (c === "\n" || c === "\r") {
      i++; // raw line breaks in the RTF stream are not content
      continue;
    }
    if (skip > 0) skip--;
    else emit(c);
    i++;
  }

  return text.split("\n").map((s) => s.replace(/\s+$/, ""));
}

export function rtfToLines(rtf: string): ScriptLine[] {
  return classifyParagraphs(rtfToParagraphs(rtf).map((text) => ({ text })));
}

/** True when decoded text looks like binary (NUL bytes or many control chars). */
export function looksBinary(s: string): boolean {
  const sample = s.slice(0, 1000);
  let ctrl = 0;
  for (let i = 0; i < sample.length; i++) {
    const c = sample.charCodeAt(i);
    if (c === 0) return true;
    if (c < 9 || (c > 13 && c < 32)) ctrl++;
  }
  return ctrl > sample.length * 0.1;
}
