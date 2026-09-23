import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, type EditorState } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import type { Node as PMNode } from "@tiptap/pm/model";
import { cueBaseName } from "./outline";
import { findDualPairs, type DualPair } from "./dualLayout";
import { LAYOUT, wrap } from "@/lib/export/layout";
import {
  MIN_SPLIT_LINES,
  chooseSplit,
  firstSplitRows,
  splitOptions,
  type SplitOption,
} from "@/lib/export/splitRules";

/**
 * Visual pagination: makes a single continuous editor LOOK like a stack of
 * separate US-Letter pages. It measures the top-level blocks and, at each page
 * boundary, inserts a transparent spacer widget that pushes the following
 * content down to the top of the next sheet. A separate backdrop
 * (PageBackdrop) draws the white sheets behind the text; the spacers leave the
 * gaps between sheets empty so no text ever lands in a gap.
 *
 * The BREAK RULES are the export engine's (lib/export/paginate.ts is the rule
 * authority, and matches Arc Studio page for page). The measured blocks are
 * reduced to line counts and fed to a pure planner (planPages, below) that
 * mirrors the export algorithm exactly: keep-with-next for headings, cues and
 * parentheticals, and dialogue and action broken only at the end of a sentence
 * (lib/export/splitRules.ts), with (MORE) under the page's last line and NAME
 * (CONT'D) at the top of the next.
 *
 * A break inside a block renders as one inline widget at the text offset where
 * the carried sentence starts: display:block spans for "(MORE)", the page-gap
 * spacer, and "NAME (CONT'D)". The block spans end the line early at the
 * sentence end, and the carried text starts a fresh line after them, which is
 * exactly how the PDF lays the two pieces out.
 *
 * Timing is what makes it feel solid. A pass runs in the same frame as the
 * edit that needs it (a microtask after ProseMirror's DOM update, before the
 * browser paints), so text never visibly spills into a margin or a gap and
 * then snaps back. When a pass moves the line the caret is on (a line pushed
 * onto the next page, or pulled back), the scroll position moves with it by
 * the same amount, so the caret stays exactly where it was on screen and the
 * page boundary appears to slide past it. Before this, the pass ran a beat
 * after the keystroke with no scroll, the caret dropped out of view, and the
 * next keystroke yanked the view down to find it.
 */

const key = new PluginKey<PagState>("pagination");

const DPI = 96;
export const PAGE_H = 11 * DPI; // 1056
export const PAGE_W = 8.5 * DPI; // 816
const MARGIN = 1 * DPI; // 96 (top/bottom page margin)
const TEXT_H = PAGE_H - 2 * MARGIN; // 864 (text area per page)
export const DESK_GAP = 24; // grey gap shown between sheets
export const STRIDE = PAGE_H + DESK_GAP; // 1080 (one page to the next)

const DEFAULT_LINE_H = 16; // 12pt Courier at 6 lines/inch (globals.css)

interface PagState {
  decos: DecorationSet;
  pages: number;
}

/* ============================================================================
   The pure planner: the export engine's break rules over line counts.
   Kept free of any DOM access so the parity tests can drive it directly
   (lib/export/paginateParity.test.ts).
   ========================================================================== */

/**
 * The text of a dialogue or action block, as the planner needs it to break
 * the block at a sentence end: how many rows any tail of it wraps to, and
 * where its sentences end. Offsets are into the block's whole text.
 */
export interface SplitModel {
  /** Rows the text from `from` to the end wraps to. */
  rows(from: number): number;
  /** Legal sentence breaks in the text from `from` (offsets into the whole text). */
  splits(from: number): SplitOption[];
  /** Offset where row `row` of the text from `from` begins (for a break that
      has to fall on a line boundary because no sentence end fits). */
  lineStart(from: number, row: number): number;
}

export interface PlanBlock {
  /** Element type ("scene_heading" | "action" | "character" | ...). */
  kind: string;
  /** Rendered line count of the block (>= 1). */
  rows: number;
  /** Blank line slots before the block (margin-top / line height). */
  spaceBefore: number;
  /** The node's dual attr (right column of a dual pair). */
  dual: boolean;
  /** Dialogue only: a named speaker exists, so NAME (CONT'D) can be drawn. */
  cue: boolean;
  /** Dialogue and action: the text model for sentence breaks. Without one the
      block can still break on a line boundary when nothing else can move. */
  model?: SplitModel | null;
}

export interface PlanBreak {
  /** Block index the page boundary belongs to. */
  index: number;
  /** 0 = break BEFORE the block (whole move); >0 = the block breaks inside,
      with this many rows of the current piece above the break. */
  row: number;
  /** Rows from the start of the block to this break, across every piece
      already placed (a line boundary in the block's own layout for line
      breaks; used only when the offset has to be found in the DOM). */
  rowFromStart: number;
  /** Where the carried text starts in the block's text, when known. */
  offset?: number;
  /** Rows the carried text takes, before any further break. */
  rowsAfter: number;
  /** Dialogue break: draw (MORE) under the page's last line. */
  more: boolean;
  /** Dialogue break: draw NAME (CONT'D) at the top of the next page. */
  contd: boolean;
}

export interface PlanResult {
  breaks: PlanBreak[];
  pageCount: number;
  /** Block index whose content opens each page (undefined for an empty page).
      Mirrors the export engine's Page.startLine (block index == line index). */
  pageStartBlocks: (number | undefined)[];
}

/** Lines of action a scene heading keeps beneath it (the export's rule). */
const HEADING_KEEP_LINES = 2;

/**
 * Dual-cluster exemption (v1): any dual-flagged block, and the non-dual cue
 * cluster immediately preceding a dual one (the pair's left column), never
 * splits. Mirrors the export engine's dualPairAt pairing rule.
 */
function dualExemptFlags(blocks: { kind: string; dual: boolean }[]): boolean[] {
  const n = blocks.length;
  const exempt = blocks.map((b) => b.dual);
  for (let i = 0; i < n; i++) {
    if (blocks[i].kind !== "character" || blocks[i].dual) continue;
    let leftEnd = i + 1;
    while (
      leftEnd < n &&
      !blocks[leftEnd].dual &&
      (blocks[leftEnd].kind === "parenthetical" || blocks[leftEnd].kind === "dialogue")
    ) {
      leftEnd++;
    }
    if (leftEnd < n && blocks[leftEnd].kind === "character" && blocks[leftEnd].dual) {
      for (let j = i; j < leftEnd; j++) exempt[j] = true;
    }
  }
  return exempt;
}

/** The export engine's firstDialogueKeep: the rows a cue reserves for the
    speech under it (the whole speech, or the shortest legal first piece).
    `exact` false skips the sentence search and returns the whole speech, an
    upper bound that is enough to prove a run fits. */
