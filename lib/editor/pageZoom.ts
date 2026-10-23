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

/** A stored zoom made safe: a finite number within range, else 100%. */
export function clampZoom(z: unknown): number {
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
