import type { ElementType } from "@/lib/editor/elements";
import type { ScriptLine } from "@/types/screenplay";
import {
  LAYOUT,
  LEFT,
  CHAR_W,
  LINE,
  LINES_PER_PAGE,
  TOP_BASELINE,
  rightAlignX,
  sanitize,
  wrap,
} from "./layout";
import { cueBaseName } from "@/lib/editor/outline";

/**
 * Rule-aware screenplay pagination.
 *
 * Produces, for a flat ScriptLine[], the sequence of pages and the exact draw
 * positions for each line, applying the professional rules:
 *
 *   - A character cue never ends a page; it is kept with its parenthetical(s)
 *     and enough of its first dialogue that a legal continuation is possible.
 *   - A scene heading never ends a page (kept with the line after it).
 *   - A parenthetical never ends a page (kept with the dialogue after it).
 *   - A dialogue block that overflows a page ends with "(MORE)" at the dialogue
 *     indent and resumes with "NAME (CONT'D)" at the cue indent on the next
 *     page, with at least two lines on each side of the break.
 *   - Action paragraphs avoid leaving a single orphan/widow line.
 *
 * IMPORTANT: (MORE) and NAME (CONT'D) exist ONLY as draw instructions here.
 * They are never written back into ScriptLine[] or the ProseMirror document, so
 * the cast list, Fountain export, find/replace, etc. are untouched. Do not
 * refactor this engine to emit ScriptLine[].
 */

const MIN_SPLIT_LINES = 2; // >=2 dialogue rows above (MORE) and below (CONT'D)
const KEEP_HEADING_WITH_NEXT = true;
const AVOID_ACTION_WIDOWS = true;

/** A single drawable line: text at an absolute (x, y) pdf-lib baseline. */
export interface DrawOp {
  text: string;
  x: number;
  y: number;
}
/** One laid-out page (1-based number); the renderer omits the stamp on page 1. */
export interface Page {
  number: number;
  ops: DrawOp[];
}
export interface PaginateResult {
  pages: Page[];
  pageCount: number;
}

interface Row {
  text: string;
  x: number;
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
}

/** How many slots a cue must reserve for its first dialogue block of N rows. */
function firstDialogueKeep(n: number): number {
  if (n === 0) return 0;
  // A block of >=4 rows can split (2 above + 2 below); reserve 2 rows + (MORE).
  // A shorter block cannot split, so it must fit whole.
  if (n >= 2 * MIN_SPLIT_LINES) return MIN_SPLIT_LINES + 1;
  return n;
}

/**
 * Slots a "keep with next" block (a character cue, a parenthetical, or a scene
 * heading) needs at a page bottom to be legal: its own rows, plus any
 * consecutive parentheticals, plus enough of what follows. A following dialogue
 * reserves enough for a legal split (or the whole short block). A following
 * block that ALSO keeps-with-next (a heading or another cue) recurses, so a
 * cue -> heading -> action chain stays together rather than the heading sliding
 * away and stranding the cue. Anything else (action, transition) reserves one
 * row. A block at end-of-document reserves nothing extra (a trailing cue or
 * heading legitimately ends the final page). Depth-bounded against degenerate
 * chains.
 */
function keepSlotsFrom(blocks: Block[], i: number, depth = 0): number {
  // The block's own leading blank (spaceBefore) is handled by the caller; this
  // counts its rows plus the blanks + rows of every successor it reserves.
  let slots = blocks[i].rows.length;
  let j = i + 1;
  while (j < blocks.length && blocks[j].kind === "parenthetical") {
    slots += blocks[j].spaceBefore + blocks[j].rows.length;
    j++;
  }
  if (j < blocks.length) {
    const next = blocks[j];
    if (next.kind === "dialogue") {
      slots += next.spaceBefore + firstDialogueKeep(next.rows.length);
    } else if (depth < 8 && (next.kind === "scene_heading" || next.kind === "character")) {
      slots += next.spaceBefore + keepSlotsFrom(blocks, j, depth + 1);
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
    for (const w of wrap(b.text, maxChars)) rows.push({ text: w, x });
  }
  return rows;
}

/** Pass 1: turn lines into laid-out blocks of physical rows. */
function buildBlocks(lines: ScriptLine[]): Block[] {
  const blocks: Block[] = [];
  let currentCue: string | undefined;

  for (const line of lines) {
    const kind = line.element;
    const el = LAYOUT[kind] ?? LAYOUT.action;
    const text = sanitize(line.text ?? "");
    const rows: Row[] = wrap(text, el.maxChars).map((s) => ({
      text: s,
      x: el.rightAlign ? rightAlignX(s) : el.x,
    }));

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
    });
  }

  // Precompute the keep-with-next room for every block that must not be stranded
  // at a page bottom: character cues, parentheticals, and scene headings.
  for (let i = 0; i < blocks.length; i++) {
    const k = blocks[i].kind;
    if (k === "character" || k === "parenthetical" || k === "scene_heading") {
      blocks[i].keepWithNextSlots = keepSlotsFrom(blocks, i);
    }
  }

  return blocks;
}

