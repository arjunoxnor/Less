/**
 * Page zoom: how big the pages are drawn on screen, 50% to 200%.
 *
 * The page host is drawn scaled (a CSS transform), never laid out again, so
 * every zoom shows the same line breaks and the same page breaks; only the
 * size on screen changes. Margins on the host give the layout the size that
 * is drawn, so the scroll range, centring and sideways scrolling follow.
 *
 * Measuring a scaled page: offsetHeight, clientWidth and computed styles are
 * the page's own pixels at any zoom, while getBoundingClientRect,
 * getClientRects and coordsAtPos are screen pixels, scaled by the zoom. The
 * paginators turn screen pixels back into page pixels with pageScale().
 */

export const ZOOM_STEPS = [0.5, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2] as const;
export const MIN_ZOOM = ZOOM_STEPS[0];
export const MAX_ZOOM = ZOOM_STEPS[ZOOM_STEPS.length - 1];

/**
 * Zooms that follow the window instead of a fixed size. Auto, the default,
 * makes the page as big as fits the window, never past 100% (a laptop sees a
 * whole page across; a big monitor sees it at its real size). Fit width
 * fills the width at any size; Whole page shows one entire page.
 */
export const ZOOM_AUTO = 0;
export const ZOOM_FIT_WIDTH = -1;
export const ZOOM_FIT_PAGE = -2;
export type ZoomMode = number;
export const isFitMode = (z: number) => z === ZOOM_AUTO || z === ZOOM_FIT_WIDTH || z === ZOOM_FIT_PAGE;

/** A page's size on screen at 100% (8.5 by 11 inches). */
const PAGE_PX_W = 816;
const PAGE_PX_H = 1056;

/** The zoom a fit mode comes to in a space this big (fixed zooms are themselves). */
export function fittedZoom(mode: number, width: number, height: number): number {
  if (!isFitMode(mode)) return mode;
  if (!(width > 0)) return 1;
  const across = width / PAGE_PX_W;
  const z = mode === ZOOM_AUTO ? Math.min(1, across) : mode === ZOOM_FIT_WIDTH ? across : Math.min(across, height / PAGE_PX_H);
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.floor(z * 100) / 100));
}

/** A stored zoom made safe: a fit mode, or a finite number within range; else Auto. */
export function clampZoom(z: unknown): number {
  if (typeof z === "number" && isFitMode(z)) return z;
  if (typeof z !== "number" || !Number.isFinite(z) || z <= 0) return 1;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(z * 100) / 100));
}

/** The next preset in (1) or out (-1) from z. */
export function stepZoom(z: number, dir: 1 | -1): number {
  if (dir > 0) return ZOOM_STEPS.find((s) => s > z + 0.001) ?? MAX_ZOOM;
  for (let i = ZOOM_STEPS.length - 1; i >= 0; i--) {
    if (ZOOM_STEPS[i] < z - 0.001) return ZOOM_STEPS[i];
  }
  return MIN_ZOOM;
}

export const zoomLabel = (z: number) => `${Math.round(z * 100)}%`;

/** How much the page holding this editor is drawn scaled (1 at 100%). */
export function pageScale(view: { dom: Element }): number {
  const host = view.dom.closest?.("[data-page-zoom]") as HTMLElement | null | undefined;
  const z = host ? Number(host.dataset.pageZoom) : 1;
  return Number.isFinite(z) && z > 0 ? z : 1;
}
