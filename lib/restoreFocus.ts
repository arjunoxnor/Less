/**
 * Give focus back to whatever had it before a palette, menu, or dialog took
 * it, without moving the page.
 *
 * A plain element.focus() scrolls the element into view. For the script
 * editor that is a disaster: while the palette's search box held focus the
 * browser's selection left the editor, so focusing the editor again puts the
 * caret at the very start of the script and scrolls there, and ProseMirror
 * then scrolls back down to where the caret belongs, leaving it pinned to the
 * bottom edge of the window. ProseMirror's own view.focus() restores the
 * writer's selection first and never scrolls, so an editor gets that; any
 * other control is focused with preventScroll.
 */
export function restoreFocus(el: Element | null | undefined): void {
  if (!(el instanceof HTMLElement) || !el.isConnected) return;
  const editor = (el as { editor?: { view?: { focus(): void }; isDestroyed?: boolean } }).editor;
  if (editor?.view && !editor.isDestroyed) {
    editor.view.focus();
    return;
  }
  el.focus({ preventScroll: true });
}