function firstDialogueKeep(b: PlanBlock, exact: boolean): number {
  if (b.rows === 0) return 0;
  if (!exact) return b.rows;
  const options = b.model?.splits(0);
  return (options && firstSplitRows(options)) ?? b.rows;
}

/** Mirror of the export engine's keepSlotsFrom: room a keep-with-next block
    needs at a page bottom, counting parenthetical chains, the reservation for
    a following speech, and a heading's two lines of action. Depth-bounded. */
function keepSlotsFrom(
  blocks: PlanBlock[],
  i: number,
  exact: boolean,
  pairHeights: Map<number, number>,
  depth = 0
): number {
  // A dual pair is placed whole: a block kept with one keeps the whole pair.
  const keepFrom = (j: number) =>
    pairHeights.get(j) ?? keepSlotsFrom(blocks, j, exact, pairHeights, depth + 1);
  let slots = blocks[i].rows;
  let j = i + 1;
  while (j < blocks.length && blocks[j].kind === "parenthetical") {
    slots += blocks[j].spaceBefore + blocks[j].rows;
    j++;
  }
  if (j < blocks.length) {
    const next = blocks[j];
    if (next.kind === "dialogue") {
      slots += next.spaceBefore + firstDialogueKeep(next, exact);
    } else if (depth < 8 && (next.kind === "scene_heading" || next.kind === "character")) {
      slots += next.spaceBefore + keepFrom(j);
    } else if (blocks[i].kind === "scene_heading" && next.kind === "action") {
      const rows = next.rows;
      slots += next.spaceBefore + Math.min(HEADING_KEEP_LINES, rows);
      const after = blocks[j + 1];
      if (rows < HEADING_KEEP_LINES && after) {
        if (depth < 8 && (after.kind === "character" || after.kind === "scene_heading")) {
          slots += after.spaceBefore + keepFrom(j + 1);
        } else {
          slots += after.spaceBefore + Math.min(HEADING_KEEP_LINES - rows, after.rows);
        }
      }
    } else {
      slots += next.spaceBefore + 1;
    }
  }
  return slots;
}

/**
 * Place the blocks onto pages of `linesPerPage` slots, applying the export
 * engine's rules line for line. Returns the boundaries: for each page break,
 * which block it belongs to and whether it is a whole-block move (row 0) or a
 * break inside the block (row > 0, with the (MORE)/(CONT'D) flags for a
 * speech).
 *
 * Known v1 divergences from the export engine, both deliberate:
 * - dual pairs place sequentially (the on-screen layout stacks them), not
 *   side by side; keep dual clusters clear of page boundaries for parity;
 * - a keep-with-next block (cue, heading, parenthetical) taller than a whole
 *   page overflows its sheet instead of flowing across (the export's
 *   placeFlow splits it), which is unreachable for real blocks of those
 *   kinds. Non-keep atomic kinds (transitions) DO flow across the boundary
 *   exactly like the export.
 */
export function planPages(blocks: PlanBlock[], linesPerPage: number): PlanResult {
  const n = blocks.length;
  const exempt = dualExemptFlags(blocks);
  // Dual pairs stand side by side, so a pair is one unit as tall as its taller
  // column (the export's placeDualPair). Its left column's cue is where it
  // starts.
  const pairAt = new Map<number, DualPair>();
  const pairHeights = new Map<number, number>();
  for (const pair of findDualPairs(blocks)) {
    pairAt.set(pair.leftStart, pair);
    let left = 0;
    for (let k = pair.leftStart; k < pair.leftEnd; k++) left += blocks[k].rows;
    let right = 0;
    for (let k = pair.rightStart; k < pair.rightEnd; k++) right += blocks[k].rows;
    pairHeights.set(pair.leftStart, Math.max(left, right));
  }

  const breaks: PlanBreak[] = [];
  const pageStartBlocks: (number | undefined)[] = [];
  let used = 0;
  let atPageTop = true;
  let curStart: number | undefined = undefined;
  let activeIndex = 0;

  const remaining = () => linesPerPage - used;
  const markStart = () => {
    if (curStart === undefined) curStart = activeIndex;
  };
  const placeRows = (k: number) => {
    if (k <= 0) return;
    markStart();
    used += k;
    atPageTop = false;
  };
  const advanceBlank = (k: number) => {
    used += k;
    if (k > 0) atPageTop = false;
  };
  const newPage = (brk: PlanBreak) => {
    pageStartBlocks.push(curStart);
    breaks.push(brk);
    used = 0;
    atPageTop = true;
    curStart = undefined;
  };
  const moveWhole = (i: number) =>
    newPage({ index: i, row: 0, rowFromStart: 0, rowsAfter: blocks[i].rows, more: false, contd: false });

  /** Mirror of the export's placeParagraph: break only at a sentence end,
      (MORE) below the last line, NAME (CONT'D) on the next page. */
  const placeParagraph = (i: number) => {
    const b = blocks[i];
    const speech = b.kind === "dialogue";
    const model = b.model ?? null;
    let from = 0;
    let rows = b.rows;
    let rowFromStart = 0;
    // Without a text model a line break's offset is found in the DOM from the
    // block's own line boxes, which only describe the unbroken layout. Once a
    // piece has broken on a line, later pieces keep breaking on lines.
    let linesOnly = !model;
    let resumed = false;
    for (;;) {
      const room = remaining();
      if (rows <= room) {
        placeRows(rows);
        return;
      }
      const split = linesOnly ? null : chooseSplit(model!.splits(from), room);
      let before: number;
      let offset: number | undefined;
      let after: number;
      if (split) {
        before = split.before;
        offset = split.offset;
        after = split.after;
      } else if (atPageTop || resumed || (rows > linesPerPage && room >= MIN_SPLIT_LINES)) {
        before = Math.max(1, room);
        after = rows - before;
        if (model && !linesOnly) {
          offset = model.lineStart(from, before);
          after = model.rows(offset);
        } else {
          linesOnly = true;
        }
      } else {
        moveWhole(i);
        continue;
      }
      placeRows(before);
      rowFromStart += before;
      newPage({
        index: i,
        row: before,
        rowFromStart,
        offset,
        rowsAfter: after,
        more: speech,
        contd: speech && b.cue,
      });
      resumed = false;
      if (speech && b.cue) {
        placeRows(1); // NAME (CONT'D)
        resumed = true;
      }
      if (offset != null) from = offset;
      rows = after;
    }
  };

  /** A block that never splits: move it whole unless it opens the page. */
  const placeAtomic = (i: number) => {
    const total = blocks[i].rows;
    if (total > remaining() && !atPageTop) moveWhole(i);
    placeRows(total);
  };

  /** Mirror of the export's placeFlow: fill the remaining slots and continue
      on the fresh page (used for non-keep atomic kinds, i.e. transitions).
      No (MORE)/(CONT'D): those are dialogue conventions. */
  const placeFlowBlock = (i: number) => {
    const total = blocks[i].rows;
    let idx = 0;
    while (idx < total) {
      if (remaining() <= 0) {
        newPage({
          index: i,
          row: idx,
          rowFromStart: idx,
          rowsAfter: total - idx,
          more: false,
          contd: false,
        });
      }
      const take = Math.min(total - idx, remaining());
      placeRows(take);
      idx += take;
    }
  };

  /** Mirror of the export's placeDualPair: the pair moves whole to the next
      page when it does not fit (and would fit a page); a pair taller than a
      page fills page after page, line by line. No (MORE)/(CONT'D). */
  const placePair = (p: DualPair) => {
    const i = p.leftStart;
    let leftRows = 0;
    for (let k = p.leftStart; k < p.leftEnd; k++) leftRows += blocks[k].rows;
    let rightRows = 0;
    for (let k = p.rightStart; k < p.rightEnd; k++) rightRows += blocks[k].rows;
    const height = Math.max(leftRows, rightRows);
    let lead = atPageTop ? 0 : blocks[i].spaceBefore;
    if (!atPageTop && lead + height > remaining() && height <= linesPerPage) {
      moveWhole(i);
      lead = 0;
    }
    if (lead > 0) {
      if (lead >= remaining()) moveWhole(i);
      else advanceBlank(lead);
    }
    let row = 0;
    while (row < height) {
      if (remaining() <= 0) {
        newPage({
          index: i,
          row,
          rowFromStart: row,
          rowsAfter: height - row,
          more: false,
          contd: false,
        });
      }
      const take = Math.min(height - row, remaining());
      placeRows(take);
      row += take;
    }
  };

  for (let i = 0; i < n; i++) {
    activeIndex = i;
    const pair = pairAt.get(i);
    if (pair) {
      placePair(pair);
      i = pair.rightEnd - 1;
      continue;
    }
    const b = blocks[i];
    let leadingBlanks = atPageTop ? 0 : b.spaceBefore;

    // Keep-with-next: a cue, a heading, or a parenthetical must not be
    // stranded at a page bottom. Only break early when the kept run would
    // actually fit on a fresh page. The exact reservation asks the next
    // speech where its sentences end, so it is only worked out when the whole
    // run could not fit anyway.
    // A dual line outside a pair is placed on its own, before any keep rule
    // (the export's placeDualSolo), so it neither keeps nor is kept.
    const keeps =
      !b.dual &&
      (b.kind === "character" || b.kind === "parenthetical" || b.kind === "scene_heading");
    if (
      keeps &&
      !atPageTop &&
      leadingBlanks + keepSlotsFrom(blocks, i, false, pairHeights) > remaining()
    ) {
      const keep = keepSlotsFrom(blocks, i, true, pairHeights);
      if (leadingBlanks + keep > remaining() && keep <= linesPerPage) {
        moveWhole(i);
        leadingBlanks = 0;
      }
    }

    // Blank rows before the element (suppressed at the top of a page).
    if (leadingBlanks > 0) {
      if (leadingBlanks >= remaining()) moveWhole(i);
      else advanceBlank(leadingBlanks);
    }

    const splittable = (b.kind === "dialogue" || b.kind === "action") && !exempt[i];
    if (splittable) placeParagraph(i);
    else if (!exempt[i] && !keeps) placeFlowBlock(i);
    else placeAtomic(i);
  }
  pageStartBlocks.push(curStart);

  return { breaks, pageCount: breaks.length + 1, pageStartBlocks };
}

