import { Extension, type Editor } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, type EditorState } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import {
  PAGE_H,
  PAGE_W,
  STRIDE,
  blockDoms,
  captureViewAnchor,
  restoreViewAnchor,
} from "./pagination";

/** The page margin derives from the screenplay sheet width, which is 8.5in. */
export const DOC_PAGE_MARGIN = PAGE_W / 8.5;
export const DOC_TEXT_HEIGHT = PAGE_H - 2 * DOC_PAGE_MARGIN;

export interface DocPlanBlock {
  /** A heading is atomic. Paragraphs receive orphan and widow control. */
  kind: "heading" | "paragraph" | "listItem" | "blockquote" | "code" | string;
  /** Border-box height without margins or pagination widgets. */
  height: number;
  marginTop: number;
  marginBottom: number;
  /** Top of each rendered line, relative to the block border box. */
  lineTops: number[];
  /** False keeps an otherwise line-bearing block atomic. */
  splittable?: boolean;
}

export interface DocPageBreak {
  blockIndex: number;
  /** Zero moves the whole block. A positive value starts that line on the next page. */
  line: number;
}

export interface DocPageAssignment {
  blockIndex: number;
  page: number;
  startLine: number;
  endLine: number;
  height: number;
  gapBefore: number;
}

export interface DocPlannedPage {
  number: number;
  used: number;
  assignments: DocPageAssignment[];
}

export interface DocPagePlan {
  breaks: DocPageBreak[];
  pages: DocPlannedPage[];
  pageCount: number;
}

/** CSS adjoining margins collapse to the largest positive plus smallest negative. */
export function collapseMargins(...margins: number[]): number {
  let positive = 0;
  let negative = 0;
  for (const raw of margins) {
    const margin = Number.isFinite(raw) ? raw : 0;
    if (margin > positive) positive = margin;
    if (margin < negative) negative = margin;
  }
  return positive + negative;
}

function cleanLineTops(block: DocPlanBlock): number[] {
  const out: number[] = [];
  for (const raw of block.lineTops) {
    if (!Number.isFinite(raw)) continue;
    const top = Math.max(0, Math.min(block.height, raw));
    if (out.length === 0 || top > out[out.length - 1] + 0.01) out.push(top);
  }
  return out;
}

function lineBoundary(block: DocPlanBlock, lines: number[], line: number): number {
  if (line <= 0) return 0;
  if (line >= lines.length) return block.height;
  return lines[line];
}

function sliceHeight(
  block: DocPlanBlock,
  lines: number[],
  startLine: number,
  endLine: number
): number {
  return Math.max(
    0,
    lineBoundary(block, lines, endLine) - lineBoundary(block, lines, startLine)
  );
}

function followingPrefixHeight(block: DocPlanBlock, lines: number[]): number {
  if (lines.length === 0) return block.height;
  // A three-line paragraph cannot legally split 2 and 1, so keep all three.
  const keptLines = block.kind === "paragraph" && lines.length === 3
    ? 3
    : Math.min(2, lines.length);
  return lineBoundary(block, lines, keptLines);
}

function headingKeepHeight(
  blocks: DocPlanBlock[],
  lineSets: number[][],
  start: number
): number {
  let total = blocks[start].height;
  let previous = blocks[start];
  for (let i = start + 1; i < blocks.length; i++) {
    const block = blocks[i];
    total += collapseMargins(previous.marginBottom, block.marginTop);
    if (block.kind === "heading") {
      total += block.height;
      previous = block;
      continue;
    }
    total += followingPrefixHeight(block, lineSets[i]);
    break;
  }
  return total;
}

/**
 * Plans prose in pixels. The planner knows nothing about the DOM and only
 * breaks at measured line tops supplied by the measurement layer.
 */
