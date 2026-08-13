import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, type EditorState } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import type { Node as PMNode } from "@tiptap/pm/model";
import { cueBaseName } from "./outline";

/**
 * Visual pagination: makes a single continuous editor LOOK like a stack of
 * separate US-Letter pages (the Google-Docs look). It measures the top-level
 * blocks and, at each page boundary, inserts a transparent spacer widget that
 * pushes the following content down to the top of the next sheet. A separate
 * backdrop (PageBackdrop) draws the white sheets behind the text; the spacers
 * leave the inter-page gaps empty so no text ever lands in a gap.
 *
 * The BREAK RULES are the export engine's (lib/export/paginate.ts is the rule
 * authority). The measured blocks are reduced to line-slot counts and fed to a
 * pure planner (planPages, below) that mirrors the export algorithm exactly:
 * keep-with-next for headings/cues/parentheticals (with the export's
 * firstDialogueKeep reservation), mid-block dialogue splits marked with
 * (MORE) / NAME (CONT'D), and action splits with orphan/widow avoidance.
 * Splits render as inline widget decorations inside the straddling block:
 * display:block spans for "(MORE)", the page-gap spacer, and "NAME (CONT'D)",
 * placed at the text offset that starts the first non-fitting rendered line
 * (found from the block's line boxes via Range.getClientRects plus a binary
 * search over caret coordinates). Parentheticals and scene headings never
 * split; dual-dialogue clusters are exempt in v1 (whole-block moves, as
 * before); when fewer than MIN_SPLIT_LINES would land on either side, the
 * whole block moves instead.
 */

const key = new PluginKey<PagState>("pagination");

const DPI = 96;
export const PAGE_H = 11 * DPI; // 1056
export const PAGE_W = 8.5 * DPI; // 816
const MARGIN = 1 * DPI; // 96 (top/bottom page margin)
const TEXT_H = PAGE_H - 2 * MARGIN; // 864 (text area per page)
export const DESK_GAP = 22; // grey gap shown between sheets
export const STRIDE = PAGE_H + DESK_GAP; // 1078 (one page to the next)

const DEFAULT_LINE_H = 16; // 12pt Courier at 6 lines/inch (globals.css)
const MIN_SPLIT_LINES = 2; // matches lib/export/paginate.ts

interface PagState {
  decos: DecorationSet;
  pages: number;
}

/* ============================================================================
   The pure planner: the export engine's break rules over line-slot counts.
   Kept free of any DOM access so the parity tests can drive it directly
   (lib/export/paginateParity.test.ts).
   ========================================================================== */

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
}

export interface PlanBreak {
  /** Block index the page boundary belongs to. */
  index: number;
  /** 0 = break BEFORE the block (whole move); >0 = split before this row. */
  row: number;
  /** Dialogue split: draw (MORE) above the gap. */
  more: boolean;
  /** Dialogue split: draw NAME (CONT'D) after the gap. */
  contd: boolean;
}

export interface PlanResult {
  breaks: PlanBreak[];
  pageCount: number;
  /** Block index whose content opens each page (undefined for an empty page).
      Mirrors the export engine's Page.startLine (block index == line index). */
  pageStartBlocks: (number | undefined)[];
}

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

/** The export engine's firstDialogueKeep: slots a cue reserves for a following
    dialogue of `rows` lines so a legal continuation is possible. */
function firstDialogueKeep(rows: number): number {
  if (rows === 0) return 0;
  if (rows >= 2 * MIN_SPLIT_LINES) return MIN_SPLIT_LINES + 1;
  return rows;
}

/** Mirror of the export engine's keepSlotsFrom: room a keep-with-next block
    needs at a page bottom, counting parenthetical chains and the reservation
    for a following (splittable) dialogue. Depth-bounded. */
