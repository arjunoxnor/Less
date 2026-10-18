/**
 * Dragging with the pointer instead of the browser's own drag and drop.
 *
 * The browser's drag (draggable="true") shows a faint snapshot that cannot be
 * styled, and on a Mac it swallows the trackpad and the wheel for as long as it
 * lasts, so nothing scrolls while you carry something: a list longer than the
 * window cannot be rearranged end to end. This drag is plain pointer events.
 * The page keeps scrolling under the wheel as usual, and near the top or the
 * bottom of the scroller it scrolls by itself, faster the closer the pointer
 * is to the edge (and at full speed past it).
 *
 * The caller owns the meaning: it hit-tests the point it is handed on every
 * move and draws its own drop marker. A press that never travels far enough is
 * an ordinary click and calls nothing here.
 */

export interface DragPoint {
  x: number;
  y: number;
}

export interface PointerDragOptions {
  /** What was pressed. A copy of it follows the pointer. */
  source: HTMLElement;
  /**
   * The scroller to run near its edges. Defaults to the nearest one above the
   * source. A function picks one for each point, for a page with two panes
   * (the home's sidebar and its main list) that should each scroll under the
   * pointer.
   */
  scroller?: HTMLElement | null | ((point: DragPoint) => HTMLElement | null);
  /** Build the floating copy. Defaults to a clone of the source. */
  ghost?: (source: HTMLElement) => HTMLElement;
  /**
   * Where the floating copy sits: by default it keeps the spot where it was
   * grabbed under the pointer; an offset puts its top-left corner that far
   * from the pointer instead (a small chip that should not hide the target).
   */
  ghostOffset?: { x: number; y: number };
  /** How far a mouse press travels before it becomes a drag. */
  threshold?: number;
  /** The drag has begun. */
  onStart?: () => void;
  /** The pointer moved, or the page scrolled under it. */
  onMove: (point: DragPoint) => void;
  /** Released over the page: commit. */
  onDrop: (point: DragPoint) => void;
  /** Escape, a lost pointer, or the window losing focus. */
  onCancel: () => void;
}

/** The edge band, in px, where the scroller starts to run. */
export const AUTOSCROLL_EDGE = 72;
/** Scroll speed at the very edge, in px per frame. */
export const AUTOSCROLL_MAX = 22;

/**
 * How far to scroll this frame for a pointer at `y` over a scroller spanning
 * `top` to `bottom`: nothing in the middle, easing in across the edge band,
 * and full speed at the edge and beyond it.
 */
export function autoScrollStep(y: number, top: number, bottom: number): number {
  const band = Math.min(AUTOSCROLL_EDGE, (bottom - top) / 4);
  if (band <= 0) return 0;
  if (y < top + band) {
    const depth = Math.min(1, (top + band - y) / band);
    return -Math.max(1, Math.round(AUTOSCROLL_MAX * depth * depth));
  }
  if (y > bottom - band) {
    const depth = Math.min(1, (y - (bottom - band)) / band);
    return Math.max(1, Math.round(AUTOSCROLL_MAX * depth * depth));
  }
  return 0;
}

/** The nearest ancestor that scrolls vertically, or the page itself. */
export function scrollParentOf(el: HTMLElement): HTMLElement {
  let node: HTMLElement | null = el.parentElement;
  while (node && node !== document.body) {
    const overflow = getComputedStyle(node).overflowY;
    if ((overflow === "auto" || overflow === "scroll") && node.scrollHeight > node.clientHeight) {
      return node;
    }
    node = node.parentElement;
  }
  return (document.scrollingElement as HTMLElement | null) ?? document.documentElement;
}

function defaultGhost(source: HTMLElement): HTMLElement {
  const copy = source.cloneNode(true) as HTMLElement;
  copy.removeAttribute("id");
  copy.querySelectorAll("[id]").forEach((el) => el.removeAttribute("id"));
  return copy;
}

/** True while a pointer drag is running, so hover-only UI can stand down. */
let active = false;
export const isPointerDragging = () => active;

/**
 * Eat the click that a press-and-drag would otherwise end with, so letting go
 * over something never opens it. With `held`, the button is still down (the
 * drag was called off with Escape): wait for it to come up first.
 */
