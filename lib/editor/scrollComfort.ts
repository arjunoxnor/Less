/**
 * How close the caret may come to an edge of the page view while typing
 * before the view scrolls, and how far from that edge it lands when it does.
 *
 * ProseMirror's default is a 5px margin, which keeps the caret pinned to the
 * very bottom edge of the window: every wrapped line there scrolls the page by
 * a line, the writer never sees what comes next, and a line pushed onto the
 * next page lands out of sight. With room below the caret the view scrolls in
 * calm steps and the writer always has a few lines of context under the line
 * they are on. Both editors (screenplay and document) use the same numbers.
 */
export const TYPING_SCROLL_MARGIN = { top: 64, bottom: 120, left: 8, right: 8 };

/**
 * Typewriter scrolling: put the caret's line at a fixed height in the page
 * view (a little above the middle, where the eye rests), by moving only the
 * view that scrolls the page. The caret itself is measured, never the line
 * box: a line that carries a page break is two pages tall, and centring that
 * box put the caret nowhere near the middle.
 */
export function centerCaret(view: {
  dom: HTMLElement;
  state: { selection: { head: number } };
  coordsAtPos(pos: number): { top: number; bottom: number };
}): void {
  let scroller: HTMLElement | null = null;
  for (let p = view.dom.parentElement; p; p = p.parentElement) {
    const oy = getComputedStyle(p).overflowY;
    if (oy === "auto" || oy === "scroll") {
      scroller = p;
      break;
    }
  }
  if (!scroller) return;
  try {
    const box = scroller.getBoundingClientRect();
    const caret = view.coordsAtPos(view.state.selection.head);
    const target = box.top + box.height * 0.42;
    const delta = (caret.top + caret.bottom) / 2 - target;
    if (Math.abs(delta) >= 1) scroller.scrollTop += delta;
  } catch {
    // A position the layout cannot resolve: leave the view alone.
  }
}
