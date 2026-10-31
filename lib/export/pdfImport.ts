import type { JSONContent } from "@tiptap/core";
import type { ElementType } from "@/lib/editor/elements";
import type { ScriptLine } from "@/types/screenplay";
import type { TitlePage } from "./titlePage";

/**
 * Reading a PDF. A PDF holds no paragraphs or line types, only words at places
 * on a page, so everything is worked out from where the words sit. A
 * screenplay is laid out to a strict grid: from the left text edge, dialogue
 * sits an inch in, parentheticals an inch and a half, cues two inches. Prose
 * is told apart by paragraphs (a gap between lines) and headings (bigger type).
 *
 * The reader (pdfjs) only supplies the words; the working out here is pure, so
 * it can be tested on layouts this app knows are right.
 */

export interface PdfWord {
  str: string;
  /** Points from the page's left edge. */
  x: number;
  /** Baseline, points up from the page's bottom. */
  y: number;
  w: number;
  /** Type size in points. */
  size: number;
}

export interface PdfPage {
  width: number;
  height: number;
  words: PdfWord[];
}

interface Row {
  text: string;
  x: number;
  right: number;
  y: number;
  size: number;
  /** Words far enough to the right to be a second column (dual dialogue). */
  second?: Row;
}

const SCENE = /^(INT|EXT|EST|INT\.?\/EXT|INT\/EXT|I\/E)[.\s]/i;
const isCaps = (t: string) => t.toUpperCase() !== t.toLowerCase() && t === t.toUpperCase();
const NUMBER_ONLY = /^\d+[A-Z]?\.?$/;

/** Words as one row of text. */
function joinWords(words: PdfWord[], y: number): Row {
  let text = "";
  let end = words[0].x;
  for (const w of words) {
    // A gap a space wide is a space, however the file spelled it.
    if (text && !text.endsWith(" ") && !w.str.startsWith(" ") && w.x - end > w.size * 0.18) text += " ";
    text += w.str;
    end = w.x + w.w;
  }
  const first = words.find((w) => w.str.trim()) ?? words[0];
  return { text: text.trim().replace(/\s+/g, " "), x: first.x, right: end, y, size: Math.max(...words.map((w) => w.size)) };
}

/**
 * A page's words as rows of text, top to bottom. For a script (`grid`), a
 * number set well apart at either end of a row is a scene number, not writing,
 * and words far to the right of the rest are a second column.
 */
function rowsOf(page: PdfPage, grid = false): Row[] {
  const sorted = page.words
    .filter((w) => w.str.trim() || w.str === " ")
    .sort((a, b) => b.y - a.y || a.x - b.x);
  const rows: { y: number; words: PdfWord[] }[] = [];
  for (const w of sorted) {
    const row = rows[rows.length - 1];
    if (row && Math.abs(row.y - w.y) <= Math.max(2, w.size * 0.3)) row.words.push(w);
    else rows.push({ y: w.y, words: [w] });
  }
  return rows
    .map((r) => {
      let words = r.words.filter((w) => w.str.trim()).sort((a, b) => a.x - b.x);
      if (words.length === 0) return null;
      if (!grid) return joinWords(r.words.sort((a, b) => a.x - b.x), r.y);
      // A scene heading's numbers, in either margin.
      const isNumber = (w: PdfWord | undefined) => !!w && NUMBER_ONLY.test(w.str.trim());
      if (words.length > 1 && isNumber(words[0]) && SCENE.test(words[1].str.trim())) words = words.slice(1);
      if (words.length > 1 && isNumber(words[words.length - 1]) && SCENE.test(words[0].str.trim())) words = words.slice(0, -1);
      const gapAfter = (i: number) => words[i + 1].x - (words[i].x + words[i].w);
      for (let i = 0; i < words.length - 1; i++) {
        if (gapAfter(i) > words[i].size * 2) {
          return { ...joinWords(words.slice(0, i + 1), r.y), second: joinWords(words.slice(i + 1), r.y) };
        }
      }
      return joinWords(words, r.y);
    })
    .filter((r): r is Row => !!r && !!r.text);
}

/** The most common left edge among rows. */
function commonEdges(rows: Row[]): number[] {
  const counts = new Map<number, number>();
  for (const r of rows) {
    const k = Math.round(r.x / 3) * 3;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);
}

/** The text's left edge: the leftmost edge that many rows share (not a margin scene number). */
function leftEdge(rows: Row[]): number {
  const edges = commonEdges(rows);
  const busy = edges.filter((k) => rows.filter((r) => Math.abs(r.x - k) <= 3).length >= Math.max(2, rows.length * 0.05));
  return Math.min(...(busy.length ? busy : edges.slice(0, 1)));
}

/**
 * A screenplay opens scenes with INT. and EXT., in one size of type, with cues
 * standing two inches in from the text. Prose has none of that together.
 */