/**
 * A text model over the export's own monospace wrap, for a block whose text
 * `text` sits in a column `cols` characters wide (`hang` narrower after the
 * first line). The parity tests build it from LAYOUT; the browser builds it
 * from the measured column, and only after checking that it wraps the block
 * exactly as the browser drew it.
 */
export function textSplitModel(text: string, cols: number, hang = 0): SplitModel {
  const rowsOf = (piece: string) => wrap(piece, cols, hang).length;
  // A cue's keep check and the break itself both ask for the same speech's
  // sentence breaks; work each tail out once.
  const splitCache = new Map<number, SplitOption[]>();
  return {
    rows: (from) => rowsOf(text.slice(from)),
    splits: (from) => {
      let options = splitCache.get(from);
      if (!options) {
        options = splitOptions(text.slice(from), rowsOf).map((o) => ({
          ...o,
          offset: o.offset + from,
        }));
        splitCache.set(from, options);
      }
      return options;
    },
    lineStart: (from, row) => {
      // Walk the words the way wrap() does until `row` lines are full.
      const tail = text.slice(from);
      const re = /\S+/g;
      let line = 0;
      let used = 0;
      for (let m = re.exec(tail); m; m = re.exec(tail)) {
        const width = Math.max(1, line === 0 ? cols : cols - hang);
        const len = Array.from(m[0]).length;
        if (used > 0 && used + 1 + len > width) {
          line++;
          used = 0;
          if (line === row) return from + m.index;
        }
        used += (used > 0 ? 1 : 0) + len;
      }
      return text.length;
    },
  };
}

/* ============================================================================
   DOM measurement + decoration building.
   ========================================================================== */

function spacerEl(height: number): HTMLElement {
  const d = document.createElement("div");
  d.className = "pm-page-gap";
  d.style.height = `${height}px`;
  d.setAttribute("contenteditable", "false");
  d.setAttribute("aria-hidden", "true");
  return d;
}

/** The mid-block split widget: (MORE), the page-gap spacer, NAME (CONT'D),
    each a display:block span in the page's own 12pt Courier (globals.css). */
function splitEl(gap: number, more: boolean, contd: string | null): HTMLElement {
  const wrap = document.createElement("span");
  wrap.className = "pm-split";
  wrap.setAttribute("contenteditable", "false");
  wrap.setAttribute("aria-hidden", "true");
  if (more) {
    const m = document.createElement("span");
    m.className = "pm-split-more";
    m.textContent = "(MORE)";
    wrap.appendChild(m);
  }
  const g = document.createElement("span");
  g.className = "pm-page-gap pm-split-gap";
  g.style.height = `${gap}px`;
  wrap.appendChild(g);
  if (contd) {
    const c = document.createElement("span");
    c.className = "pm-split-contd";
    c.textContent = contd;
    wrap.appendChild(c);
  }
  return wrap;
}

