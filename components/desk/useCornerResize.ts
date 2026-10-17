"use client";

import { useState } from "react";

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/**
 * Resizing something on a desk by its corner: while the handle is held the
 * thing follows the pointer (live), and the desk hears about the new size
 * once, when it is let go. Arrow keys on the handle nudge the size, for the
 * keyboard. Height is optional: covers and shut folders keep their shape and
 * only change width; an open folder (a column) takes both.
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
    const sx = e.clientX;
    const sy = e.clientY;
    const real = measure?.(e.currentTarget);
    const fromW = real?.w ?? width;
    const fromH = height === undefined ? undefined : (real?.h ?? height);
    const move = (ev: PointerEvent) => setLive(sized(ev.clientX - sx, ev.clientY - sy, fromW, fromH));
    const done = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", done);
      window.removeEventListener("pointercancel", done);
      setLive(null);
      if (ev.type !== "pointerup") return;
      const next = sized(ev.clientX - sx, ev.clientY - sy, fromW, fromH);
      const moved = Math.abs(next.w - fromW) >= 2 || (fromH !== undefined && Math.abs((next.h ?? fromH) - fromH) >= 2);
      if (moved) onCommit(next);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", done);
    window.addEventListener("pointercancel", done);
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