/** Pass 2: place blocks onto pages, applying the break rules. */
export function paginate(lines: ScriptLine[]): PaginateResult {
  const blocks = buildBlocks(lines);

  const pages: Page[] = [];
  let pageNumber = 1;
  let ops: DrawOp[] = [];
  let y = TOP_BASELINE;
  let usedSlots = 0;
  let atPageTop = true;

  const remainingSlots = () => LINES_PER_PAGE - usedSlots;
  const place = (text: string, x: number) => {
    ops.push({ text, x, y });
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
    pages.push({ number: pageNumber, ops });
    pageNumber++;
    ops = [];
    y = TOP_BASELINE;
    usedSlots = 0;
    atPageTop = true;
  };

  /** Place a dialogue run, splitting with (MORE)/(CONT'D) as needed. */
  const placeDialogue = (rows: Row[], cueName?: string) => {
    let idx = 0;
    while (idx < rows.length) {
      const cap = remainingSlots();
      const left = rows.length - idx;
      if (left <= cap) {
        for (; idx < rows.length; idx++) place(rows[idx].text, rows[idx].x);
        return;
      }
      const linesHere = cap - 1; // reserve the bottom slot for (MORE)
      const carry = left - linesHere;
      if (linesHere >= MIN_SPLIT_LINES && carry >= MIN_SPLIT_LINES) {
        for (let k = 0; k < linesHere; k++, idx++) place(rows[idx].text, rows[idx].x);
        place("(MORE)", LAYOUT.dialogue.x);
        newPage();
        if (cueName) place(`${cueName} (CONT'D)`, LAYOUT.character.x);
      } else if (atPageTop) {
        // The block alone exceeds a whole page: force progress.
        const forced = Math.max(1, cap - 1);
        for (let k = 0; k < forced && idx < rows.length; k++, idx++) {
          place(rows[idx].text, rows[idx].x);
        }
        if (idx < rows.length) {
          place("(MORE)", LAYOUT.dialogue.x);
          newPage();
          if (cueName) place(`${cueName} (CONT'D)`, LAYOUT.character.x);
        }
      } else if (idx > 0) {
        // Some rows of this block are already on the page: mark the interruption
        // and re-cue the continuation on the next page.
        if (remainingSlots() >= 1) place("(MORE)", LAYOUT.dialogue.x);
        newPage();
        if (cueName) place(`${cueName} (CONT'D)`, LAYOUT.character.x);
      } else {
        // The block has not started here: move it whole to the next page with no
        // (MORE)/(CONT'D), since nothing was interrupted.
        newPage();
      }
    }
  };

  /** Place an action paragraph, avoiding a single orphan/widow line. */
  const placeAction = (rows: Row[]) => {
    const cap = remainingSlots();
    if (rows.length <= cap) {
      for (const r of rows) place(r.text, r.x);
      return;
    }
    let linesHere = cap;
    if (AVOID_ACTION_WIDOWS && rows.length - linesHere < MIN_SPLIT_LINES) {
      linesHere = rows.length - MIN_SPLIT_LINES; // keep >=2 on the next page
    }
    if (linesHere < MIN_SPLIT_LINES) {
      newPage();
      placeAction(rows); // fresh page has full capacity
      return;
    }
    for (let k = 0; k < linesHere; k++) place(rows[k].text, rows[k].x);
    newPage();
    placeAction(rows.slice(linesHere));
  };

  /** Place an atomic block, flowing across a break only if taller than a page. */
  const placeFlow = (rows: Row[]) => {
    for (const r of rows) {
      if (remainingSlots() <= 0) newPage();
      place(r.text, r.x);
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
      for (let k = 0; k < canDraw; k++) {
        const l = leftRows[row + k];
        const r = rightRows[row + k];
        if (l) ops.push({ text: l.text, x: l.x, y: startY - k * LINE });
        if (r) ops.push({ text: r.text, x: r.x, y: startY - k * LINE });
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
      placeDualPair(pair.left, pair.right);
      bi += pair.left.length + pair.right.length;
      continue;
    }

    const block = blocks[bi];
    bi++;

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

    if (block.splittable) {
      placeDialogue(block.rows, block.cueName);
    } else if (block.kind === "action" && AVOID_ACTION_WIDOWS) {
      placeAction(block.rows);
    } else {
      placeFlow(block.rows);
    }
  }

  if (ops.length > 0 || pages.length === 0) {
    pages.push({ number: pageNumber, ops });
  }

  return { pages, pageCount: pages.length };
}