interface MeasuredBlock {
  pos: number;
  node: PMNode;
  el: HTMLElement;
  /** The block's rendered height with any hosted split widget subtracted. */
  cleanHeight: number;
  element: string;
  dual: boolean;
  /** Real CSS margins in px (the DOM always renders them; page gaps absorb
      the top margin when a block opens a page). */
  mt: number;
  mb: number;
  /** Rendered line count of the unbroken block. */
  rows: number;
  /** Text offsets of the split widgets this block hosts right now. */
  hosted: number[];
  /** Viewport top of each rendered text line (fallback line breaks only). */
  lineTops: number[] | null;
  /** "NAME (CONT'D)" label for a dialogue continuation, or null. */
  cueLabel: string | null;
}

/**
 * Viewport tops of a block's rendered text lines, from Range.getClientRects
 * over its text nodes. Text inside our own widgets (.pm-split / .pm-page-gap)
 * is skipped so a block that already hosts a split measures its own lines.
 */
function textLineTops(el: HTMLElement, lineH: number): number[] {
  const tops: number[] = [];
  const doc = el.ownerDocument;
  const walker = doc.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
    acceptNode(n: Node) {
      let p = n.parentElement;
      while (p && p !== el) {
        if (p.classList.contains("pm-split") || p.classList.contains("pm-page-gap")) {
          return NodeFilter.FILTER_REJECT;
        }
        p = p.parentElement;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  const range = doc.createRange();
  let node: Node | null;
  while ((node = walker.nextNode())) {
    range.selectNodeContents(node);
    for (const r of Array.from(range.getClientRects())) {
      if (r.height <= 0) continue;
      tops.push(r.top);
    }
  }
  tops.sort((a, b) => a - b);
  const lines: number[] = [];
  for (const t of tops) {
    if (lines.length === 0 || t - lines[lines.length - 1] > lineH / 2) lines.push(t);
  }
  return lines;
}

/** Per-element-kind CSS metrics. Margins and line height depend only on the
    sp-<element> classes (plus the dual flag and the first-child zeroing), so
    one getComputedStyle per distinct key replaces one per block. The column
    width in characters is cached the same way. The plugin clears the cache
    when the editor width or the loaded font changes. */
interface KindMetrics {
  mt: number;
  mb: number;
  lineH: number;
  /** Characters per line in this kind's column, or 0 when unmeasurable. */
  cols: number;
}
type MetricsCache = Map<string, KindMetrics>;

/*
 * Block HEIGHTS are deliberately NOT cached. An earlier revision kept them in a
 * WeakMap keyed on ProseMirror node identity, which does not hold: the same
 * node object returns on a different DOM element after a delete plus undo (a
 * stale element measures nothing), one node object can render at two
 * positions after a duplicate paste, and a height can change with no change of
 * identity at all (the (CONT'D) widget wrapping a long cue). Measured in the
 * feature-length benchmark, that cache was worth about 1 ms in a 69 ms pass:
 * the per-kind metrics above are the expensive lookup, and unlike heights they
 * are a pure function of the class list.
 */

/** The block's own pixel height with any hosted split widgets subtracted, so
    a block already carrying a split measures its text height. Uses
    offsetHeight for the block (no rect allocation); the split wrapper is
    inline, so its bounding rect (the union of its display:block children)
    carries the widget's occupied height. */
function cleanBlockHeight(el: HTMLElement): number {
  let h = el.offsetHeight;
  const widgets = el.getElementsByClassName("pm-split");
  for (let i = 0; i < widgets.length; i++) {
    h -= widgets[i].getBoundingClientRect().height;
  }
  return h;
}

/** Width of one character of the script face, from the prose's own font. */
function charWidth(view: EditorView): number {
  const cs = getComputedStyle(view.dom);
  const size = parseFloat(cs.fontSize) || 16;
  try {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
      const w = ctx.measureText("0000000000").width / 10;
      if (w > 0) return w;
    }
  } catch {
    // A canvas-less environment (tests): fall back to Courier's 0.6em.
  }
  return size * 0.6;
}

/**
 * The text offset (within the block's content) that starts rendered line
 * `row`: a binary search over caret coordinates (view.coordsAtPos, side 1)
 * against the line box's top. Returns null when the offset cannot be
 * resolved, in which case the caller degrades to letting the block flow.
 * Used only for blocks whose wrapping the text model could not reproduce.
 */
function resolveLineStartOffset(
  view: EditorView,
  b: MeasuredBlock,
  row: number,
  lineH: number
): number | null {
  const tops = b.lineTops;
  if (!tops || row <= 0 || row >= tops.length) return null;
  const target = tops[row];
  const from = b.pos + 1;
  const to = from + b.node.content.size;
  const topAt = (pos: number): number | null => {
    try {
      return view.coordsAtPos(pos, 1).top;
    } catch {
      return null;
    }
  };
  let lo = from + 1;
  let hi = to;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    const t = topAt(mid);
    if (t == null) return null;
    if (t >= target - lineH / 2) hi = mid;
    else lo = mid + 1;
  }
  const t = topAt(lo);
  if (t == null || Math.abs(t - target) > lineH / 2) return null;
  return lo - from;
}

/** Every split widget in the current decorations, bucketed by the position of
    the block that hosts it (one pass, instead of a lookup per block). */
function hostedSplitsByBlock(state: EditorState): Map<number, number[]> {
  const out = new Map<number, number[]>();
  const s = key.getState(state);
  if (!s) return out;
  for (const d of s.decos.find()) {
    if (!((d.spec as { key?: string }).key ?? "").startsWith("split-")) continue;
    const $pos = state.doc.resolve(Math.min(d.from, state.doc.content.size));
    if ($pos.depth < 1) continue;
    const blockPos = $pos.before(1);
    const offset = d.from - blockPos - 1;
    const list = out.get(blockPos);
    if (list) list.push(offset);
    else out.set(blockPos, [offset]);
  }
  for (const list of out.values()) list.sort((a, b) => a - b);
  return out;
}

/**
 * The DOM element of every top-level block, in document order. ProseMirror's
 * nodeDOM(pos) scans the document from the top on every call, which made a
 * pass over a feature-length script quadratic (2,000 lines, two million
 * steps). The editor's own children are already in document order, with the
 * page-gap widgets between them, so they are paired with the document's
 * children in one walk; ProseMirror's view descriptor on each element
 * confirms the pairing, and anything unexpected falls back to nodeDOM.
 */
export function blockDoms(view: EditorView): (HTMLElement | null)[] {
  const out: (HTMLElement | null)[] = [];
  // Sibling pointers, not the live children collection, whose indexed access
  // is not guaranteed to be constant time.
  let c = view.dom.firstElementChild as (HTMLElement & { pmViewDesc?: { node?: PMNode | null } }) | null;
  let paired = true;
  view.state.doc.forEach((node, offset) => {
    let el: HTMLElement | null = null;
    if (paired) {
      // Step past widgets (page gaps, hints) sitting between blocks.
      while (c && !c.pmViewDesc?.node) c = c.nextElementSibling as typeof c;
      if (c && c.pmViewDesc?.node === node) {
        el = c;
        c = c.nextElementSibling as typeof c;
      } else {
        paired = false;
      }
    }
    out.push(el ?? (view.nodeDOM(offset) as HTMLElement | null));
  });
  return out;
}