export function planDocPages(
  blocks: DocPlanBlock[],
  pageHeight = DOC_TEXT_HEIGHT
): DocPagePlan {
  const capacity = Math.max(0.01, pageHeight);
  const lineSets = blocks.map(cleanLineTops);
  const breaks: DocPageBreak[] = [];
  const pages: DocPlannedPage[] = [{ number: 1, used: 0, assignments: [] }];
  let page = pages[0];
  let previousBlock = -1;

  const startPage = (brk: DocPageBreak) => {
    breaks.push(brk);
    page = { number: pages.length + 1, used: 0, assignments: [] };
    pages.push(page);
  };

  const add = (
    blockIndex: number,
    startLine: number,
    endLine: number,
    height: number,
    gapBefore: number
  ) => {
    const assignment: DocPageAssignment = {
      blockIndex,
      page: page.number,
      startLine,
      endLine,
      height,
      gapBefore,
    };
    page.assignments.push(assignment);
    page.used += gapBefore + height;
  };

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    const lines = lineSets[i];
    const lineCount = lines.length;
    let leading = page.used > 0 && previousBlock >= 0
      ? collapseMargins(blocks[previousBlock].marginBottom, block.marginTop)
      : 0;

    if (block.kind === "heading" && page.used > 0) {
      const keep = headingKeepHeight(blocks, lineSets, i);
      if (leading + keep > capacity - page.used + 0.01 && keep <= capacity + 0.01) {
        startPage({ blockIndex: i, line: 0 });
        leading = 0;
      }
    }

    const canSplit = block.kind !== "heading" &&
      block.splittable !== false &&
      lineCount > 1;

    if (!canSplit) {
      if (leading + block.height > capacity - page.used + 0.01 && page.used > 0) {
        startPage({ blockIndex: i, line: 0 });
        leading = 0;
      }
      add(i, 0, lineCount, block.height, leading);
      previousBlock = i;
      continue;
    }

    let startLine = 0;
    let firstSlice = true;
    while (startLine < lineCount) {
      const gap = firstSlice ? leading : 0;
      const wholeHeight = sliceHeight(block, lines, startLine, lineCount);
      const available = capacity - page.used - gap;
      if (wholeHeight <= available + 0.01) {
        add(i, startLine, lineCount, wholeHeight, gap);
        startLine = lineCount;
        break;
      }

      const paragraph = block.kind === "paragraph";
      const minimumHere = paragraph ? 2 : 1;
      const minimumCarry = paragraph ? 2 : 1;
      let splitLine = -1;
      for (
        let candidate = startLine + minimumHere;
        candidate <= lineCount - minimumCarry;
        candidate++
      ) {
        const height = sliceHeight(block, lines, startLine, candidate);
        if (height <= available + 0.01) splitLine = candidate;
        else break;
      }

      if (splitLine > startLine) {
        add(
          i,
          startLine,
          splitLine,
          sliceHeight(block, lines, startLine, splitLine),
          gap
        );
        startLine = splitLine;
        startPage({ blockIndex: i, line: startLine });
        firstSlice = false;
        continue;
      }

      if (page.used > 0) {
        startPage({ blockIndex: i, line: startLine === 0 ? 0 : startLine });
        leading = 0;
        firstSlice = false;
        continue;
      }

      // Legal orphan and widow splits can be impossible for unusual measured
      // geometry. A fresh page still has to make progress at a real line edge.
      let forcedLine = -1;
      for (let candidate = startLine + 1; candidate < lineCount; candidate++) {
        const height = sliceHeight(block, lines, startLine, candidate);
        if (height <= capacity + 0.01) forcedLine = candidate;
        else break;
      }
      if (forcedLine < 0) {
        // One rendered line is taller than a page. Mid-line splitting is not
        // allowed, so this is the only geometry that can exceed a sheet.
        forcedLine = Math.min(lineCount, startLine + 1);
      }
      add(
        i,
        startLine,
        forcedLine,
        sliceHeight(block, lines, startLine, forcedLine),
        0
      );
      startLine = forcedLine;
      if (startLine < lineCount) startPage({ blockIndex: i, line: startLine });
      firstSlice = false;
    }
    previousBlock = i;
  }

  return { breaks, pages, pageCount: pages.length };
}

interface DocPaginationState {
  decos: DecorationSet;
  pages: number;
  reflow: number;
}

interface PaginationMeta {
  result?: { decos: DecorationSet; pages: number };
  request?: boolean;
}

const key = new PluginKey<DocPaginationState>("docPagination");

/** Exposed so tests can watch for a completed pagination pass. */
export const DOC_PAGINATION_KEY = key;

interface MeasuredDomBlock {
  pos: number;
  node: PMNode;
  el: HTMLElement;
  kind: DocPlanBlock["kind"];
  listItem: boolean;
  height: number;
  marginTop: number;
  marginBottom: number;
  lineTops: number[];
  cleanTop: number;
}

interface OldGap {
  top: number;
  height: number;
}

