/**
 * A short settling motion for things that just came into view or changed
 * layout on the desk (a folder's papers as it grows, an open folder's things
 * as it turns from a list into covers), so they ease into place instead of
 * jumping. Nothing moves for a writer who asked for less motion.
 */
export function settle(
  els: Element[],
  keyframes: Keyframe[],
  { duration = 240, stagger = 0 }: { duration?: number; stagger?: number } = {}
): void {
  if (typeof window === "undefined" || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
  els.forEach((el, i) => {
    if (typeof (el as HTMLElement).animate !== "function") return;
    el.animate(keyframes, {
      duration,
      delay: Math.min(i, 8) * stagger,
      easing: "cubic-bezier(0.2, 0.8, 0.2, 1)",
      fill: "backwards",
    });
  });
}