export function swallowNextClick(pointerId: number, held = false): void {
  const swallow = (event: MouseEvent) => {
    event.stopPropagation();
    event.preventDefault();
  };
  const stop = () => {
    window.removeEventListener("click", swallow, true);
    window.removeEventListener("pointerdown", stop, true);
  };
  window.addEventListener("click", swallow, true);
  // Whatever happens, a new press is never eaten.
  window.addEventListener("pointerdown", stop, true);
  if (!held) {
    setTimeout(stop, 0);
    return;
  }
  const up = (event: PointerEvent) => {
    if (event.pointerId !== pointerId) return;
    window.removeEventListener("pointerup", up, true);
    setTimeout(stop, 0);
  };
  window.addEventListener("pointerup", up, true);
}

/**
 * Start watching a press. Call from a pointerdown handler; the rest runs on
 * window listeners until the pointer is released.
 */
export function beginPointerDrag(down: PointerEvent, options: PointerDragOptions): void {
  if (active || down.button !== 0 || !down.isPrimary) return;
  const { source } = options;
  const startX = down.clientX;
  const startY = down.clientY;
  const threshold = options.threshold ?? 5;
  // A finger has to rest a moment first: moving straight away is a scroll.
  const touch = down.pointerType === "touch";
  let ready = !touch;
  const holdTimer = touch ? setTimeout(() => (ready = true), 260) : null;

  let started = false;
  // Picked up near an edge (a tool at the top of the toolbar, say), the pane
  // waits until the pointer has been away from that edge before it scrolls
  // by itself, so it never runs off while the writer takes aim.
  let armedY = false;
  let armedX = false;
  let last: DragPoint = { x: startX, y: startY };
  let grab = { x: 0, y: 0 };
  let ghost: HTMLElement | null = null;
  let frame = 0;
  const fixed =
    typeof options.scroller === "function" ? null : (options.scroller ?? scrollParentOf(source));
  const scrollerAt = (point: DragPoint): HTMLElement | null =>
    typeof options.scroller === "function" ? options.scroller(point) : fixed;

  const place = () => {
    if (ghost) {
      ghost.style.transform = `translate3d(${last.x - grab.x}px, ${last.y - grab.y}px, 0)`;
    }
  };

  const run = () => {
    frame = requestAnimationFrame(run);
    const scroller = scrollerAt(last);
    if (!scroller) return;
    const pageScroller =
      scroller === document.scrollingElement || scroller === document.documentElement;
    const rect = pageScroller
      ? { top: 0, bottom: window.innerHeight, left: 0, right: window.innerWidth }
      : scroller.getBoundingClientRect();
    const step = autoScrollStep(last.y, rect.top, rect.bottom);
    // Sideways too, for a pane wider than the window (a project's desk).
    const wide = !pageScroller && scroller.scrollWidth > scroller.clientWidth;
    const rawX = wide ? autoScrollStep(last.x, rect.left, rect.right) : 0;
    if (step === 0) armedY = true;
    if (rawX === 0) armedX = true;
    const stepY = armedY ? step : 0;
    const stepX = armedX ? rawX : 0;
    if (stepY === 0 && stepX === 0) return;
    const before = pageScroller ? window.scrollY : scroller.scrollTop;
    const beforeX = pageScroller ? 0 : scroller.scrollLeft;
    if (stepY !== 0) {
      if (pageScroller) window.scrollBy(0, stepY);
      else scroller.scrollTop += stepY;
    }
    if (stepX !== 0) scroller.scrollLeft += stepX;
    const after = pageScroller ? window.scrollY : scroller.scrollTop;
    const afterX = pageScroller ? 0 : scroller.scrollLeft;
    if (after !== before || afterX !== beforeX) options.onMove(last);
  };

  const start = () => {
    started = true;
    active = true;
    const rect = source.getBoundingClientRect();
    grab = options.ghostOffset
      ? { x: -options.ghostOffset.x, y: -options.ghostOffset.y }
      : { x: startX - rect.left, y: startY - rect.top };
    window.getSelection()?.removeAllRanges();
    ghost = (options.ghost ?? defaultGhost)(source);
    ghost.classList.add("drag-ghost");
    ghost.setAttribute("aria-hidden", "true");
    Object.assign(ghost.style, {
      position: "fixed",
      left: "0px",
      top: "0px",
      width: options.ghostOffset ? "auto" : `${rect.width}px`,
      margin: "0px",
      pointerEvents: "none",
      zIndex: "1000",
    });
    document.body.appendChild(ghost);
    place();
    document.documentElement.classList.add("is-dragging");
    try {
      source.setPointerCapture(down.pointerId);
    } catch {
      /* the pointer is already gone; the up handler will clean up */
    }
    options.onStart?.();
    options.onMove(last);
    frame = requestAnimationFrame(run);
  };

  const cleanup = (held = false) => {
    window.removeEventListener("pointermove", move, true);
    window.removeEventListener("pointerup", up, true);
    window.removeEventListener("pointercancel", lost, true);
    window.removeEventListener("keydown", key, true);
    window.removeEventListener("blur", lost);
    if (holdTimer) clearTimeout(holdTimer);
    cancelAnimationFrame(frame);
    ghost?.remove();
    ghost = null;
    if (started) {
      document.documentElement.classList.remove("is-dragging");
      try {
        source.releasePointerCapture(down.pointerId);
      } catch {
        /* already released */
      }
      // The release after a drag would otherwise land as a click on whatever
      // was carried, and open it.
      swallowNextClick(down.pointerId, held);
    }
    active = false;
  };

  function move(event: PointerEvent) {
    if (event.pointerId !== down.pointerId) return;
    last = { x: event.clientX, y: event.clientY };
    if (!started) {
      const distance = Math.hypot(last.x - startX, last.y - startY);
      if (!ready) {
        if (distance > 8) cleanup();
        return;
      }
      if (distance < threshold) return;
      start();
      return;
    }
    event.preventDefault();
    place();
    options.onMove(last);
  }

  function up(event: PointerEvent) {
    if (event.pointerId !== down.pointerId) return;
    const was = started;
    last = { x: event.clientX, y: event.clientY };
    cleanup();
    if (was) options.onDrop(last);
  }

  function cancel(held = false) {
    const was = started;
    cleanup(held);
    if (was) options.onCancel();
  }
  const lost = () => cancel();

  function key(event: KeyboardEvent) {
    if (event.key !== "Escape" || !started) return;
    event.preventDefault();
    event.stopPropagation();
    // The button is still down: its release must not click what is under it.
    cancel(true);
  }

  window.addEventListener("pointermove", move, true);
  window.addEventListener("pointerup", up, true);
  window.addEventListener("pointercancel", lost, true);
  window.addEventListener("keydown", key, true);
  window.addEventListener("blur", lost);
}