function px(value: string): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function gapElement(height: number, listItem: boolean, split: boolean): HTMLElement {
  const element = document.createElement(split ? "span" : listItem ? "li" : "div");
  element.className = split ? "doc-page-gap doc-page-split" : "doc-page-gap";
  element.style.height = `${Math.max(0, height)}px`;
  element.setAttribute("contenteditable", "false");
  element.setAttribute("aria-hidden", "true");
  return element;
}

function oldGaps(root: HTMLElement): OldGap[] {
  return Array.from(root.querySelectorAll<HTMLElement>(".doc-page-gap")).map((el) => {
    const rect = el.getBoundingClientRect();
    return { top: rect.top, height: rect.height };
  });
}

function cleanCoordinate(rootTop: number, gaps: OldGap[], viewportY: number): number {
  let removed = 0;
  for (const gap of gaps) {
    if (gap.top < viewportY - 0.25) removed += gap.height;
  }
  return viewportY - rootTop - removed;
}

function lineTopsFor(
  el: HTMLElement,
  rootTop: number,
  gaps: OldGap[],
  blockCleanTop: number
): number[] {
  const doc = el.ownerDocument;
  const nodeFilter = doc.defaultView?.NodeFilter;
  const walker = doc.createTreeWalker(el, nodeFilter?.SHOW_TEXT ?? 4, {
    acceptNode(node: Node) {
      let parent = node.parentElement;
      while (parent && parent !== el) {
        if (parent.classList.contains("doc-page-gap")) {
          return nodeFilter?.FILTER_REJECT ?? 2;
        }
        parent = parent.parentElement;
      }
      return nodeFilter?.FILTER_ACCEPT ?? 1;
    },
  });
  const range = doc.createRange();
  if (typeof range.getClientRects !== "function") return [];
  const tops: number[] = [];
  let textNode: Node | null;
  while ((textNode = walker.nextNode())) {
    range.selectNodeContents(textNode);
    for (const rect of Array.from(range.getClientRects())) {
      if (rect.height <= 0) continue;
      tops.push(cleanCoordinate(rootTop, gaps, rect.top) - blockCleanTop);
    }
  }
  tops.sort((a, b) => a - b);
  const unique: number[] = [];
  for (const top of tops) {
    const clean = Math.max(0, top);
    if (unique.length === 0 || clean - unique[unique.length - 1] > 0.75) {
      unique.push(clean);
    }
  }
  return unique;
}

function blockKind(node: PMNode): DocPlanBlock["kind"] {
  if (node.type.name === "heading") return "heading";
  if (node.type.name === "paragraph") return "paragraph";
  if (node.type.name === "blockquote") return "blockquote";
  if (node.type.name === "codeBlock") return "code";
  return node.type.name;
}

function isList(node: PMNode): boolean {
  return node.type.name === "bulletList" ||
    node.type.name === "orderedList" ||
    node.type.name === "taskList";
}

function measureBlocks(view: EditorView): {
  blocks: MeasuredDomBlock[];
  rootTop: number;
  gaps: OldGap[];
} {
  const root = view.dom as HTMLElement;
  const rootTop = root.getBoundingClientRect().top;
  const gaps = oldGaps(root);
  const blocks: MeasuredDomBlock[] = [];

  const push = (
    node: PMNode,
    pos: number,
    el: HTMLElement,
    kind: DocPlanBlock["kind"],
    listItem: boolean,
    extraTop = 0,
    extraBottom = 0
  ) => {
    const rect = el.getBoundingClientRect();
    const descendantGapHeight = Array.from(
      el.querySelectorAll<HTMLElement>(".doc-page-gap")
    ).reduce((sum, gap) => sum + gap.getBoundingClientRect().height, 0);
    const style = getComputedStyle(el);
    const cleanTop = cleanCoordinate(rootTop, gaps, rect.top);
    const height = Math.max(0, rect.height - descendantGapHeight);
    blocks.push({
      pos,
      node,
      el,
      kind,
      listItem,
      height,
      marginTop: collapseMargins(extraTop, px(style.marginTop)),
      marginBottom: collapseMargins(px(style.marginBottom), extraBottom),
      lineTops: lineTopsFor(el, rootTop, gaps, cleanTop),
      cleanTop,
    });
  };

  // One walk pairs each top-level node with its element (nodeDOM scans from
  // the top of the document on every call).
  const doms = blockDoms(view);
  let childIndex = 0;
  view.state.doc.forEach((node, offset) => {
    const dom = doms[childIndex++];
    if (!(dom instanceof HTMLElement)) return;
    if (!isList(node)) {
      push(node, offset, dom, blockKind(node), false);
      return;
    }

    const listStyle = getComputedStyle(dom);
    const listTop = px(listStyle.marginTop);
    const listBottom = px(listStyle.marginBottom);
    const last = node.childCount - 1;
    node.forEach((item, itemOffset, index) => {
      const pos = offset + 1 + itemOffset;
      const itemDom = view.nodeDOM(pos);
      if (!(itemDom instanceof HTMLElement)) return;
      push(
        item,
        pos,
        itemDom,
        "listItem",
        true,
        index === 0 ? listTop : 0,
        index === last ? listBottom : 0
      );
    });
  });

  // Rect differences are the browser's resolved margin collapse. Feeding
  // that effective gap to both adjoining sides keeps the pure planner exact
  // for lists, nested prose, positive margins, and negative margins alike.
  for (let index = 1; index < blocks.length; index++) {
    const previous = blocks[index - 1];
    const current = blocks[index];
    const effectiveGap = current.cleanTop - (previous.cleanTop + previous.height);
    previous.marginBottom = effectiveGap;
    current.marginTop = effectiveGap;
  }

  return { blocks, rootTop, gaps };
}