export function looksLikeScreenplay(pages: PdfPage[]): boolean {
  const rows = pages.flatMap((page) => rowsOf(page, true));
  if (rows.length === 0) return false;
  const base = leftEdge(rows);
  const scenes = rows.filter((r) => SCENE.test(r.text) && Math.abs(r.x - base) < 30).length;
  const cues = rows.filter((r) => r.x - base >= 120 && r.x - base <= 190).length;
  return scenes >= 1 && (cues >= 1 || rows.length < 8) && new Set(rows.map((r) => Math.round(r.size))).size <= 3;
}

/** The screenplay in a PDF: its lines and, if page one is one, its title page. */
export function pdfToScript(pages: PdfPage[]): { lines: ScriptLine[]; titlePage: TitlePage | null } {
  const allRows = pages.map((page) => rowsOf(page, true));
  const base = leftEdge(allRows.flat());
  const lines: ScriptLine[] = [];
  let titlePage: TitlePage | null = null;

  let startPage = 0;
  if (allRows[0] && !allRows[0].some((r) => SCENE.test(r.text)) && allRows.length > 1 && allRows[0].length < 26) {
    titlePage = readTitlePage(allRows[0], pages[0]);
    startPage = 1;
  }

  /** The speech left open by (MORE), resuming over the page break. */
  let pendingCue: string | null = null;
  let prev: { element: ElementType; y: number; size: number } | null = null;

  for (let p = startPage; p < allRows.length; p++) {
    const page = pages[p];
    prev = null;
    const rows = allRows[p];
    for (let r = 0; r < rows.length; r++) {
      const row = rows[r];
      // The page number and any revision header, up in the top margin.
      const header = row.y > page.height - 72 + 2;
      if (header && (NUMBER_ONLY.test(row.text) || NUMBER_ONLY.test(row.second?.text ?? "") || /Rev\./.test(row.text))) continue;
      // Dual dialogue: the run of rows with two columns, each read through.
      if (row.second) {
        let end = r;
        while (rows[end + 1]?.second) end++;
        pushColumns(rows.slice(r, end + 1), lines);
        r = end;
        prev = null;
        continue;
      }
      const text = row.text.replace(/\s+\*$/, ""); // a revision star
      const x = row.x;
      if (!text || text === "*" || NUMBER_ONLY.test(text)) continue;

      if (text === "(MORE)") {
        pendingCue = lastCue(lines);
        continue;
      }
      const dx = x - base;
      // A continued speech: the repeated cue goes, and its words join the speech.
      if (pendingCue && dx > 120 && text.replace(/\s*\(CONT['’]D\)$/, "").trim().toUpperCase() === pendingCue.toUpperCase()) {
        prev = { element: "dialogue", y: row.y, size: row.size };
        pendingCue = null;
        continue;
      }

      let element = classify(text, dx, row, page);
      const line = row.size;
      const adjacent = prev && Math.abs(prev.y - row.y) <= line * 1.45;
      // A wrapped row carries on the line above.
      const continues =
        adjacent && prev && lines.length > 0 && !(SCENE.test(text) && dx < 30) &&
        (prev.element === element ||
          (prev.element === "parenthetical" && element === "parenthetical") ||
          (prev.element === "action" && dx < 30)) &&
        element !== "character" && prev.element !== "scene_heading" && prev.element !== "transition";
      if (continues && prev) {
        element = prev.element;
        lines[lines.length - 1].text += ` ${text}`;
      } else {
        // A paragraph after a speech at the same indent is still what its place says.
        if (element === "dialogue" && adjacent && prev?.element === "character") element = "dialogue";
        lines.push({ element, text });
      }
      prev = { element, y: row.y, size: row.size };
    }
  }
  return { lines, titlePage };
}

/** Two columns side by side: the left speech, then the right one marked dual. */
function pushColumns(rows: Row[], lines: ScriptLine[]) {
  const read = (cells: Row[], dual: boolean) => {
    let last: ScriptLine | null = null;
    const edge = Math.min(...cells.map((c) => c.x));
    for (const cell of cells) {
      const element: ElementType =
        isCaps(cell.text) && cell.x - edge > 10
          ? "character"
          : cell.text.startsWith("(")
            ? "parenthetical"
            : "dialogue";
      if (last && last.element === element && element !== "character") {
        last.text += ` ${cell.text}`;
      } else {
        last = { element, text: cell.text, ...(dual ? { dual: true } : {}) };
        lines.push(last);
      }
    }
  };
  // A row may hold only one side, once the shorter speech has ended.
  read(rows.map((r) => r), false);
  read(rows.flatMap((r) => (r.second ? [r.second] : [])), true);
}

function lastCue(lines: ScriptLine[]): string | null {
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].element === "character") return lines[i].text.replace(/\s*\(CONT['’]D\)$/, "").trim();
    if (lines[i].element === "scene_heading") return null;
  }
  return null;
}

function classify(text: string, dx: number, row: Row, page: PdfPage): ElementType {
  if (SCENE.test(text) && dx < 30) return "scene_heading";
  if (isCaps(text) && dx > 30) {
    if (/^END OF ACT/.test(text)) return "end_of_act";
    if (/^ACT\s+\S+$/.test(text)) return "new_act";
  }
  const rightMargin = page.width - 72;
  const rightSet = row.right > rightMargin - 50 && dx > 60;
  if ((isCaps(text) && /TO:$/.test(text)) || (rightSet && /(TO:|FADE|CUT|DISSOLVE|BLACK\.?)$|^(FADE|CUT|DISSOLVE)/i.test(text))) return "transition";
  if (dx >= 120) return "character";
  if (dx >= 90) return text.startsWith("(") ? "parenthetical" : "dialogue";
  if (dx >= 45) return text.startsWith("(") && text.endsWith(")") ? "parenthetical" : "dialogue";
  return "action";
}

/** Title page, by what is centred at the top and what credit lines say. */
function readTitlePage(rows: Row[], page: PdfPage): TitlePage | null {
  const centred = rows.filter((r) => Math.abs((r.x + r.right) / 2 - page.width / 2) < 30);
  if (centred.length === 0) return null;
  const tp: TitlePage = { title: centred[0].text };
  const by = centred.findIndex((r) => /^(written\s+)?by$/i.test(r.text));
  if (by >= 0) {
    tp.credit = centred[by].text;
    if (centred[by + 1]) tp.author = centred[by + 1].text;
  } else if (centred[1]) {
    tp.author = centred[1].text;
  }
  const rest = rows.filter((r) => !centred.includes(r));
  if (rest.length) tp.contact = rest.map((r) => r.text).join("\n");
  return tp;
}

/** Prose in a PDF: paragraphs by the gaps between lines, headings by bigger type. */
export function pdfToPlainDoc(pages: PdfPage[]): JSONContent {
  const rows = pages.map((page) => rowsOf(page));
  const sizes = rows.flat().map((r) => Math.round(r.size));
  const counts = new Map<number, number>();
  for (const s of sizes) counts.set(s, (counts.get(s) ?? 0) + 1);
  const body = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 12;

  const content: JSONContent[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) content.push({ type: "paragraph", content: [{ type: "text", text: para.join(" ") }] });
    para = [];
  };
  for (const [index, pageRows] of rows.entries()) {
    const page = pages[index];
    let prevY: number | null = null;
    for (const row of pageRows) {
      // A lone page number at the head or foot of the page is not writing.
      const edge = row.y > page.height - 60 || row.y < 60;
      if (edge && NUMBER_ONLY.test(row.text)) continue;
      const bigger = row.size >= body + 1.5;
      if (bigger) {
        flush();
        const level = row.size >= body * 1.6 ? 1 : row.size >= body * 1.3 ? 2 : 3;
        const last = content[content.length - 1];
        // A heading that wrapped is one heading.
        if (last?.type === "heading" && last.attrs?.level === level && prevY != null && prevY - row.y < row.size * 1.6) {
          last.content![0].text += ` ${row.text}`;
        } else {
          content.push({ type: "heading", attrs: { level }, content: [{ type: "text", text: row.text }] });
        }
        prevY = row.y;
        continue;
      }
      if (prevY != null && prevY - row.y > row.size * 1.75) flush();
      const bullet = /^[•◦‣⁃-]\s/.test(row.text);
      if (bullet) flush();
      para.push(row.text);
      prevY = row.y;
    }
  }
  flush();
  return { type: "doc", content: content.length ? content : [{ type: "paragraph" }] };
}

/** The words of a PDF file, by page. */
export async function readPdf(buf: ArrayBuffer): Promise<PdfPage[]> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = "/pdf/pdf.worker.min.mjs";
  let task;
  try {
    task = await pdfjs.getDocument({ data: new Uint8Array(buf), isEvalSupported: false, disableFontFace: true }).promise;
  } catch (err) {
    if ((err as { name?: string })?.name === "PasswordException") {
      throw new Error("That PDF is password protected. Remove the password and import it again.");
    }
    throw new Error("That file could not be read as a PDF.");
  }
  const pages: PdfPage[] = [];
  for (let n = 1; n <= task.numPages; n++) {
    const page = await task.getPage(n);
    const view = page.getViewport({ scale: 1 });
    const text = await page.getTextContent();
    const words: PdfWord[] = [];
    for (const item of text.items) {
      if (!("str" in item)) continue;
      const [a, b, , , e, f] = item.transform as number[];
      words.push({ str: item.str, x: e, y: f, w: item.width, size: Math.hypot(a, b) || item.height });
    }
    pages.push({ width: view.width, height: view.height, words });
  }
  await task.destroy();
  if (!pages.some((p) => p.words.some((w) => w.str.trim()))) {
    throw new Error("This PDF has no text in it, only pictures of pages (a scan), so there is nothing to import.");
  }
  return pages;
}
