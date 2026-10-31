"use client";

import { useEffect, useRef, type RefObject } from "react";
import { MAX_ZOOM, MIN_ZOOM, clampHomeZoom, stepZoom, zoomLabel } from "@/lib/editor/pageZoom";

/**
 * How big the home and its desks are drawn, on top of the fit they already
 * have: 100% is the fit. Saved per device. Ctrl (Cmd on a Mac) and + − 0, and
 * Ctrl+scroll or a trackpad pinch over the home, change it instead of zooming
 * the whole browser. Phones keep the fit (the control is hidden in CSS and
 * the home passes 1).
 */
export function useHomeZoomKeys(
  zoom: number,
  setZoom: (z: number) => void,
  mainRef: RefObject<HTMLElement | null>,
  enabled: boolean
): void {
  const live = useRef({ zoom, setZoom });
  live.current = { zoom, setZoom };
  useEffect(() => {
    if (!enabled) return;
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
      const main = mainRef.current;
      if (!main || !(e.target instanceof Node) || !main.contains(e.target)) return;
      e.preventDefault();
      const { zoom: z, setZoom: set } = live.current;
      // A pinch sends small steps, a mouse wheel big ones: both feel even.
      const next = clampHomeZoom(z * Math.exp(-Math.max(-60, Math.min(60, e.deltaY)) * 0.004));
      if (Math.abs(next - z) >= 0.01) set(next);
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("wheel", onWheel);
    };
  }, [enabled, mainRef]);
}

export function HomeZoomControl({ zoom, onZoom }: { zoom: number; onZoom: (z: number) => void }) {
  return (
    <div className="lib-zoom status-zoom" role="group" aria-label="Zoom">
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
        className="status-zoom-value"
        onClick={() => onZoom(1)}
        title="Back to the size that fits the window. Ctrl and + or −, or Ctrl and scroll, to change it"
      >
        {zoom === 1 ? "Fit" : zoomLabel(zoom)}
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
    </div>
  );
}