function resolveLineStart(
  view: EditorView,
  block: MeasuredDomBlock,
  line: number,
  rootTop: number,
  gaps: OldGap[]
): number | null {
  if (line <= 0 || line >= block.lineTops.length) return null;
  const target = block.lineTops[line];
  const from = block.pos + 1;
  const to = from + block.node.content.size;
  const relativeTopAt = (pos: number): number | null => {
    try {
      const coords = view.coordsAtPos(pos, 1);
      return cleanCoordinate(rootTop, gaps, coords.top) - block.cleanTop;
    } catch {
      return null;
    }
  };

  let lo = from;
  let hi = to;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    const top = relativeTopAt(mid);
    if (top == null) return null;
    if (top >= target - 0.75) hi = mid;
    else lo = mid + 1;
  }
  const top = relativeTopAt(lo);
  if (top == null || Math.abs(top - target) > 2) return null;
  while (lo > from) {
    const previous = relativeTopAt(lo - 1);
    if (previous == null || Math.abs(previous - target) > 2) break;
    lo--;
  }
  return lo;
}

function signature(entries: { pos: number; key: string }[], pages: number): string {
  entries.sort((a, b) => a.pos - b.pos || a.key.localeCompare(b.key));
  return `${entries.map((entry) => `${entry.pos}=${entry.key}`).join(";")}#${pages}`;
}

function stateSignature(state: EditorState): string {
  const pluginState = key.getState(state);
  if (!pluginState) return "";
  const entries = pluginState.decos.find().map((deco) => ({
    pos: deco.from,
    key: (deco.spec as { key?: string }).key ?? "",
  }));
  return signature(entries, pluginState.pages);
}

function compute(view: EditorView): {
  decos: DecorationSet;
  pages: number;
  sig: string;
} {
  const measured = measureBlocks(view);
  const plan = planDocPages(
    measured.blocks.map((block) => ({
      kind: block.kind,
      height: block.height,
      marginTop: block.marginTop,
      marginBottom: block.marginBottom,
      lineTops: block.lineTops,
      splittable: block.kind !== "heading" && block.kind !== "horizontalRule",
    }))
  );
  const decos: Decoration[] = [];
  const entries: { pos: number; key: string }[] = [];
  let cumulativeGap = 0;
  let actualPage = 0;

  for (const brk of plan.breaks) {
    const block = measured.blocks[brk.blockIndex];
    if (!block) continue;
    let widgetPos = block.pos;
    let boundary = block.cleanTop;
    let split = false;
    if (brk.line > 0) {
      const resolved = resolveLineStart(
        view,
        block,
        brk.line,
        measured.rootTop,
        measured.gaps
      );
      if (resolved != null) {
        widgetPos = resolved;
        boundary += block.lineTops[brk.line];
        split = true;
      }
    }

    actualPage++;
    let target = actualPage * STRIDE + DOC_PAGE_MARGIN;
    while (target < boundary + cumulativeGap - 0.25) {
      actualPage++;
      target = actualPage * STRIDE + DOC_PAGE_MARGIN;
    }
    const gap = Math.max(0, target - boundary - cumulativeGap);
    const rounded = Math.round(gap * 100) / 100;
    const specKey = `doc-gap-${widgetPos}-${brk.line}-${rounded.toFixed(2)}`;
    decos.push(
      Decoration.widget(
        widgetPos,
        () => gapElement(rounded, block.listItem, split),
        { side: -1, key: specKey, ignoreSelection: true, marks: [] }
      )
    );
    entries.push({ pos: widgetPos, key: specKey });
    cumulativeGap += rounded;
  }

  const pages = Math.max(plan.pageCount, actualPage + 1);
  return {
    decos: DecorationSet.create(view.state.doc, decos),
    pages,
    sig: signature(entries, pages),
  };
}

