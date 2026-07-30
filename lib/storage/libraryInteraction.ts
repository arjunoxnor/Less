/** Interactive controls inside a draggable row retain their own pointer use. */
export function canStartLibraryDrag(target: EventTarget | null): boolean {
  return !(
    target instanceof Element &&
    target.closest("input, textarea, button, select, a, [contenteditable='true']")
  );
}
