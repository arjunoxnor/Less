"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import { Menu, type MenuItem } from "../ui/Menu";
import {
  MAX_ZOOM,
  MIN_ZOOM,
  ZOOM_AUTO,
  ZOOM_FIT_PAGE,
  ZOOM_FIT_WIDTH,
  ZOOM_STEPS,
  clampZoom,
  fittedZoom,
  isFitMode,
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
export function ZoomControl({
  zoom,
  mode = zoom,
  onZoom,
}: {
  /** The size the pages are drawn at now. */
  zoom: number;
  /** What was chosen: a fixed size, or one of the fits (pageZoom.ts). */
  mode?: number;
  onZoom: (z: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const fit = (value: number, label: string, hint: string): MenuItem => ({
    kind: "radio" as const,
    group: "zoom",
    label,
    hint,
    checked: mode === value,
    onSelect: () => onZoom(value),
  });
  const items: MenuItem[] = [
    fit(ZOOM_AUTO, "Auto", "fits the window"),
    fit(ZOOM_FIT_WIDTH, "Fit width", ""),
    fit(ZOOM_FIT_PAGE, "Whole page", ""),
    { kind: "divider" },
    ...ZOOM_STEPS.map((z) => ({
      kind: "radio" as const,
      group: "zoom",
      label: zoomLabel(z),
      checked: !isFitMode(mode) && Math.abs(z - zoom) < 0.001,
      onSelect: () => onZoom(z),
    })),
  ];
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
        title={
          mode === ZOOM_AUTO ? "Zoom: Auto (fits the window). Ctrl and + or −, or Ctrl and scroll" : mode === ZOOM_FIT_WIDTH ? "Zoom: Fit width" : mode === ZOOM_FIT_PAGE ? "Zoom: Whole page" : "Zoom. Ctrl and + or −, or Ctrl and scroll"
        }
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
): { zoom: number; mode: number; setZoom: (z: number) => void } {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const mq = typeof window !== "undefined" && window.matchMedia ? window.matchMedia("(max-width: 720px)") : null;
    if (!mq) return;
    const sync = () => setNarrow(mq.matches);
    sync();
    mq.addEventListener?.("change", sync);
    return () => mq.removeEventListener?.("change", sync);
  }, []);
  const anchor = useRef<{ view: ViewAnchor | null } | null>(null);
  // The room the pages have, for the fits (Auto, Fit width, Whole page).
  const [room, setRoom] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    let observer: ResizeObserver | null = null;
    let frame = 0;
    const attach = () => {
      const box = editor.isDestroyed ? null : editor.view.dom.closest<HTMLElement>(".page-scroll");
      if (!box) {
        frame = requestAnimationFrame(attach); // not on the page yet
        return;
      }
      const measure = () => {
        const cs = getComputedStyle(box);
        const w = box.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - 8;
        const h = box.clientHeight - parseFloat(cs.paddingTop) - 24;
        setRoom((r) => {
          if (Math.abs(r.w - w) < 2 && Math.abs(r.h - h) < 2) return r;
          // A fitting zoom follows the window: keep the line being read where
          // it is as the pages change size.
          if (isFitMode(modeRef.current) && r.w > 0 && !editor.isDestroyed) {
            anchor.current = { view: captureViewAnchor(editor.view) };
          }
          return { w, h };
        });
      };
      measure();
      if (typeof ResizeObserver !== "undefined") {
        observer = new ResizeObserver(measure);
        observer.observe(box);
      }
    };
    attach();
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
    };
  }, [editor]);
  const mode = narrow ? 1 : saved;
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const zoom = fittedZoom(mode, room.w, room.h);

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
    if (z === mode) return;
    const view = editor && !editor.isDestroyed ? editor.view : null;
    anchor.current = { view: view ? captureViewAnchor(view) : null };
    save(z);
  };

  // Ctrl and + / − / 0 (Cmd on a Mac), and Ctrl+scroll or a trackpad pinch
  // over the page, zoom the pages, never the whole browser.
  const live = useRef({ zoom, setZoom });
  live.current = { zoom, setZoom };
  useEffect(() => {
    if (!editor || narrow) return;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const { zoom: z, setZoom: set } = live.current;
      if (e.key === "=" || e.key === "+") set(stepZoom(z, 1));
      else if (e.key === "-" || e.key === "_") set(stepZoom(z, -1));
      else if (e.key === "0") set(1);
      else return;
      e.preventDefault();
    };
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      const box = editor.isDestroyed ? null : editor.view.dom.closest(".page-scroll");
      if (!box || !(e.target instanceof Node) || !box.contains(e.target)) return;
      e.preventDefault();
      const { zoom: z, setZoom: set } = live.current;
      // A pinch sends small steps, a mouse wheel big ones: both feel even.
      const next = clampZoom(z * Math.exp(-Math.max(-60, Math.min(60, e.deltaY)) * 0.004));
      if (Math.abs(next - z) >= 0.01) set(next);
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("wheel", onWheel);
    };
  }, [editor, narrow]);
  return { zoom, mode, setZoom };
}