export function docPageAtPos(state: EditorState, pos: number): number {
  const pluginState = key.getState(state);
  if (!pluginState) return 1;
  return 1 + pluginState.decos.find(0, pos).length;
}

export function requestDocPagination(editor: Editor): void {
  editor.view.dispatch(editor.state.tr.setMeta(key, { request: true } satisfies PaginationMeta));
}

/** A pass slower than this runs a beat after typing instead of in the same
    frame (it clears and re-lays every spacer, so a long document costs more). */
const SAME_FRAME_BUDGET_MS = 12;

/** What the last pass saw of each top-level block: its height, and whether a
    page gap sits inside it (a split paragraph, or a list broken between items). */
interface DocGeometry {
  heights: WeakMap<Element, number>;
  hosting: WeakSet<Element>;
}

function docGeometry(view: EditorView): DocGeometry {
  const heights = new WeakMap<Element, number>();
  const hosting = new WeakSet<Element>();
  for (const el of blockDoms(view)) {
    if (!el) continue;
    heights.set(el, el.offsetHeight);
    if (el.querySelector(".doc-page-gap")) hosting.add(el);
  }
  return { heights, hosting };
}

/**
 * True when an edit cannot have moved a page break: the same top-level blocks
 * exist with the same kinds, every page gap survived, and each edited block is
 * the same element at the same height with no gap inside it. Typing inside a
 * line that does not wrap then costs one height read instead of a pass that
 * clears and re-lays every page of the document.
 */
function editKeepsDocPages(view: EditorView, prev: EditorState, geo: DocGeometry): boolean {
  const a = prev.doc;
  const b = view.state.doc;
  if (a.childCount !== b.childCount) return false;
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
      if (!a.child(i).hasMarkup(node.type, node.attrs, node.marks)) return false;
      if (isList(node)) return false; // item structure lives inside
      const el = view.nodeDOM(pos);
      if (!(el instanceof HTMLElement) || geo.hosting.has(el)) return false;
      const height = geo.heights.get(el);
      if (height == null || Math.abs(el.offsetHeight - height) > 0.5) return false;
    }
    pos = nodeEnd;
  }
  return true;
}

export interface DocPaginationOptions {
  onPages?: (pages: number) => void;
}

