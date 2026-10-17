"use client";

import { useLayoutEffect, useRef, type ReactNode } from "react";

/**
 * A project's desk: an open surface where things sit wherever they were put.
 * It is as wide as the pane (or wider, when something was pushed off to the
 * right) and as tall as what is on it, plus room to spare below. It reports
 * the width it has, so things placed for the writer fit across it.
 *
 * data-desk makes the whole surface a place to let go (see useHomeDrag).
 */
export function DeskCanvas({
  desk,
  minWidth,
  height,
  tidying,
  onWidth,
  children,
}: {
  desk: string;
  /** The rightmost edge of what is on the desk. */
  minWidth: number;
  height: number;
  /** Things are gliding to new places (tidy up, undo). */
  tidying?: boolean;
  onWidth: (width: number) => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const report = useRef(onWidth);
  report.current = onWidth;
  useLayoutEffect(() => {
    const el = ref.current?.parentElement;
    if (!el) return;
    const measure = () => {
      const w = Math.round(el.clientWidth);
      if (w > 0) report.current(w);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return (
    <div
      ref={ref}
      className={"dk-canvas" + (tidying ? " is-tidying" : "")}
      data-desk={desk}
      style={{ minWidth, height }}
    >
      {children}
    </div>
  );
}

/** One thing's place on the desk. */
export function DeskSpotView({
  x,
  y,
  z,
  width,
  dim,
  lifted,
  tilt,
  children,
}: {
  x: number;
  y: number;
  z: number;
  width: number;
  /** A slight lean, in degrees (sticky notes are never quite straight). */
  tilt?: number;
  /** Not what the writer is looking for right now (a kind filter is on). */
  dim?: boolean;
  /** Being carried: drawn faintly where it was, the copy follows the pointer. */
  lifted?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className={"dk-spot" + (dim ? " is-dim" : "") + (lifted ? " is-carried" : "")}
      style={
        {
          left: x,
          top: y,
          width,
          zIndex: 1 + z,
          ...(tilt ? { ["--tilt" as string]: `${tilt}deg` } : {}),
        } as React.CSSProperties
      }
    >
      {children}
    </div>
  );
}
