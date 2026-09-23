import type { ElementType } from "@/lib/editor/elements";
import type { ScriptLine } from "@/types/screenplay";
import {
  LAYOUT,
  LEFT,
  CHAR_W,
  LINE,
  LINES_PER_PAGE,
  RIGHT_EDGE,
  TOP_BASELINE,
  rightAlignX,
  sanitize,
  sanitizeLoose,
  wrap,
} from "./layout";
import { cueBaseName } from "@/lib/editor/outline";
import { computeContinuations, CONTD } from "@/lib/editor/contd";
import { ensureParentheticalParens } from "./flatten";
import { findDualPairs } from "@/lib/editor/dualLayout";
import {
  MIN_SPLIT_LINES,
  chooseSplit,
  firstSplitRows,
  splitOptions,
  type SplitOption,
} from "./splitRules";

/**
 * Rule-aware screenplay pagination.
 *
 * Produces, for a flat ScriptLine[], the sequence of pages and the exact draw
 * positions for each line, applying the rules Final Draft and Arc Studio use.
 * Checked page for page against Arjun's own 81-page Arc Studio export
 * (paginateArc.test.ts): every page starts on the same line Arc starts it on.
 *
 *   - 54 lines of text per page (1in top and bottom margins, 6 lines/inch).
 *   - A scene heading never ends a page: it keeps at least two lines of the
 *     action under it, and when that action is a single line, whatever follows
 *     it as well (so a heading is never left with one line and a stranded cue).
 *   - A character cue never ends a page; it is kept with its parenthetical(s)
 *     and enough of its speech that the speech either fits or can legally break.
 *   - A parenthetical never ends a page (kept with the dialogue after it).
 *   - Dialogue and action break only at the end of a sentence, with at least
 *     two lines on each side. The carried text starts a fresh line on the next
 *     page. A broken speech ends with "(MORE)" at the cue indent on the line
 *     just below the page's last line (inside the bottom margin, where Final
 *     Draft and Arc Studio put it) and resumes under "NAME (CONT'D)".
 *   - A paragraph with no usable sentence end moves whole to the next page; one
 *     taller than a whole page fills the page line by line.
 *
 * IMPORTANT: (MORE) and NAME (CONT'D) exist ONLY as draw instructions here.
 * They are never written back into ScriptLine[] or the ProseMirror document, so
 * the cast list, Fountain export, find/replace, etc. are untouched. Do not
 * refactor this engine to emit ScriptLine[].
 */

const KEEP_HEADING_WITH_NEXT = true;
/** Lines of action a scene heading must keep beneath it on its page. */
const HEADING_KEEP_LINES = 2;

/** A single drawable line: text at an absolute (x, y) pdf-lib baseline. */
export interface DrawOp {
  text: string;
  x: number;
  y: number;
  /** Draw in the bold face. The standard format has no bold lines; kept for
      the scene-number path and any future emphasis. */
  bold?: boolean;
}
/** One laid-out page (1-based number); the renderer omits the stamp on page 1. */
export interface Page {
  number: number;
  ops: DrawOp[];
  /**
   * Index (into the input ScriptLine[]) of the first source line whose content
   * opens this page. Used by page locking to fingerprint each page's anchor so
   * inserted material can be assigned A-page letters. Undefined only for a page
   * with no real content (e.g. an empty trailing page).
   */
  startLine?: number;
}
export interface PaginateResult {
  pages: Page[];
  pageCount: number;
}