/** What the last full pass saw, so the next edit can tell cheaply whether it
    could have moved any page break at all. */
interface PassGeometry {
  lineH: number;
  /** Rendered rows of every block, by its element. */
  rowsByEl: WeakMap<HTMLElement, number>;
  /** Blocks whose text the planner had to read (a speech or paragraph it
      tried to break, or one a cue reserved room for): editing their words
      can move a break even when no line count changes. */
  consulted: WeakSet<HTMLElement>;
  /** Blocks carrying a split widget. */
  hosting: WeakSet<HTMLElement>;
}

function compute(
  view: EditorView,
  metrics: MetricsCache
): { decos: DecorationSet; pages: number; sig: string; geometry: PassGeometry } {
  const measured: MeasuredBlock[] = [];
  let currentCue: string | null = null;
  const doms = blockDoms(view);
  const hostedAll = hostedSplitsByBlock(view.state);
  let childIndex = 0;
  view.state.doc.forEach((node, offset) => {
    const dom = doms[childIndex++];
    if (!dom || dom.nodeType !== 1) return;
    const element = (node.attrs.element as string) ?? "action";
    // Track the nearest preceding speaker, mirroring the export engine.
    if (element === "character") {
      const base = cueBaseName(node.textContent).toUpperCase();
      currentCue = base || null;
    } else if (element === "scene_heading" || element === "action" || element === "transition") {
      currentCue = null;
    }
    const hosted = hostedAll.get(offset) ?? [];
    // The only inline padding a line ever carries is the one this engine puts
    // on the end of a dual pair's shorter column; it is never part of the
    // line's own height, even on the pass after the pair has come apart.
    const padding = dom.style.paddingBottom ? parseFloat(dom.style.paddingBottom) || 0 : 0;
    measured.push({
      pos: offset,
      node,
      el: dom,
      cleanHeight: (hosted.length ? cleanBlockHeight(dom) : dom.offsetHeight) - padding,
      element,
      dual: node.attrs.dual === true,
      mt: 0,
      mb: 0,
      rows: 1,
      hosted,
      lineTops: null,
      cueLabel: element === "dialogue" && currentCue ? `${currentCue} (CONT'D)` : null,
    });
  });

  const n = measured.length;

  // Dual pairs, by the index of their left column's cue.
  const pairs = findDualPairs(measured.map((b) => ({ kind: b.element, dual: b.dual })));
  const pairStart = new Map<number, DualPair>();
  for (const p of pairs) pairStart.set(p.leftStart, p);

  // Margins, line height, and the column width in characters come from the
  // per-kind cache (one getComputedStyle per distinct class list, not per
  // block); row counts from offsetHeight arithmetic.
  let lineH = DEFAULT_LINE_H;
  let cw = 0;
  for (let i = 0; i < n; i++) {
    const b = measured[i];
    const cacheKey = `${b.el.className}|${b.dual ? 1 : 0}${i === 0 ? "|first" : ""}`;
    let m = metrics.get(cacheKey);
    if (!m) {
      const cs = getComputedStyle(b.el);
      const lh = parseFloat(cs.lineHeight);
      if (!cw) cw = charWidth(view);
      m = {
        mt: parseFloat(cs.marginTop) || 0,
        mb: parseFloat(cs.marginBottom) || 0,
        lineH: Number.isFinite(lh) && lh > 0 ? lh : DEFAULT_LINE_H,
        cols: cw > 0 ? Math.floor(b.el.clientWidth / cw + 0.01) : 0,
      };
      metrics.set(cacheKey, m);
    }
    if (i === 0) lineH = m.lineH;
    b.mt = m.mt;
    b.mb = m.mb;
    b.rows = Math.max(1, Math.round(b.cleanHeight / lineH));
  }

  // The text model for a splittable block: the export's own wrap over the
  // measured column. It is trusted only when it reproduces the block exactly
  // as the browser drew it (it always does for ordinary script text; an
  // unusual glyph wider than one column is what it guards against). A block
  // that hosts a split is drawn broken, so its drawing is checked piece by
  // piece and its unbroken row count then comes from the model.
  const models = new Map<number, SplitModel | null>();
  const modelFor = (i: number): SplitModel | null => {
    if (models.has(i)) return models.get(i)!;
    const b = measured[i];
    let model: SplitModel | null = null;
    const m = metrics.get(`${b.el.className}|${b.dual ? 1 : 0}${i === 0 ? "|first" : ""}`);
    const cols = m?.cols ?? 0;
    if (cols >= 8 && !b.dual) {
      const hang = LAYOUT[b.element as keyof typeof LAYOUT]?.hang ?? 0;
      const text = b.node.textContent;
      // What the browser drew: each piece between hosted widgets wraps on its
      // own, because a widget ends the line before it.
      let drawn = 0;
      let start = 0;
      for (const offset of [...b.hosted, text.length]) {
        drawn += wrap(text.slice(start, offset), cols, hang).length;
        start = offset;
      }
      if (drawn === b.rows) model = textSplitModel(text, cols, hang);
    }
    models.set(i, model);
    return model;
  };
  for (let i = 0; i < n; i++) {
    const b = measured[i];
    if (b.hosted.length === 0) continue;
    const model = modelFor(i);
    if (model) b.rows = Math.max(1, model.rows(0));
  }

  const geometry: PassGeometry = {
    lineH,
    rowsByEl: new WeakMap(),
    consulted: new WeakSet(),
    hosting: new WeakSet(),
  };
  for (const b of measured) {
    geometry.rowsByEl.set(b.el, Math.max(1, Math.round(b.cleanHeight / lineH)));
    if (b.hosted.length) geometry.hosting.add(b.el);
  }

  const capacity = Math.max(1, Math.floor((TEXT_H + 0.5) / lineH)); // 54 at 16px
  const planBlocks: PlanBlock[] = measured.map((b, i) => {
    const block: PlanBlock = {
      kind: b.element,
      rows: b.rows,
      spaceBefore: Math.round(b.mt / lineH),
      dual: b.dual,
      cue: b.cueLabel != null,
    };
    if (b.element === "dialogue" || b.element === "action") {
      // Lazy: only the few blocks near a page bottom ever ask.
      let resolved: SplitModel | null | undefined;
      Object.defineProperty(block, "model", {
        enumerable: true,
        get: () => {
          geometry.consulted.add(b.el);
          return resolved === undefined ? (resolved = modelFor(i)) : resolved;
        },
      });
    }
    return block;
  });
  const plan = planPages(planBlocks, capacity);

  const breaksByBlock = new Map<number, PlanBreak[]>();
  for (const br of plan.breaks) {
    const list = breaksByBlock.get(br.index);
    if (list) list.push(br);
    else breaksByBlock.set(br.index, [br]);
  }

  // Replay the plan in px to size the gaps. The planner is authoritative for
  // WHERE breaks fall; the replay only turns them into pixel-high spacers so
  // every page's content starts exactly at its sheet's top margin.
  const decos: Decoration[] = [];
  const sigEntries: { from: number; key: string }[] = [];
  let page = 0;
  let y = MARGIN; // cursor in final (gapped) editor coordinates

  const nextPageTop = (bottom: number): number => {
    // Advance at least one page; more if content overflowed its sheet.
    page++;
    let top = page * STRIDE + MARGIN;
    while (top < bottom - 0.5) {
      page++;
      top = page * STRIDE + MARGIN;
    }
    return top;
  };

  // A pair's columns, measured: the page lays them side by side by pulling
  // the right column up by the left column's height and padding the shorter
  // side's end, so the pair takes exactly as much page as its taller column.
  const columnHeight = (from: number, to: number) => {
    let h = 0;
    for (let k = from; k < to; k++) {
      const m = measured[k];
      if (k > from) h += m.mt;
      h += Math.max(1, Math.round(m.cleanHeight / lineH)) * lineH;
    }
    return h;
  };

  for (let i = 0; i < n; i++) {
    const pair = pairStart.get(i);
    if (pair) {
      const first = measured[i];
      const brs = breaksByBlock.get(i) ?? [];
      let segTextY: number;
      if (brs[0]?.row === 0) {
        const top = nextPageTop(y + first.mt);
        const gap = Math.max(0, top - y - first.mt);
        const specKey = `gap-${Math.round(gap)}`;
        decos.push(
          Decoration.widget(first.pos, () => spacerEl(gap), {
            side: -1,
            key: specKey,
            ignoreSelection: true,
            marks: [],
            pageBreak: true,
          })
        );
        sigEntries.push({ from: first.pos, key: specKey });
        segTextY = top;
      } else {
        segTextY = y + first.mt;
      }
      const left = columnHeight(pair.leftStart, pair.leftEnd);
      const right = columnHeight(pair.rightStart, pair.rightEnd);
      const cue = measured[pair.rightStart];
      const last = measured[pair.rightEnd - 1];
      const pad = Math.max(0, left - right);
      const styleFor = (block: MeasuredBlock) => {
        const parts: string[] = [];
        if (block === cue) parts.push(`margin-top: ${-left}px`);
        if (block === last && pad > 0) parts.push(`padding-bottom: ${pad}px`);
        return parts.join("; ");
      };
      for (const block of cue === last ? [cue] : [cue, last]) {
        const style = styleFor(block);
        if (!style) continue;
        const specKey = `dual:${style}`;
        decos.push(
          Decoration.node(
            block.pos,
            block.pos + block.node.nodeSize,
            { style },
            { dualColumn: true, key: specKey }
          )
        );
        sigEntries.push({ from: block.pos, key: specKey });
      }
      y = segTextY + Math.max(left, right) + last.mb;
      i = pair.rightEnd - 1;
      continue;
    }

    const b = measured[i];
    const brs = breaksByBlock.get(i) ?? [];
    let segTextY: number; // y where the current piece's first row renders
    let pieceRows = b.rows; // rows of the current piece
    let bi = 0;

    if (brs[0]?.row === 0) {
      // Page break before the block; the gap absorbs its top margin so the
      // new page does not start with blank lines.
      const top = nextPageTop(y + b.mt);
      const gap = Math.max(0, top - y - b.mt);
      // The key describes the widget, never where it sits: a key carrying the
      // position made every widget below an edit look new, so ProseMirror
      // rebuilt all of them on every pass. The signature pairs each key with
      // its position separately.
      const specKey = `gap-${Math.round(gap)}`;
      decos.push(
        Decoration.widget(b.pos, () => spacerEl(gap), {
          side: -1,
          key: specKey,
          ignoreSelection: true,
          marks: [],
          pageBreak: true,
        })
      );
      sigEntries.push({ from: b.pos, key: specKey });
      segTextY = top;
      bi = 1;
    } else {
      segTextY = y + b.mt;
    }

    for (; bi < brs.length; bi++) {
      const br = brs[bi];
      let offset = br.offset ?? null;
      if (offset == null) {
        if (!b.lineTops) b.lineTops = textLineTops(b.el, lineH);
        offset = resolveLineStartOffset(view, b, br.rowFromStart, lineH);
      }
      if (offset == null) break; // degrade: the rest of the block flows on
      const more = br.more;
      const contd = br.contd && b.cueLabel ? b.cueLabel : null;
      const bottom = segTextY + br.row * lineH + (more ? lineH : 0);
      const top = nextPageTop(bottom);
      const gap = Math.max(0, top - bottom);
      const widgetPos = b.pos + 1 + offset;
      const specKey = `split-${Math.round(gap)}-${more ? 1 : 0}-${contd ?? ""}`;
      decos.push(
        Decoration.widget(widgetPos, () => splitEl(gap, more, contd), {
          side: -1,
          key: specKey,
          ignoreSelection: true,
          marks: [],
          pageBreak: true,
        })
      );
      sigEntries.push({ from: widgetPos, key: specKey });
      segTextY = top + (contd ? lineH : 0);
      pieceRows = br.rowsAfter;
    }

    y = segTextY + pieceRows * lineH + b.mb;
  }

  const pages = page + 1;
  return {
    decos: DecorationSet.create(view.state.doc, decos),
    pages,
    sig: joinSig(sigEntries, pages),
    geometry,
  };
}

