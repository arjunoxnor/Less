"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import { Menu, type MenuItem } from "../ui/Menu";
import {
  MAX_ZOOM,
  MIN_ZOOM,
  ZOOM_STEPS,
  stepZoom,
  zoomLabel,
} from "@/lib/editor/pageZoom";
import {
  captureViewAnchor,
  restoreViewAnchor,
  scrollParentOf,
  type ViewAnchor,
} from "@/lib/editor/pagination";

/**
 * The status bar's zoom: out, the current size (a menu of presets), in. A
 * phone's page already fills the screen, so there the control is hidden
 * (globals.css) and the pages stay at 100% (usePageZoom).
 */
export function ZoomControl({ zoom, onZoom }: { zoom: number; onZoom: (z: number) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const items: MenuItem[] = ZOOM_STEPS.map((z) => ({
    kind: "radio" as const,
    group: "zoom",
    label: zoomLabel(z),
    checked: Math.abs(z - zoom) < 0.001,
    onSelect: () => onZoom(z),
  }));
  return (
    <span className="status-zoom" role="group" aria-label="Zoom">
      <button
        type="button"
        className="status-zoom-step"
        onClick={() => onZoom(stepZoom(zoom, -1))}
        disabled={zoom <= MIN_ZOOM + 0.001}
        aria-label="Zoom out"
        title="Zoom out"
      >
        −
      </button>
      <button
        type="button"
        ref={ref}
        className="status-zoom-value"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Zoom"
      >
        {zoomLabel(zoom)}
      </button>
      <button
        type="button"
        className="status-zoom-step"
        onClick={() => onZoom(stepZoom(zoom, 1))}
        disabled={zoom >= MAX_ZOOM - 0.001}
        aria-label="Zoom in"
        title="Zoom in"
      >
        +
      </button>
      {open && ref.current && (
        <Menu
          side="top"
          anchor={ref.current.getBoundingClientRect()}
          items={items}
          onClose={() => setOpen(false)}
          ariaLabel="Zoom"
        />
      )}
    </span>
  );
}

/**
 * The zoom the pages are drawn at (the saved one, or 100% on a phone), and a
 * setter that keeps the writer's place: the caret (or the text at the top of
 * the view) stays on the same screen row, and a page wider than the window
 * is centred.
 */
export function usePageZoom(
  editor: Editor | null,
  saved: number,
  save: (z: number) => void
): { zoom: number; setZoom: (z: number) => void } {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const mq = typeof window !== "undefined" && window.matchMedia ? window.matchMedia("(max-width: 720px)") : null;
    if (!mq) return;
    const sync = () => setNarrow(mq.matches);
    sync();
    mq.addEventListener?.("change", sync);
    return () => mq.removeEventListener?.("change", sync);
  }, []);
  const zoom = narrow ? 1 : saved;

  const anchor = useRef<{ view: ViewAnchor | null } | null>(null);
  useLayoutEffect(() => {
    const pending = anchor.current;
    anchor.current = null;
    const view = editor && !editor.isDestroyed ? editor.view : null;
    if (!pending || !view) return;
    restoreViewAnchor(view, pending.view);
    const scroller = pending.view?.scroller ?? scrollParentOf(view.dom) ?? view.dom.closest(".page-scroll");
    if (scroller instanceof HTMLElement) {
      scroller.scrollLeft = Math.max(0, (scroller.scrollWidth - scroller.clientWidth) / 2);
    }
  }, [zoom, editor]);

  const setZoom = (z: number) => {
    if (Math.abs(z - zoom) < 0.001) return;
    const view = editor && !editor.isDestroyed ? editor.view : null;
    anchor.current = { view: view ? captureViewAnchor(view) : null };
    save(z);
  };
  return { zoom, setZoom };
}