interface Row {
  text: string;
  x: number;
  /** Draw in the bold face (unused by the default format; kept for callers). */
  bold?: boolean;
  /** The source line is revised and needs a right-margin marker. */
  revised?: boolean;
}
interface Block {
  kind: ElementType;
  /** Sanitized text before wrapping, kept so dual columns can re-wrap narrower. */
  text: string;
  spaceBefore: number;
  rows: Row[];
  splittable: boolean;
  /** True for the right-column cue/body of a dual-dialogue block. */
  dual: boolean;
  /** For dialogue: the speaker name to repeat as NAME (CONT'D) after a split. */
  cueName?: string;
  /** For a character cue: slots needed so the cue can legally start a page. */
  keepWithNextSlots?: number;
  /** 1-based scene number, set on scene_heading blocks (for margin printing). */
  sceneNumber?: number;
  /** True when the line is marked revised (prints a margin asterisk). */
  revised?: boolean;
  /** Dialogue and action: every legal sentence break, computed once. */
  splits?: SplitOption[];
}

/** Rows for one element's text, positioned (transitions right-aligned,
    parenthetical continuation lines hung one character in). */
function layoutRows(kind: ElementType, text: string): Row[] {
  const el = LAYOUT[kind] ?? LAYOUT.action;
  const hang = el.hang ?? 0;
  return wrap(text, el.maxChars, hang).map((s, i) => ({
    text: s,
    x: el.rightEdge != null ? rightAlignX(s, el.rightEdge) : el.x + (i > 0 ? hang * CHAR_W : 0),
  }));
}

/** Rows a piece of dialogue or action wraps to. */
function rowCount(kind: ElementType, text: string): number {
  const el = LAYOUT[kind] ?? LAYOUT.action;
  return wrap(text, el.maxChars, el.hang ?? 0).length;
}

/**
 * How many slots a cue must reserve for the speech under it: the whole speech
 * when it cannot legally break, otherwise the fewest lines a sentence break
 * could leave above (MORE). (MORE) itself sits below the page's last line, so
 * it needs no slot of its own.
 */
function firstDialogueKeep(block: Block): number {
  const n = block.rows.length;
  if (n === 0) return 0;
  return firstSplitRows(block.splits ?? []) ?? n;
}

/**
 * Slots a "keep with next" block (a character cue, a parenthetical, or a scene
 * heading) needs at a page bottom to be legal: its own rows, plus any
 * consecutive parentheticals, plus enough of what follows. A following dialogue
 * reserves enough for a legal break (or the whole speech). A following block
 * that ALSO keeps-with-next (a heading or another cue) recurses, so a cue ->
 * heading -> action chain stays together rather than the heading sliding away
 * and stranding the cue. A scene heading keeps two lines of the action under
 * it; when that action is one line, the heading also keeps what follows the
 * action (a cue with its speech, or more action). Anything else reserves one
 * row. A block at end-of-document reserves nothing extra (a trailing cue or
 * heading legitimately ends the final page). Depth-bounded against degenerate
 * chains.
 */
function keepSlotsFrom(
  blocks: Block[],
  i: number,
  pairHeights: Map<number, number>,
  depth = 0
): number {
  // The block's own leading blank (spaceBefore) is handled by the caller; this
  // counts its rows plus the blanks + rows of every successor it reserves.
  // A dual pair is placed whole, so a block kept with one keeps the whole
  // pair, as tall as its taller column in the narrow dual widths.
  const keepFrom = (j: number) =>
    pairHeights.get(j) ?? keepSlotsFrom(blocks, j, pairHeights, depth + 1);
  let slots = blocks[i].rows.length;
  let j = i + 1;
  while (j < blocks.length && blocks[j].kind === "parenthetical") {
    slots += blocks[j].spaceBefore + blocks[j].rows.length;
    j++;
  }
  if (j < blocks.length) {
    const next = blocks[j];
    if (next.kind === "dialogue") {
      slots += next.spaceBefore + firstDialogueKeep(next);
    } else if (depth < 8 && (next.kind === "scene_heading" || next.kind === "character")) {
      slots += next.spaceBefore + keepFrom(j);
    } else if (blocks[i].kind === "scene_heading" && next.kind === "action") {
      const rows = next.rows.length;
      slots += next.spaceBefore + Math.min(HEADING_KEEP_LINES, rows);
      const after = blocks[j + 1];
      if (rows < HEADING_KEEP_LINES && after) {
        if (depth < 8 && (after.kind === "character" || after.kind === "scene_heading")) {
          slots += after.spaceBefore + keepFrom(j + 1);
        } else {
          slots += after.spaceBefore + Math.min(HEADING_KEEP_LINES - rows, after.rows.length);
        }
      }
    } else {
      slots += next.spaceBefore + 1;
    }
  }
  return slots;
}