/** Exercise real cold and post-edit DOM passes in feature-length benchmarks. */
export function benchmarkPaginationPass(view: EditorView): {
  coldMs: number;
  editMs: number;
} {
  const metrics: MetricsCache = new Map();
  const coldStarted = performance.now();
  compute(view, metrics);
  const coldMs = performance.now() - coldStarted;
  const samples: number[] = [];
  for (let sample = 0; sample < 3; sample++) {
    if (!view.state.doc.lastChild) break;
    const textEnd = view.state.doc.content.size - 1;
    view.dispatch(view.state.tr.insertText("x", textEnd));
    const started = performance.now();
    compute(view, metrics);
    samples.push(performance.now() - started);
  }
  samples.sort((a, b) => a - b);
  return { coldMs, editMs: samples[Math.floor(samples.length / 2)] ?? 0 };
}

/**
 * Canonical signature over widget entries: sorted by position with the spec
 * key as the tiebreak, so the comparison is independent of enumeration order.
 * This matters because DecorationSet.find() returns the doc-level page-gap
 * widgets before the split widgets nested inside blocks, which is NOT
 * document order once any mid-block split exists; comparing raw enumeration
 * orders kept the two sides permanently unequal and made every keystroke
 * burn the full convergence budget. Exported for the unit test.
 */