/* ---- Hit-testing helpers --------------------------------------------------- */

/**
 * The insertion slot in a vertical list for a pointer at `y`: before the first
 * item whose middle is below the pointer, else after the last. The whole list
 * is the target; nothing has to be aimed at a hairline.
 */
export function listSlotAt(items: HTMLElement[], y: number): number {
  for (let i = 0; i < items.length; i++) {
    const r = items[i].getBoundingClientRect();
    if (y < r.top + r.height / 2) return i;
  }
  return items.length;
}

/**
 * The insertion slot in a wrapping grid for a pointer at (x, y): the row the
 * pointer is in (or the nearest one), then before the first card in that row
 * whose middle is to the right of the pointer, else after the row's last card.
 */
export function gridSlotAt(items: HTMLElement[], x: number, y: number): number {
  if (items.length === 0) return 0;
  const rects = items.map((el) => el.getBoundingClientRect());
  // Rows by their top edge.
  const rows: { top: number; bottom: number; first: number; last: number }[] = [];
  rects.forEach((r, i) => {
    const row = rows[rows.length - 1];
    if (row && Math.abs(r.top - row.top) < 4) {
      row.last = i;
      row.bottom = Math.max(row.bottom, r.bottom);
    } else {
      rows.push({ top: r.top, bottom: r.bottom, first: i, last: i });
    }
  });
  let row = rows[0];
  let best = Infinity;
  for (const candidate of rows) {
    const distance =
      y < candidate.top ? candidate.top - y : y > candidate.bottom ? y - candidate.bottom : 0;
    if (distance < best) {
      best = distance;
      row = candidate;
    }
  }
  for (let i = row.first; i <= row.last; i++) {
    const r = rects[i];
    if (x < r.left + r.width / 2) return i;
  }
  return row.last + 1;
}
