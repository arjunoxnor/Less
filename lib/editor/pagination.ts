import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, type EditorState } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";

/**
 * Visual pagination: makes a single continuous editor LOOK like a stack of
 * separate US-Letter pages (the Google-Docs look). It measures the top-level
 * blocks and, at each page boundary, inserts a transparent spacer widget that
 * pushes the next block down to the top of the next sheet. A separate backdrop
 * (PageBackdrop) draws the white sheets behind the text; the spacers leave the
 * inter-page gaps empty so no text ever lands in a gap.
 *
 * Block heights are measured gap-independently (own box height + vertical
 * margins), so the computation is stable and converges in a single pass.
 */

const key = new PluginKey<PagState>("pagination");

const DPI = 96;
export const PAGE_H = 11 * DPI; // 1056
export const PAGE_W = 8.5 * DPI; // 816
const MARGIN = 1 * DPI; // 96 (top/bottom page margin)
const TEXT_H = PAGE_H - 2 * MARGIN; // 864 (text area per page)
export const DESK_GAP = 22; // grey gap shown between sheets
export const STRIDE = PAGE_H + DESK_GAP; // 1078 (one page to the next)

interface PagState {
  decos: DecorationSet;
  pages: number;
}

function spacerEl(height: number): HTMLElement {
  const d = document.createElement("div");
  d.className = "pm-page-gap";
  d.style.height = `${height}px`;
  d.setAttribute("contenteditable", "false");
  d.setAttribute("aria-hidden", "true");
  return d;
}

// One getComputedStyle per block (it is the expensive call on long scripts).
// Most blocks carry a margin on a single side (screenplay lines use margin-top,
// prose paragraphs use margin-bottom), so summing both gives the real flow
// advance without double-counting a collapsed margin.
function measure(el: HTMLElement): { height: number; marginTop: number } {
  const r = el.getBoundingClientRect();
  const cs = getComputedStyle(el);
  const marginTop = parseFloat(cs.marginTop) || 0;
  return { height: r.height + marginTop + (parseFloat(cs.marginBottom) || 0), marginTop };
}

// Elements that must never be the last thing on a page: a scene heading needs
// its first line under it, a character cue needs its dialogue, and a
// parenthetical needs the dialogue it introduces. Mirrors the export engine's
// keep-with-next rule (lib/export/paginate.ts), so the live page sheets break
// where the printed PDF does.
const KEEP_WITH_NEXT = new Set(["scene_heading", "character", "parenthetical"]);

function compute(view: EditorView): { decos: DecorationSet; pages: number; sig: string } {
  const blocks: { pos: number; el: HTMLElement; element: string }[] = [];
  view.state.doc.forEach((node, offset) => {
    const dom = view.nodeDOM(offset) as HTMLElement | null;
    if (dom && dom.nodeType === 1)
      blocks.push({ pos: offset, el: dom, element: (node.attrs.element as string) ?? "action" });
  });

  const n = blocks.length;
  const m = blocks.map((b) => measure(b.el));

  // The combined flow height a keep-with-next block must reserve so it is not
  // stranded at a page bottom: its own height, any consecutive parentheticals,
  // and the dialogue (or, for a heading/cue chain, that block's own group). If
  // this does not fit in the remaining page, the block moves to the next page
  // WITH what follows, instead of orphaning (a cue alone at the bottom).
  const groupHeight = (i: number, depth = 0): number => {
    let total = m[i].height;
    let j = i + 1;
    while (j < n && blocks[j].element === "parenthetical") {
      total += m[j].height;
      j++;
    }
    if (j < n) {
      const k = blocks[j].element;
      if (k === "dialogue") total += m[j].height;
      else if (depth < 6 && (k === "character" || k === "scene_heading"))
        total += groupHeight(j, depth + 1);
      else total += m[j].height;
    }
    return total;
  };

  const decos: Decoration[] = [];
  let page = 0;
  let y = MARGIN; // cursor in final (gapped) editor coordinates
  let limit = MARGIN + TEXT_H; // bottom of current page's text area
  let sig = "";

  for (let i = 0; i < n; i++) {
    const { height: h, marginTop: mt } = m[i];
    const pageTextTop = page * STRIDE + MARGIN;
    // A keep-with-next line must reserve room for its whole group, so it is
    // pushed to the next page as a unit rather than orphaned at the bottom.
    const commit = KEEP_WITH_NEXT.has(blocks[i].element) ? groupHeight(i) : h;
    // Break before this block when it (or its group) overflows the page, but
    // never before the first block on a page, so a block/group taller than a
    // page does not loop.
    if (y + commit > limit && y > pageTextTop) {
      page++;
      const newY = page * STRIDE + MARGIN;
      // Absorb the block's top margin into the gap so a page does not start with
      // a leading blank line (screenplay action lines carry a 16px top margin).
      const gap = Math.max(0, newY - y - mt);
      decos.push(
        Decoration.widget(blocks[i].pos, () => spacerEl(gap), {
          side: -1,
          key: `gap-${blocks[i].pos}`,
          ignoreSelection: true,
        })
      );
      sig += `${blocks[i].pos}:${Math.round(gap)};`;
      y = newY + (h - mt); // text starts at newY; advance by the block minus its top margin
      limit = page * STRIDE + MARGIN + TEXT_H;
    } else {
      y += h;
    }
  }

  const pages = page + 1;
  return {
    decos: DecorationSet.create(view.state.doc, decos),
    pages,
    sig: `${sig}#${pages}`,
  };
}

export interface PaginationOptions {
  onPages?: (pages: number) => void;
}

export const Pagination = Extension.create<PaginationOptions>({
  name: "pagination",
  addOptions() {
    return { onPages: undefined };
  },
  addProseMirrorPlugins() {
    const onPages = this.options.onPages;
    let raf = 0;
    let lastSig = "";
    let lastPages = -1;

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
          const run = () => {
            raf = 0;
            const { decos, pages, sig } = compute(view);
            if (sig !== lastSig) {
              lastSig = sig;
              view.dispatch(view.state.tr.setMeta(key, { decos, pages }));
            }
            if (pages !== lastPages) {
              lastPages = pages;
              onPages?.(pages);
            }
          };
          const schedule = () => {
            if (!raf) raf = requestAnimationFrame(run);
          };
          schedule();
          const ro = new ResizeObserver(schedule);
          ro.observe(view.dom);

          // Recompute once the web font finishes loading. Block heights change
          // when Courier Prime replaces the fallback font, so a break computed
          // mid-load lands in the wrong place and text spills past the sheet.
          // Belt-and-suspenders delayed passes also catch content that mounts
          // just after the plugin initializes.
          const timers: ReturnType<typeof setTimeout>[] = [];
          if (typeof document !== "undefined" && document.fonts?.ready) {
            document.fonts.ready.then(schedule).catch(() => {});
          }
          timers.push(setTimeout(schedule, 60));
          timers.push(setTimeout(schedule, 300));
          timers.push(setTimeout(schedule, 1000));

          return {
            update(v, prev) {
              if (v.state.doc !== prev.doc) schedule();
            },
            destroy() {
              if (raf) cancelAnimationFrame(raf);
              timers.forEach(clearTimeout);
              ro.disconnect();
            },
          };
        },
      }),
    ];
  },
});
