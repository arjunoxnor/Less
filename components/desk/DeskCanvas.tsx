"use client";

import { useLayoutEffect, useRef, type ReactNode } from "react";
import { settle } from "./settle";

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

/** Something just happened to a thing on the desk, so it moves into place. */
export type DeskMotion = { kind: "land" | "unfold"; n: number };

/** One thing's place on the desk. */
export function DeskSpotView({
  spotKey,
  x,
  y,
  z,
  width,
  dim,
  lifted,
  tilt,
  motion,
  children,
}: {
  /** Its key in the desk layout ("d:", "s:" or "f:" + id). */
  spotKey: string;
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
  /** A new one each time it is put down here, or opened or folded shut. */
  motion?: DeskMotion;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    // Only just now: coming back to the desk later never replays it.
    if (!motion || !el || Date.now() - motion.n > 800) return;
    if (motion.kind === "land") {
      // Carried, it leaned and lifted a little; let go, it settles flat
      // where the copy was, instead of snapping.
      settle([el], [{ transform: "rotate(-1.4deg) scale(1.025)" }, { transform: "none" }], { duration: 220 });
    } else {
      // A folder opening into a column (or folding shut) unfolds from its
      // corner instead of swapping in.
      settle(
        [el],
        [
          { opacity: 0.35, transform: "scale(0.94)", transformOrigin: "0 0" },
          { opacity: 1, transform: "none", transformOrigin: "0 0" },
        ],
        { duration: 240 }
      );
    }
  }, [motion]);
  return (
    <div
      ref={ref}
      data-spot={spotKey}
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