// Dual (side-by-side) dialogue: two narrow columns inside the text area. The
// left column starts at the left margin; the right column 3 inches over. Each
// column is re-wrapped narrower so the two fit the 6in text area.
const DUAL_LEFT_X = LEFT;
const DUAL_RIGHT_X = LEFT + 30 * CHAR_W; // ~3in to the right of the left margin

// Revision asterisk x, in the right margin, clear of the right scene number.
const REVISION_X = RIGHT_EDGE + 2 * CHAR_W;

function dualColumn(originX: number, kind: ElementType): { x: number; maxChars: number } {
  if (kind === "character") return { x: originX + 4 * CHAR_W, maxChars: 22 };
  if (kind === "parenthetical") return { x: originX + 3 * CHAR_W, maxChars: 20 };
  return { x: originX, maxChars: 25 }; // dialogue
}

/** Lay one dual column's blocks out as physical rows at the column origin. */
function buildDualRows(blocks: Block[], originX: number): Row[] {
  const rows: Row[] = [];
  for (const b of blocks) {
    const { x, maxChars } = dualColumn(originX, b.kind);
    for (const w of wrap(b.text, maxChars)) {
      rows.push({ text: w, x, ...(b.revised ? { revised: true } : {}) });
    }
  }
  return rows;
}

/** Pass 1: turn lines into laid-out blocks of physical rows. */
function buildBlocks(
  lines: ScriptLine[],
  contdFlags?: boolean[] | null,
  keepUnicode?: boolean
): Block[] {
  const blocks: Block[] = [];
  const clean = keepUnicode ? sanitizeLoose : sanitize;
  let currentCue: string | undefined;
  let sceneCounter = 0;

  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    const kind = line.element;
    const el = LAYOUT[kind] ?? LAYOUT.action;
    // Auto (CONT'D): a continuation cue prints NAME (CONT'D); the base name is
    // still recovered by cueBaseName, so currentCue and the cast stay correct.
    const sourceText =
      kind === "character" && contdFlags?.[li]
        ? (line.text ?? "") + CONTD
        : line.text ?? "";
    const rawText =
      kind === "parenthetical"
        ? ensureParentheticalParens(sourceText)
        : sourceText;
    const text = clean(rawText);
    // A dual line is drawn in a narrow column (placeDualPair / placeDualSolo
    // re-wrap it there); its rows are counted in that column everywhere else
    // too, so a keep rule reserving room for it reserves what it will take.
    const rows: Row[] =
      line.dual === true
        ? buildDualRows([{ kind, text } as Block], DUAL_RIGHT_X)
        : layoutRows(kind, text);

    if (kind === "character") {
      currentCue = cueBaseName(text).toUpperCase() || undefined;
    } else if (kind === "scene_heading" || kind === "action" || kind === "transition") {
      currentCue = undefined;
    }
    // parenthetical and dialogue keep currentCue.

    blocks.push({
      kind,
      text,
      spaceBefore: el.spaceBefore,
      rows,
      splittable: kind === "dialogue",
      dual: line.dual === true,
      cueName: kind === "dialogue" ? currentCue : undefined,
      sceneNumber: kind === "scene_heading" ? ++sceneCounter : undefined,
      revised: line.revised === true,
      // A dual line never breaks across a page (it is placed whole), so it has
      // no sentence breaks to offer.
      splits:
        (kind === "dialogue" || kind === "action") && line.dual !== true
          ? splitOptions(text, (piece) => rowCount(kind, piece))
          : undefined,
    });
  }

  // The height of every dual pair, in the narrow columns it is drawn in, by
  // the index of its left cue (what a kept block before it has to reserve).
  const pairHeights = new Map<number, number>();
  for (const p of findDualPairs(blocks)) {
    const left = buildDualRows(blocks.slice(p.leftStart, p.leftEnd), DUAL_LEFT_X).length;
    const right = buildDualRows(blocks.slice(p.rightStart, p.rightEnd), DUAL_RIGHT_X).length;
    pairHeights.set(p.leftStart, Math.max(left, right));
  }

  // Precompute the keep-with-next room for every block that must not be stranded
  // at a page bottom: character cues, parentheticals, and scene headings.
  for (let i = 0; i < blocks.length; i++) {
    const k = blocks[i].kind;
    if (k === "character" || k === "parenthetical" || k === "scene_heading") {
      blocks[i].keepWithNextSlots = keepSlotsFrom(blocks, i, pairHeights);
    }
  }

  return blocks;
}