export const DocPagination = Extension.create<DocPaginationOptions>({
  name: "docPagination",

  addOptions() {
    return { onPages: undefined };
  },

  addProseMirrorPlugins() {
    const onPages = this.options.onPages;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let firstQueuedAt = 0;
    let destroyed = false;
    let passes = 0;
    let lastPages = -1;
    let microQueued = false;
    // Running cost of a pass, to decide between same-frame and deferred.
    let costMs = 0;
    // What the last pass measured (see editKeepsDocPages).
    let geometry: DocGeometry | null = null;
    let settleTimer: ReturnType<typeof setTimeout> | null = null;

    return [
      new Plugin<DocPaginationState>({
        key,
        state: {
          init: () => ({ decos: DecorationSet.empty, pages: 1, reflow: 0 }),
          apply(tr, previous): DocPaginationState {
            const meta = tr.getMeta(key) as PaginationMeta | undefined;
            if (meta?.result) {
              return { ...meta.result, reflow: previous.reflow };
            }
            return {
              decos: previous.decos.map(tr.mapping, tr.doc),
              pages: previous.pages,
              reflow: previous.reflow + (meta?.request ? 1 : 0),
            };
          },
        },
        props: {
          decorations(state) {
            return key.getState(state)?.decos ?? DecorationSet.empty;
          },
        },
        view(view) {
          const run = () => {
            timer = null;
            firstQueuedAt = 0;
            if (destroyed) return;
            if (view.composing) {
              schedule();
              return;
            }
            // A document with no layout cannot be paginated. If the editor is
            // measured before it has been laid out (hidden tab, mount before
            // first layout, a collapsed ancestor), every line wraps at one
            // character, a one-line paragraph measures dozens of lines tall,
            // and the planner faithfully turns a two-page note into a hundred
            // sheets with spacers wedged mid-sentence. Wait for real geometry
            // instead: the width observer below re-runs this the moment the
            // column has a width.
            if (!view.dom.isConnected || view.dom.clientWidth <= 0) {
              schedule();
              return;
            }
            // Measure the document with no spacers in it. A split spacer is an
            // inline span, and an inline span does not grow its paragraph by
            // its own height: the line box grows by whatever the baseline
            // demands. Subtracting the spacer height arithmetically therefore
            // left a residue, the block measured taller than it is, the planner
            // split it again, and each pass fed the next. Clearing first costs
            // one forced layout and makes the geometry exact by construction.
            // Both dispatches land in the same task, so nothing repaints
            // between them and the spacers never visibly flicker.
            const started = performance.now();
            const before = stateSignature(view.state);
            const current = key.getState(view.state);
            // Keep what the writer is looking at (the caret, or the top line)
            // on the same screen row across both dispatches below.
            const anchor = captureViewAnchor(view);
            if (current && current.decos !== DecorationSet.empty) {
              view.dispatch(
                view.state.tr.setMeta(key, {
                  result: { decos: DecorationSet.empty, pages: current.pages },
                } satisfies PaginationMeta)
              );
            }
            const result = compute(view);
            view.dispatch(
              view.state.tr.setMeta(key, {
                result: { decos: result.decos, pages: result.pages },
              } satisfies PaginationMeta)
            );
            restoreViewAnchor(view, anchor);
            geometry = docGeometry(view);
            const elapsed = performance.now() - started;
            costMs = costMs ? costMs * 0.7 + elapsed * 0.3 : elapsed;
            if (result.sig !== before) {
              if (passes < 4) {
                passes++;
                soon();
              }
            } else {
              passes = 0;
            }
            if (result.pages !== lastPages) {
              lastPages = result.pages;
              onPages?.(result.pages);
            }
          };

          const schedule = (immediate = false) => {
            if (destroyed) return;
            const now = Date.now();
            if (firstQueuedAt === 0) firstQueuedAt = now;
            if (timer) clearTimeout(timer);
            const elapsed = now - firstQueuedAt;
            const delay = immediate ? 0 : Math.max(0, Math.min(90, 320 - elapsed));
            timer = setTimeout(run, delay);
          };

          /**
           * Same frame when affordable: a microtask runs after ProseMirror has
           * written the edit to the DOM and before the browser paints, so the
           * writer never sees text spill past a page and snap back. A pass
           * too slow for every keystroke waits for the debounced timer.
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
              if (timer) {
                clearTimeout(timer);
                timer = null;
                firstQueuedAt = 0;
              }
              run();
            });
          };

          schedule(true);
          const ResizeObserverCtor = view.dom.ownerDocument.defaultView?.ResizeObserver;
          // Width only. Height changes on this element are the paginator's own
          // spacers, and re-running because of them is the feedback loop.
          let observedWidth = -1;
          const observer = ResizeObserverCtor
            ? new ResizeObserverCtor(() => {
                const width = view.dom.clientWidth;
                if (width === observedWidth) return;
                observedWidth = width;
                schedule();
              })
            : null;
          observer?.observe(view.dom);
          const onResize = () => schedule();
          view.dom.ownerDocument.defaultView?.addEventListener("resize", onResize);

          const fontSet = view.dom.ownerDocument.fonts;
          fontSet?.ready
            .then(() => schedule())
            .catch(() => {});

          return {
            update(nextView, previousState) {
              const previous = key.getState(previousState);
              const next = key.getState(nextView.state);
              const docChanged = nextView.state.doc !== previousState.doc;
              const reflow = next?.reflow !== previous?.reflow;
              if (!docChanged && !reflow) return;
              passes = 0;
              if (
                !reflow &&
                !microQueued &&
                timer == null &&
                geometry &&
                !nextView.composing &&
                editKeepsDocPages(nextView, previousState, geometry)
              ) {
                // Nothing moved; a full pass still runs once typing pauses.
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
              if (timer) clearTimeout(timer);
              if (settleTimer) clearTimeout(settleTimer);
              observer?.disconnect();
              view.dom.ownerDocument.defaultView?.removeEventListener("resize", onResize);
            },
          };
        },
      }),
    ];
  },
});