export function joinSig(entries: { from: number; key: string }[], pages: number): string {
  entries.sort((a, b) => a.from - b.from || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  let sig = "";
  for (const e of entries) sig += `${e.from}=${e.key};`;
  return `${sig}#${pages}`;
}

/**
 * Serialize a decoration set to the same shape compute()'s sig has: position
 * plus the widget's spec key (which encodes gap height and labels), both
 * canonicalized through joinSig. Comparing the FRESH computation against what
 * the plugin state actually holds is what makes skipped dispatches safe: a
 * transaction's mapping can drop or shift a widget (deleting across a split
 * boundary removes it), and a remembered last-sig would not notice the
 * divergence.
 */
function sigOfState(state: EditorState): string {
  const s = key.getState(state);
  if (!s) return "";
  const entries = s.decos.find().map((d) => ({
    from: d.from,
    key: (d.spec as { key?: string }).key ?? "",
  }));
  return joinSig(entries, s.pages);
}

/**
 * Which visual page a document position sits on (1-based), read from the same
 * decoration set that draws the sheets, so the status bar's "Page 3 of 92"
 * always agrees with what is on screen. Each page-boundary widget (a gap
 * before a block or a mid-block split) before the position means one page
 * boundary crossed.
 */
export function pageAtPos(state: EditorState, pos: number): number {
  const s = key.getState(state);
  if (!s) return 1;
  return 1 + s.decos.find(0, pos, (spec) => spec.pageBreak === true).length;
}

/* ============================================================================
   Keeping the view still while pages reflow.
   ========================================================================== */

/** The element that scrolls the editor: the nearest ancestor that overflows. */
export function scrollParentOf(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const oy = getComputedStyle(p).overflowY;
    if ((oy === "auto" || oy === "scroll") && p.scrollHeight > p.clientHeight + 1) return p;
  }
  return null;
}

export interface ViewAnchor {
  scroller: HTMLElement;
  pos: number;
  top: number;
}

/**
 * Remember what the writer is looking at before a reflow: the caret, when the
 * editor has focus and the caret is on screen; otherwise the text at the top
 * of the visible area. restoreViewAnchor() puts that point back on the same
 * screen row afterwards.
 */
export function captureViewAnchor(view: EditorView): ViewAnchor | null {
  const scroller = scrollParentOf(view.dom);
  if (!scroller) return null;
  const box = scroller.getBoundingClientRect();
  if (box.height <= 0) return null;
  try {
    if (view.hasFocus()) {
      const head = view.state.selection.head;
      const c = view.coordsAtPos(head);
      if (c.bottom > box.top && c.top < box.bottom) return { scroller, pos: head, top: c.top };
    }
    const dom = view.dom.getBoundingClientRect();
    const hit = view.posAtCoords({
      left: dom.left + Math.min(dom.width / 2, 200),
      top: Math.max(box.top, dom.top) + 8,
    });
    if (!hit) return null;
    return { scroller, pos: hit.pos, top: view.coordsAtPos(hit.pos).top };
  } catch {
    return null;
  }
}

export function restoreViewAnchor(view: EditorView, anchor: ViewAnchor | null): void {
  if (!anchor || !anchor.scroller.isConnected) return;
  try {
    const pos = Math.min(anchor.pos, view.state.doc.content.size);
    const now = view.coordsAtPos(pos).top;
    const delta = now - anchor.top;
    if (Math.abs(delta) >= 1) anchor.scroller.scrollTop += delta;
  } catch {
    // A position the new layout cannot resolve: leave the scroll alone.
  }
}

/**
 * True when an edit cannot have moved any page break, so the full pass can
 * wait: the same blocks exist, only their text changed, every edited block
 * still has the element it had and still draws the same number of lines, and
 * none of them is a block the last pass had to read the words of or one that
 * carries a split. Typing inside a line that does not wrap (most keystrokes)
 * then costs one height read instead of measuring the whole script.
 */
function editKeepsPages(view: EditorView, prev: EditorState, geo: PassGeometry): boolean {
  const a = prev.doc;
  const b = view.state.doc;
  if (a.childCount !== b.childCount) return false;
  // Every page break has to have survived the edit. Mapping drops a widget
  // whose spot was deleted, and a whole-document replacement drops all of
  // them; either way the page needs a full pass, however little the text moved.
  const had = key.getState(prev)?.decos;
  const has = key.getState(view.state)?.decos;
  if (!had || !has || had.find().length !== has.find().length) return false;
  const start = a.content.findDiffStart(b.content);
  if (start == null) return true;
  const end = a.content.findDiffEnd(b.content);
  if (!end) return false;
  const stop = Math.max(end.b, start + 1);
  let pos = 0;
  for (let i = 0; i < b.childCount && pos < stop; i++) {
    const node = b.child(i);
    const nodeEnd = pos + node.nodeSize;
    if (nodeEnd > start) {
      const before = a.child(i);
      if (
        before.type !== node.type ||
        before.attrs.element !== node.attrs.element ||
        before.attrs.dual !== node.attrs.dual
      ) {
        return false;
      }
      const el = view.nodeDOM(pos) as HTMLElement | null;
      if (!el || geo.hosting.has(el) || geo.consulted.has(el)) return false;
      const rows = geo.rowsByEl.get(el);
      if (rows == null) return false;
      if (Math.max(1, Math.round(el.offsetHeight / geo.lineH)) !== rows) return false;
    }
    pos = nodeEnd;
  }
  return true;
}

export interface PaginationOptions {
  onPages?: (pages: number) => void;
  /** Notify React when page boundaries move without changing the page count. */
  onLayout?: () => void;
}

/**
 * A pass slower than this runs a beat after typing instead of in the same
 * frame, so a very long script on a slow machine never makes keys lag. Full
 * passes are rare while typing (only an edit that changes a line count, or
 * touches a page break, needs one; see editKeepsPages), so one that costs a
 * frame is worth it: the alternative is text visibly spilling past the page
 * edge until the deferred pass lands.
 */
const SAME_FRAME_BUDGET_MS = 24;

