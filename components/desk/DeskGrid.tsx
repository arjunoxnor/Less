"use client";

import { Children, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { CloseGlyph } from "./glyphs";

/**
 * The desk's grid of covers. When a stack is fanned out, its versions open in
 * a tray across the full width, right under the row the stack sits in, so the
 * rest of the desk stays where it was instead of reflowing around it.
 *
 * `container` marks the grid as a place to arrange things (data-grid), read
 * by useHomeDrag; a grid without one (Recent, search) can still take a cover
 * dropped onto another, to stack it.
 */
export function DeskGrid({
  container,
  openIndex = -1,
  tray,
  children,
}: {
  container?: string;
  /** Index of the tile whose stack is fanned out, or -1. */
  openIndex?: number;
  tray?: ReactNode;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const columns = useColumns(ref);
  const tiles: ReactNode[] = Children.toArray(children);
  if (tray && openIndex >= 0 && openIndex < tiles.length) {
    // After the last tile in the open tile's row.
    const rowEnd = Math.min(tiles.length - 1, Math.floor(openIndex / columns) * columns + columns - 1);
    tiles.splice(rowEnd + 1, 0, tray);
  }
  return (
    <div ref={ref} className="dk-grid" data-grid={container}>
      {tiles}
    </div>
  );
}

/** How many columns the grid lays out right now (it reflows with the window). */
function useColumns(ref: React.RefObject<HTMLDivElement | null>): number {
  const [columns, setColumns] = useState(1);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const template = getComputedStyle(el).gridTemplateColumns;
      const n = template && template !== "none" ? template.split(" ").filter(Boolean).length : 1;
      setColumns((prev) => (prev === Math.max(1, n) ? prev : Math.max(1, n)));
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return columns;
}

/** A stack, fanned out: every version side by side, current first. */
export function DeskTray({
  id,
  title,
  color,
  count,
  onClose,
  children,
}: {
  id: string;
  title: string;
  color: string;
  count: number;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      className="dk-tray"
      data-tray=""
      aria-label={`Versions of ${title}`}
      style={{ ["--tray" as string]: color } as React.CSSProperties}
    >
      <div className="dk-tray-head">
        <span className="dk-tray-title">{title}</span>
        <span className="dk-tray-sub">
          {count} versions. The current one is first; drag one out to unstack it.
        </span>
        <button
          type="button"
          className="lib-icon-btn dk-tray-close"
          aria-label="Fold the versions"
          title="Fold the versions"
          onClick={onClose}
        >
          <CloseGlyph />
        </button>
      </div>
      <div className="dk-tray-row">{children}</div>
    </section>
  );
}
