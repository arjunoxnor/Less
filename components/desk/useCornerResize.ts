"use client";

import { useState } from "react";
import { swallowNextClick } from "@/lib/ui/pointerDrag";

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/**
 * Resizing something on a desk by its corner: while the handle is held the
 * thing follows the pointer (live), and the desk hears about the new size
 * once, when it is let go. Arrow keys on the handle nudge the size, for the
 * keyboard. Height is optional: covers and shut folders keep their shape and
 * only change width; an open folder (a column) takes both. Escape while
 * dragging puts the size back; letting go is never a click on what is under
 * the pointer.
 */
export function useCornerResize({
  width,
  height,
  minW,
  maxW,
  minH = 0,
  maxH = 4000,
  measure,
  onCommit,
}: {
  width: number;
  height?: number;
  minW: number;
  maxW: number;
  minH?: number;
  maxH?: number;
  /** Read the size it really has on screen when a drag starts (from its handle). */
  measure?: (handle: HTMLElement) => { w: number; h: number } | null;
  onCommit?: (size: { w: number; h?: number }) => void;
}) {
  const [live, setLive] = useState<{ w: number; h?: number } | null>(null);
  const sized = (dx: number, dy: number, fromW: number, fromH: number | undefined) => ({
    w: Math.round(clamp(fromW + dx, minW, maxW)),
    ...(fromH !== undefined ? { h: Math.round(clamp(fromH + dy, minH, maxH)) } : {}),
  });

  const start = (e: React.PointerEvent<HTMLElement>) => {
    if (!onCommit || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const handle = e.currentTarget;
    const pointerId = e.pointerId;
    const sx = e.clientX;
    const sy = e.clientY;
    const real = measure?.(handle);
    const fromW = real?.w ?? width;
    const fromH = height === undefined ? undefined : (real?.h ?? height);
    // Hold the pointer, so wherever it is let go the resize ends there.
    try {
      handle.setPointerCapture(pointerId);
    } catch {
      /* the pointer is already gone; the up handler will clean up */
    }
    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      // Let go somewhere this page never heard about (another window): done.
      if (ev.buttons === 0) return end(ev, false);
      setLive(sized(ev.clientX - sx, ev.clientY - sy, fromW, fromH));
    };
    const up = (ev: PointerEvent) => {
      if (ev.pointerId === pointerId) end(ev, false);
    };
    const lost = () => end(null, false);
    const key = (ev: KeyboardEvent) => {
      if (ev.key !== "Escape") return;
      ev.preventDefault();
      ev.stopPropagation();
      end(null, true);
    };
    function end(ev: PointerEvent | null, held: boolean) {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", lost);
      window.removeEventListener("blur", lost);
      window.removeEventListener("keydown", key, true);
      try {
        handle.releasePointerCapture(pointerId);
      } catch {
        /* already released */
      }
      setLive(null);
      swallowNextClick(pointerId, held);
      if (!ev) return;
      const next = sized(ev.clientX - sx, ev.clientY - sy, fromW, fromH);
      const moved = Math.abs(next.w - fromW) >= 2 || (fromH !== undefined && Math.abs((next.h ?? fromH) - fromH) >= 2);
      if (moved) onCommit!(next);
    }
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", lost);
    window.addEventListener("blur", lost);
    window.addEventListener("keydown", key, true);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLElement>) => {
    e.stopPropagation();
    if (!onCommit) return;
    const step = e.shiftKey ? 64 : 24;
    const keys: Record<string, [number, number]> = {
      ArrowRight: [step, 0],
      ArrowLeft: [-step, 0],
      ArrowDown: [0, step],
      ArrowUp: [0, -step],
    };
    const d = keys[e.key];
    if (!d) return;
    e.preventDefault();
    onCommit(sized(d[0], d[1], width, height));
  };

  return {
    /** The size while the handle is held, else null. */
    live,
    /** Props for the handle element. */
    handle: {
      onPointerDown: start,
      onKeyDown,
      onClick: (e: React.MouseEvent) => e.stopPropagation(),
    },
  };
}
