export interface CaretRect {
  left: number;
  top: number;
  bottom: number;
}

export interface MenuSize {
  width: number;
  height: number;
}

/** Keep a caret-anchored menu inside the visible viewport on every edge. */
export function positionAutocompleteMenu(
  coords: CaretRect,
  menu: MenuSize,
  viewport: MenuSize,
  padding = 8,
  gap = 2
): { left: number; top: number } {
  const maxLeft = Math.max(padding, viewport.width - menu.width - padding);
  const left = Math.max(padding, Math.min(coords.left, maxLeft));

  let top = coords.bottom + gap;
  if (top + menu.height > viewport.height - padding) {
    top = coords.top - menu.height - gap;
  }
  const maxTop = Math.max(padding, viewport.height - menu.height - padding);
  top = Math.max(padding, Math.min(top, maxTop));

  return { left, top };
}