export const Pagination = Extension.create<PaginationOptions>({
  name: "pagination",
  addOptions() {
    return { onPages: undefined, onLayout: undefined };
  },
  addProseMirrorPlugins() {
    const onPages = this.options.onPages;
    const onLayout = this.options.onLayout;
    let raf = 0;
    let lastPages = -1;
    // Convergence guard: a split widget can change how its block wraps, so
    // one extra pass may be needed after a dispatch; cap the chain so a
    // pathological layout can never loop. Reset whenever the doc or the width
    // changes.
    let passes = 0;
    // Per-kind margin/line-height/column cache (see MetricsCache); cleared
    // whenever the editor width or the loaded font changes, since both re-style.
    const metrics: MetricsCache = new Map();

    return [
      new Plugin<PagState>({
        key,
        state: {
          init: () => ({ decos: DecorationSet.empty, pages: 1 }),
          apply(tr, prev): PagState {
            const meta = tr.getMeta(key) as PagState | undefined;
            if (meta) return meta;
            return { decos: prev.decos.map(tr.mapping, tr.doc), pages: prev.pages };
          },
        },
        props: {
          decorations(state: EditorState) {
            return key.getState(state)?.decos ?? DecorationSet.empty;
          },
        },
        view(view) {
          const timers: ReturnType<typeof setTimeout>[] = [];
          let debounceTimer: ReturnType<typeof setTimeout> | null = null;
          let firstQueuedAt = 0;
          let destroyed = false;
          let microQueued = false;
          // Running cost of a pass, to decide between same-frame and deferred.
          let costMs = 0;
          // What the last full pass measured (see editKeepsPages).
          let geometry: PassGeometry | null = null;
          let settleTimer: ReturnType<typeof setTimeout> | null = null;
          const run = () => {
            raf = 0;
            if (destroyed) return;
            // Never reflow mid-composition: IME text is not yet real content
            // and a dispatch would disturb it. Try again shortly after.
            if (view.composing) {
              timers.push(setTimeout(() => schedule(true), 250));
              return;
            }
            // No layout, no pagination. A hidden or collapsed container measures
            // zero wide, every line wraps to one character, and the page count
            // explodes. Re-scheduling is self-healing: the callback lands once
            // the editor is visible again, and the width observer below fires
            // the moment the column has a real width.
            if (!view.dom.isConnected || view.dom.clientWidth <= 0) {
              schedule();
              return;
            }
            const started = performance.now();
            const { decos, pages, sig, geometry: measured } = compute(view, metrics);
            geometry = measured;
            const elapsed = performance.now() - started;
            costMs = costMs ? costMs * 0.7 + elapsed * 0.3 : elapsed;
            if (sig !== sigOfState(view.state)) {
              const anchor = captureViewAnchor(view);
              view.dispatch(view.state.tr.setMeta(key, { decos, pages }));
              restoreViewAnchor(view, anchor);
              if (pages !== lastPages) {
                lastPages = pages;
                onPages?.(pages);
              }
              onLayout?.();
              if (passes < 4) {
                passes++;
                soon();
              }
            } else {
              passes = 0;
              if (pages !== lastPages) {
                lastPages = pages;
                onPages?.(pages);
              }
            }
          };
          const queueFrame = () => {
            if (destroyed) return;
            if (!raf) raf = requestAnimationFrame(run);
          };
          const schedule = (immediate = false) => {
            if (destroyed) return;
            if (immediate) {
              if (debounceTimer) clearTimeout(debounceTimer);
              debounceTimer = null;
              firstQueuedAt = 0;
              queueFrame();
              return;
            }
            const now = Date.now();
            if (firstQueuedAt === 0) firstQueuedAt = now;
            if (debounceTimer) clearTimeout(debounceTimer);
            const elapsed = now - firstQueuedAt;
            const delay = Math.max(0, Math.min(80, 260 - elapsed));
            debounceTimer = setTimeout(() => {
              debounceTimer = null;
              firstQueuedAt = 0;
              queueFrame();
            }, delay);
          };
          /**
           * Same frame when affordable: a microtask runs after ProseMirror has
           * written the edit to the DOM and before the browser paints, so the
           * writer never sees the in-between layout. Falls back to the
           * debounced frame for a pass too slow to run on every keystroke.
           */
          const soon = () => {
            if (destroyed) return;
            if (costMs > SAME_FRAME_BUDGET_MS || view.composing) {
              schedule();
              return;
            }
            if (microQueued) return;
            microQueued = true;
            queueMicrotask(() => {
              microQueued = false;
              if (destroyed) return;
              if (debounceTimer) {
                clearTimeout(debounceTimer);
                debounceTimer = null;
                firstQueuedAt = 0;
              }
              run();
            });
          };
          schedule(true);
          // Only recompute when the editor's WIDTH changes (which re-wraps text
          // and changes block heights). Ignore height-only changes: inserting our
          // own page spacers changes view.dom's height, which would otherwise make
          // the observer re-trigger the measure loop in a needless feedback loop
          // on every pagination pass (F32).
          let lastWidth = view.dom.clientWidth;
          const ro = new ResizeObserver((entries) => {
            const w = entries[0]?.contentRect.width ?? view.dom.clientWidth;
            if (Math.abs(w - lastWidth) < 0.5) return;
            lastWidth = w;
            passes = 0;
            metrics.clear();
            schedule();
          });
          ro.observe(view.dom);

          // Recompute once the web font finishes loading. Block heights change
          // when Courier Prime replaces the fallback font, so a break computed
          // mid-load lands in the wrong place and text spills past the sheet.
          // Belt-and-suspenders delayed passes also catch content that mounts
          // just after the plugin initializes.
          if (typeof document !== "undefined" && document.fonts?.ready) {
            document.fonts.ready
              .then(() => {
                if (destroyed) return;
                metrics.clear();
                schedule();
              })
              .catch(() => {});
          }
          // Wrapped: setTimeout hands the timer id to its callback, and a
          // truthy first argument would mean "immediate" to schedule().
          timers.push(setTimeout(() => schedule(), 60));
          timers.push(setTimeout(() => schedule(), 300));
          timers.push(setTimeout(() => schedule(), 1000));

          return {
            update(v, prev) {
              if (v.state.doc === prev.doc) return;
              passes = 0;
              const pending = microQueued || debounceTimer != null || raf !== 0;
              if (!pending && geometry && !view.composing && editKeepsPages(v, prev, geometry)) {
                // Nothing moved. A full pass still runs once typing pauses, as
                // a backstop for anything this check cannot see (an automatic
                // (CONT'D) appearing on a later cue, say).
                if (settleTimer) clearTimeout(settleTimer);
                settleTimer = setTimeout(() => {
                  settleTimer = null;
                  schedule(true);
                }, 400);
                return;
              }
              soon();
            },
            destroy() {
              destroyed = true;
              if (raf) cancelAnimationFrame(raf);
              if (settleTimer) clearTimeout(settleTimer);
              if (debounceTimer) clearTimeout(debounceTimer);
              timers.forEach(clearTimeout);
              ro.disconnect();
            },
          };
        },
      }),
    ];
  },
});