/** Pass 2: place blocks onto pages, applying the break rules. */
export function paginate(
  lines: ScriptLine[],
  opts?: { sceneNumbers?: boolean; autoContd?: boolean; keepUnicode?: boolean }
): PaginateResult {
  const contdFlags = opts?.autoContd ? computeContinuations(lines) : null;
  const blocks = buildBlocks(lines, contdFlags, opts?.keepUnicode);
  const sceneNumbers = opts?.sceneNumbers ?? false;

  const pages: Page[] = [];
  let pageNumber = 1;
  let ops: DrawOp[] = [];
  let y = TOP_BASELINE;
  let usedSlots = 0;
  let atPageTop = true;
  let revisedMark = false; // set per block; prints a margin asterisk on each row
  // The source-line index whose content is being placed, and the index that
  // opened the current page (for page-lock anchoring). markStart records the
  // first real content on a fresh page; newPage attaches it and resets it.
  let activeLineIndex = 0;
  let curStartLine: number | undefined = undefined;
  const markStart = () => {
    if (curStartLine === undefined) curStartLine = activeLineIndex;
  };

  const remainingSlots = () => LINES_PER_PAGE - usedSlots;
  const place = (text: string, x: number, bold?: boolean) => {
    markStart();
    ops.push({ text, x, y, ...(bold ? { bold: true } : {}) });
    if (revisedMark) ops.push({ text: "*", x: REVISION_X, y });
    y -= LINE;
    usedSlots++;
    atPageTop = false;
  };
  const advanceBlank = (n: number) => {
    for (let k = 0; k < n; k++) {
      y -= LINE;
      usedSlots++;
    }
    if (n > 0) atPageTop = false;
  };
  const newPage = () => {
    pages.push({ number: pageNumber, ops, startLine: curStartLine });
    pageNumber++;
    ops = [];
    y = TOP_BASELINE;
    usedSlots = 0;
    atPageTop = true;
    curStartLine = undefined;
  };

  /** (MORE) sits on the line just below the page's last line, at the cue
      indent: the bottom-margin slot Final Draft and Arc Studio print it in. */
  const placeMore = () => {
    markStart();
    ops.push({ text: "(MORE)", x: LAYOUT.character.x, y });
  };

  /**
   * Place a speech or an action paragraph, breaking it across pages only at the
   * end of a sentence, with at least two lines each side. A speech that breaks
   * ends with (MORE) and resumes under NAME (CONT'D). With no usable sentence
   * end the paragraph moves whole to the next page; one taller than a whole
   * page fills the page line by line, because nothing else can make progress.
   */
  const placeParagraph = (block: Block) => {
    const kind = block.kind;
    const speech = kind === "dialogue";
    let text = block.text;
    let rows = block.rows;
    let splits = block.splits ?? [];
    // True while the only thing on this page is the NAME (CONT'D) that resumes
    // this speech: moving on would leave that line alone on its page.
    let resumed = false;
    for (;;) {
      const room = remainingSlots();
      if (rows.length <= room) {
        for (const r of rows) place(r.text, r.x);
        return;
      }
      const split = chooseSplit(splits, room);
      if (split) {
        const head = layoutRows(kind, text.slice(0, split.offset));
        for (const r of head) place(r.text, r.x);
        text = text.slice(split.offset);
      } else if (
        atPageTop ||
        resumed ||
        (rows.length > LINES_PER_PAGE && room >= MIN_SPLIT_LINES)
      ) {
        // No sentence end fits and the paragraph cannot be moved to make
        // room (it already opens the page, or is taller than one): fill this
        // page line by line.
        const take = Math.max(1, room);
        for (const r of rows.slice(0, take)) place(r.text, r.x);
        text = rows
          .slice(take)
          .map((r) => r.text)
          .join(" ");
      } else {
        newPage();
        continue;
      }
      if (speech) placeMore();
      newPage();
      resumed = false;
      if (speech && block.cueName) {
        place(`${block.cueName} (CONT'D)`, LAYOUT.character.x);
        resumed = true;
      }
      rows = layoutRows(kind, text);
      splits = splitOptions(text, (piece) => rowCount(kind, piece));
    }
  };

  /** Place an atomic block, flowing across a break only if taller than a page. */
  const placeFlow = (rows: Row[]) => {
    for (const r of rows) {
      if (remainingSlots() <= 0) newPage();
      place(r.text, r.x, r.bold);
    }
  };

  /** Place a dual pair: the two cue clusters side by side, sharing a top line. */
  const placeDualPair = (leftBlocks: Block[], rightBlocks: Block[]) => {
    let leadingBlanks = atPageTop ? 0 : leftBlocks[0].spaceBefore;
    const leftRows = buildDualRows(leftBlocks, DUAL_LEFT_X);
    const rightRows = buildDualRows(rightBlocks, DUAL_RIGHT_X);
    const height = Math.max(leftRows.length, rightRows.length);

    // Treat the pair as atomic when it fits on a page; otherwise place where it
    // is and split both columns at the page boundary (no MORE/CONT'D; rare).
    if (!atPageTop && leadingBlanks + height > remainingSlots() && height <= LINES_PER_PAGE) {
      newPage();
      leadingBlanks = 0;
    }
    if (leadingBlanks > 0) {
      if (leadingBlanks >= remainingSlots()) newPage();
      else advanceBlank(leadingBlanks);
    }

    let row = 0;
    while (row < height) {
      if (remainingSlots() <= 0) newPage();
      const canDraw = Math.min(height - row, remainingSlots());
      const startY = y;
      markStart();
      for (let k = 0; k < canDraw; k++) {
        const l = leftRows[row + k];
        const r = rightRows[row + k];
        if (l) ops.push({ text: l.text, x: l.x, y: startY - k * LINE });
        if (r) ops.push({ text: r.text, x: r.x, y: startY - k * LINE });
        if (l?.revised || r?.revised) {
          ops.push({ text: "*", x: REVISION_X, y: startY - k * LINE });
        }
      }
      y = startY - canDraw * LINE;
      usedSlots += canDraw;
      atPageTop = false;
      row += canDraw;
    }
  };

  /** Place a single unpaired dual block in the right column (orphan import). */
  const placeDualSolo = (block: Block) => {
    let leadingBlanks = atPageTop ? 0 : block.spaceBefore;
    const rows = buildDualRows([block], DUAL_RIGHT_X);
    if (
      !atPageTop &&
      leadingBlanks + rows.length > remainingSlots() &&
      rows.length <= LINES_PER_PAGE
    ) {
      newPage();
      leadingBlanks = 0;
    }
    if (leadingBlanks > 0) {
      if (leadingBlanks >= remainingSlots()) newPage();
      else advanceBlank(leadingBlanks);
    }
    for (const r of rows) {
      if (remainingSlots() <= 0) newPage();
      place(r.text, r.x);
    }
  };

  /** True if blocks[i] starts a non-dual cue cluster paired with a dual one. */
  const dualPairAt = (i: number): { left: Block[]; right: Block[] } | null => {
    if (blocks[i].kind !== "character" || blocks[i].dual) return null;
    let leftEnd = i + 1;
    while (
      leftEnd < blocks.length &&
      !blocks[leftEnd].dual &&
      (blocks[leftEnd].kind === "parenthetical" || blocks[leftEnd].kind === "dialogue")
    ) {
      leftEnd++;
    }
    if (leftEnd >= blocks.length || blocks[leftEnd].kind !== "character" || !blocks[leftEnd].dual) {
      return null;
    }
    let rightEnd = leftEnd + 1;
    while (
      rightEnd < blocks.length &&
      blocks[rightEnd].dual &&
      (blocks[rightEnd].kind === "parenthetical" || blocks[rightEnd].kind === "dialogue")
    ) {
      rightEnd++;
    }
    return { left: blocks.slice(i, leftEnd), right: blocks.slice(leftEnd, rightEnd) };
  };

  let bi = 0;
  while (bi < blocks.length) {
    const pair = dualPairAt(bi);
    if (pair) {
      activeLineIndex = bi;
      placeDualPair(pair.left, pair.right);
      bi += pair.left.length + pair.right.length;
      continue;
    }

    activeLineIndex = bi;
    const block = blocks[bi];
    bi++;
    revisedMark = block.revised === true;

    // An unpaired dual block (orphan import / a 3rd speaker) renders in the right
    // column on its own, so the PDF matches the on-screen right-column indent
    // rather than falling through to the centered single-column position.
    if (block.dual) {
      placeDualSolo(block);
      continue;
    }

    let leadingBlanks = atPageTop ? 0 : block.spaceBefore;

    // Keep-with-next: a cue, a scene heading, or a parenthetical must not be
    // stranded at a page bottom. block.keepWithNextSlots is the room it needs.
    // Only break to a fresh page when the kept run would actually FIT there;
    // a run larger than a whole page cannot be kept together no matter what, so
    // forcing a break would only strand the predecessor.
    const keeps =
      block.kind === "character" ||
      block.kind === "parenthetical" ||
      (block.kind === "scene_heading" && KEEP_HEADING_WITH_NEXT);
    if (keeps && block.keepWithNextSlots != null) {
      const keep = block.keepWithNextSlots;
      const needed = leadingBlanks + keep;
      if (!atPageTop && needed > remainingSlots() && keep <= LINES_PER_PAGE) {
        newPage();
        leadingBlanks = 0;
      }
    }

    // Emit the blank rows before the element (suppressed at the top of a page).
    if (leadingBlanks > 0) {
      if (leadingBlanks >= remainingSlots()) {
        newPage();
      } else {
        advanceBlank(leadingBlanks);
      }
    }

    if (block.kind === "dialogue" || block.kind === "action") {
      placeParagraph(block);
    } else if (block.kind === "scene_heading" && sceneNumbers && block.sceneNumber != null) {
      // Print the scene number in both margins, level with the heading's first
      // row, then place the heading itself.
      if (remainingSlots() <= 0) newPage();
      const num = String(block.sceneNumber);
      const headY = y;
      ops.push({ text: num, x: Math.max(2, LEFT - (num.length + 1) * CHAR_W), y: headY });
      ops.push({ text: num, x: RIGHT_EDGE + CHAR_W, y: headY });
      for (const r of block.rows) {
        if (remainingSlots() <= 0) newPage();
        place(r.text, r.x, r.bold);
      }
    } else {
      placeFlow(block.rows);
    }
  }

  if (ops.length > 0 || pages.length === 0) {
    pages.push({ number: pageNumber, ops, startLine: curStartLine });
  }

  return { pages, pageCount: pages.length };
}