function keepSlotsFrom(blocks: PlanBlock[], i: number, depth = 0): number {
  let slots = blocks[i].rows;
  let j = i + 1;
  while (j < blocks.length && blocks[j].kind === "parenthetical") {
    slots += blocks[j].spaceBefore + blocks[j].rows;
    j++;
  }
  if (j < blocks.length) {
    const next = blocks[j];
    if (next.kind === "dialogue") {
      slots += next.spaceBefore + firstDialogueKeep(next.rows);
    } else if (depth < 8 && (next.kind === "scene_heading" || next.kind === "character")) {
      slots += next.spaceBefore + keepSlotsFrom(blocks, j, depth + 1);
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
 * mid-block split (row > 0, with the (MORE)/(CONT'D) flags for dialogue).
 *
 * Known v1 divergences from the export engine, both deliberate:
 * - dual pairs place sequentially (the on-screen layout stacks them), not
 *   side by side; keep dual clusters clear of page boundaries for parity;
 * - a keep-with-next block (cue, heading, parenthetical) taller than a whole
 *   page overflows its sheet instead of flowing across (the export's
 *   placeFlow splits it), which is unreachable for real blocks of those
 *   kinds. Non-keep atomic kinds (transitions) DO flow across the boundary
 *   exactly like the export: a wrapped transition straddling a page bottom
 *   fills the remaining slots and continues on the next page.
 */
export function planPages(blocks: PlanBlock[], linesPerPage: number): PlanResult {
  const n = blocks.length;
  const exempt = dualExemptFlags(blocks);
  const splittable = blocks.map(
    (b, i) => (b.kind === "dialogue" || b.kind === "action") && !exempt[i]
  );

  const breaks: PlanBreak[] = [];
  const pageStartBlocks: (number | undefined)[] = [];
  let page = 0;
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
  const placeMarker = () => {
    markStart();
    used += 1;
    atPageTop = false;
  };
  const advanceBlank = (k: number) => {
    used += k;
    if (k > 0) atPageTop = false;
  };
  const newPage = (brk: PlanBreak) => {
    pageStartBlocks.push(curStart);
    breaks.push(brk);
    page++;
    used = 0;
    atPageTop = true;
    curStart = undefined;
  };

  /** Mirror of the export's placeDialogue: split with (MORE)/(CONT'D). */
  const placeDialogue = (i: number) => {
    const total = blocks[i].rows;
    const hasCue = blocks[i].cue;
    let idx = 0;
    while (idx < total) {
      const cap = remaining();
      const left = total - idx;
      if (left <= cap) {
        placeRows(left);
        return;
      }
      const linesHere = cap - 1; // reserve the bottom slot for (MORE)
      const carry = left - linesHere;
      if (linesHere >= MIN_SPLIT_LINES && carry >= MIN_SPLIT_LINES) {
        placeRows(linesHere);
        idx += linesHere;
        placeMarker(); // (MORE)
        newPage({ index: i, row: idx, more: true, contd: hasCue });
        if (hasCue) placeMarker(); // NAME (CONT'D)
      } else if (atPageTop) {
        // The block alone exceeds a whole page: force progress.
        const forced = Math.min(Math.max(1, cap - 1), left);
        placeRows(forced);
        idx += forced;
        if (idx < total) {
          placeMarker();
          newPage({ index: i, row: idx, more: true, contd: hasCue });
          if (hasCue) placeMarker();
        }
      } else if (idx > 0) {
        // Rows already placed here: mark the interruption if a slot is free.
        const more = remaining() >= 1;
        if (more) placeMarker();
        newPage({ index: i, row: idx, more, contd: hasCue });
        if (hasCue) placeMarker();
      } else {
        // Nothing placed yet: move the block whole, no (MORE)/(CONT'D).
        newPage({ index: i, row: 0, more: false, contd: false });
      }
    }
  };

  /** Mirror of the export's placeAction: split, avoiding orphans/widows. */
  const placeAction = (i: number) => {
    const total = blocks[i].rows;
    let idx = 0;
    for (;;) {
      const left = total - idx;
      const cap = remaining();
      if (left <= cap) {
        placeRows(left);
        return;
      }
      let linesHere = cap;
      if (left - linesHere < MIN_SPLIT_LINES) {
        linesHere = left - MIN_SPLIT_LINES; // keep >=2 on the next page
      }
      if (linesHere < MIN_SPLIT_LINES) {
        newPage({ index: i, row: idx, more: false, contd: false });
        continue; // fresh page has full capacity
      }
      placeRows(linesHere);
      idx += linesHere;
      newPage({ index: i, row: idx, more: false, contd: false });
    }
  };

  /** A block that never splits: move it whole unless it opens the page. */
  const placeAtomic = (i: number) => {
    const total = blocks[i].rows;
    if (total > remaining() && !atPageTop) {
      newPage({ index: i, row: 0, more: false, contd: false });
    }
    placeRows(total);
  };

  /** Mirror of the export's placeFlow: fill the remaining slots and continue
      on the fresh page (used for non-keep atomic kinds, i.e. transitions).
      No (MORE)/(CONT'D): those are dialogue conventions. */
  const placeFlowBlock = (i: number) => {
    const total = blocks[i].rows;
    let idx = 0;
    while (idx < total) {
      if (remaining() <= 0) newPage({ index: i, row: idx, more: false, contd: false });
      const take = Math.min(total - idx, remaining());
      placeRows(take);
      idx += take;
    }
  };

  for (let i = 0; i < n; i++) {
    activeIndex = i;
    const b = blocks[i];
    let leadingBlanks = atPageTop ? 0 : b.spaceBefore;

    // Keep-with-next: a cue, a heading, or a parenthetical must not be
    // stranded at a page bottom. Only break early when the kept run would
    // actually fit on a fresh page.
    const keeps =
      b.kind === "character" || b.kind === "parenthetical" || b.kind === "scene_heading";
    if (keeps) {
      const keep = keepSlotsFrom(blocks, i);
      if (!atPageTop && leadingBlanks + keep > remaining() && keep <= linesPerPage) {
        newPage({ index: i, row: 0, more: false, contd: false });
        leadingBlanks = 0;
      }
    }

    // Blank rows before the element (suppressed at the top of a page).
    if (leadingBlanks > 0) {
      if (leadingBlanks >= remaining()) {
        newPage({ index: i, row: 0, more: false, contd: false });
      } else {
        advanceBlank(leadingBlanks);
      }
    }

    if (splittable[i] && b.kind === "dialogue") placeDialogue(i);
    else if (splittable[i] && b.kind === "action") placeAction(i);
    else if (!exempt[i] && !keeps) placeFlowBlock(i);
    else placeAtomic(i);
  }
  pageStartBlocks.push(curStart);

  return { breaks, pageCount: page + 1, pageStartBlocks };
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
  /** Rendered line count. */
  rows: number;
  /** Viewport top of each rendered text line (split candidates only). */
  lineTops: number[] | null;
  /** "NAME (CONT'D)" label for a dialogue continuation, or null. */
  cueLabel: string | null;
}

/**
 * Viewport tops of a block's rendered text lines, from Range.getClientRects
 * over its text nodes. Text inside our own widgets (.pm-split / .pm-page-gap)
 * is skipped so a block that already hosts a split measures its clean height.
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

/** Kinds the planner can break mid-block: dialogue and action by rule, plus
    every non-keep atomic kind (transitions) that flows across the boundary
    the way the export's placeFlow does. Keep kinds only ever whole-move. */
function canSplitKind(kind: string): boolean {
  return kind !== "character" && kind !== "parenthetical" && kind !== "scene_heading";
}

/** Per-element-kind CSS metrics. Margins and line height depend only on the
    sp-<element> classes (plus the dual flag and the first-child zeroing), so
    one getComputedStyle per distinct key replaces one per block. The plugin
    clears the cache when the editor width or the loaded font changes. */
interface KindMetrics {
  mt: number;
  mb: number;
  lineH: number;
}
type MetricsCache = Map<string, KindMetrics>;

/*
 * Block HEIGHTS are deliberately NOT cached. An earlier revision kept them in a
 * WeakMap keyed on ProseMirror node identity, which does not hold: the same
 * node object returns on a different DOM element after a delete plus undo (a
 * stale element measures nothing, so the pass forced full mode forever and
 * mid-block splits stopped happening), one node object can render at two
 * positions after a duplicate paste, and a height can change with no change of
 * identity at all (the (CONT'D) widget wrapping a long cue). Measured in the
 * feature-length benchmark, that cache was worth about 1 ms in a 69 ms pass:
 * the per-kind metrics above are the expensive lookup, and unlike heights they
 * are a pure function of the class list.
 */

/** The block's own pixel height with any hosted split widgets subtracted, so
    a block already carrying a split measures its clean text height. Uses
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

/**
 * The text offset (within the block's content) that starts rendered line
 * `row`: a binary search over caret coordinates (view.coordsAtPos, side 1)
 * against the line box's top. Returns null when the offset cannot be
 * resolved, in which case the caller degrades to a whole-block move.
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

function compute(
  view: EditorView,
  metrics: MetricsCache,
  full = false
): { decos: DecorationSet; pages: number; sig: string } {
  const measured: MeasuredBlock[] = [];
  let currentCue: string | null = null;
  view.state.doc.forEach((node, offset) => {
    const dom = view.nodeDOM(offset) as HTMLElement | null;
    if (!dom || dom.nodeType !== 1) return;
    const element = (node.attrs.element as string) ?? "action";
    // Track the nearest preceding speaker, mirroring the export engine.
    if (element === "character") {
      const base = cueBaseName(node.textContent).toUpperCase();
      currentCue = base || null;
    } else if (element === "scene_heading" || element === "action" || element === "transition") {
      currentCue = null;
    }
    measured.push({
      pos: offset,
      node,
      el: dom,
      cleanHeight: cleanBlockHeight(dom),
      element,
      dual: node.attrs.dual === true,
      mt: 0,
      mb: 0,
      rows: 1,
      lineTops: null,
      cueLabel: element === "dialogue" && currentCue ? `${currentCue} (CONT'D)` : null,
    });
  });

  const n = measured.length;

  // Stage 1: cheap geometry for every block. Margins and line height come
  // from the per-kind cache (one getComputedStyle per distinct class list,
  // not per block) and row counts from offsetHeight arithmetic. The per-line
  // measurement (TreeWalker + Range.getClientRects) is deferred to stage 2,
  // which runs it for only the blocks the plan actually splits. `full` is the
  // fallback mode: measure line boxes up front for every splittable block,
  // used when stage 2 detects a disagreement with the stage-1 row counts.
  let lineH = DEFAULT_LINE_H;
  for (let i = 0; i < n; i++) {
    const b = measured[i];
    const cacheKey = `${b.el.className}|${b.dual ? 1 : 0}${i === 0 ? "|first" : ""}`;
    let m = metrics.get(cacheKey);
    if (!m) {
      const cs = getComputedStyle(b.el);
      const lh = parseFloat(cs.lineHeight);
      m = {
        mt: parseFloat(cs.marginTop) || 0,
        mb: parseFloat(cs.marginBottom) || 0,
        lineH: Number.isFinite(lh) && lh > 0 ? lh : DEFAULT_LINE_H,
      };
      metrics.set(cacheKey, m);
    }
    if (i === 0) lineH = m.lineH;
    b.mt = m.mt;
    b.mb = m.mb;
  }
  for (let i = 0; i < n; i++) {
    const b = measured[i];
    if (full && canSplitKind(b.element)) {
      const tops = textLineTops(b.el, lineH);
      if (tops.length > 0) {
        b.lineTops = tops;
        b.rows = tops.length;
        continue;
      }
    }
    b.rows = Math.max(1, Math.round(b.cleanHeight / lineH));
  }

  const capacity = Math.max(1, Math.floor((TEXT_H + 0.5) / lineH)); // 54 at 16px
  const plan = planPages(
    measured.map((b) => ({
      kind: b.element,
      rows: b.rows,
      spaceBefore: Math.round(b.mt / lineH),
      dual: b.dual,
      cue: b.cueLabel != null,
    })),
    capacity
  );

  const breaksByBlock = new Map<number, PlanBreak[]>();
  for (const br of plan.breaks) {
    const list = breaksByBlock.get(br.index);
    if (list) list.push(br);
    else breaksByBlock.set(br.index, [br]);
  }

  // Stage 2: line boxes for only the blocks the plan splits mid-block, so
  // the split widget can land at the offset that starts the first
  // non-fitting line. Stage-1 rows and these line boxes derive from the same
  // layout; if they ever disagree (a geometry the height arithmetic missed),
  // redo the whole pass in full mode so the plan and the offsets share one
  // measurement.
  for (const [idx, brs] of breaksByBlock) {
    if (!brs.some((br) => br.row > 0)) continue;
    const b = measured[idx];
    if (b.lineTops) continue; // full mode measured it up front
    const tops = textLineTops(b.el, lineH);
    if (tops.length !== b.rows) {
      if (!full) return compute(view, metrics, true);
      // Full mode and still no usable line boxes: leave lineTops null so the
      // replay degrades to letting the rest of the block flow on.
      b.lineTops = tops.length > 0 ? tops : null;
    } else {
      b.lineTops = tops;
    }
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

  for (let i = 0; i < n; i++) {
    const b = measured[i];
    const brs = breaksByBlock.get(i) ?? [];
    let segStart = 0; // first row of the current segment
    let segTextY: number; // y where that row renders
    let bi = 0;

    if (brs[0]?.row === 0) {
      // Page break before the block; the gap absorbs its top margin so the
      // new page does not start with blank lines.
      const top = nextPageTop(y + b.mt);
      const gap = Math.max(0, top - y - b.mt);
      const specKey = `gap-${b.pos}-${Math.round(gap)}`;
      decos.push(
        Decoration.widget(b.pos, () => spacerEl(gap), {
          side: -1,
          key: specKey,
          ignoreSelection: true,
          marks: [],
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
      const offset = resolveLineStartOffset(view, b, br.row, lineH);
      if (offset == null) break; // degrade: the rest of the block flows on
      const more = br.more;
      const contd = br.contd && b.cueLabel ? b.cueLabel : null;
      const bottom = segTextY + (br.row - segStart) * lineH + (more ? lineH : 0);
      const top = nextPageTop(bottom);
      const gap = Math.max(0, top - bottom);
      const widgetPos = b.pos + 1 + offset;
      const specKey = `split-${widgetPos}-${Math.round(gap)}-${more ? 1 : 0}-${contd ?? ""}`;
      decos.push(
        Decoration.widget(widgetPos, () => splitEl(gap, more, contd), {
          side: -1,
          key: specKey,
          ignoreSelection: true,
          marks: [],
        })
      );
      sigEntries.push({ from: widgetPos, key: specKey });
      segStart = br.row;
      segTextY = top + (contd ? lineH : 0);
    }

    y = segTextY + (b.rows - segStart) * lineH + b.mb;
  }

  const pages = page + 1;
  return {
    decos: DecorationSet.create(view.state.doc, decos),
    pages,
    sig: joinSig(sigEntries, pages),
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
  return 1 + s.decos.find(0, pos).length;
}

export interface PaginationOptions {
  onPages?: (pages: number) => void;
  /** Notify React when page boundaries move without changing the page count. */
  onLayout?: () => void;
}

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
    // Convergence guard: a mid-block widget re-wraps its block's text, so one
    // extra pass may be needed after a dispatch; cap the chain so a pathological
    // layout can never RAF-loop. Reset whenever the doc or the width changes.
    let passes = 0;
    // Per-kind margin/line-height cache (see MetricsCache); cleared whenever
    // the editor width or the loaded font changes, since both re-style.
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
            const { decos, pages, sig } = compute(view, metrics);
            if (sig !== sigOfState(view.state)) {
              view.dispatch(view.state.tr.setMeta(key, { decos, pages }));
              onLayout?.();
              if (passes < 4) {
                passes++;
                schedule(true);
              }
            } else {
              passes = 0;
            }
            if (pages !== lastPages) {
              lastPages = pages;
              onPages?.(pages);
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
              if (v.state.doc !== prev.doc) {
                passes = 0;
                schedule();
              }
            },
            destroy() {
              destroyed = true;
              if (raf) cancelAnimationFrame(raf);
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
