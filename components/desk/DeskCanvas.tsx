"use client";

import { createContext, useLayoutEffect, useRef, type ReactNode } from "react";
import { settle } from "./settle";

/**
 * How much the desk on screen is scaled to fit (1 anywhere else), so what is
 * measured on screen (a resize drag, say) turns back into desk units.
 */
export const DeskScale = createContext(1);

/**
 * A project's desk: an open surface where things sit wherever they were put.
 * It is as wide as the pane (or wider, when something was pushed off to the
 * right) and as tall as what is on it, plus room to spare below. It reports
 * the width it has, so things placed for the writer fit across it.
 *
 * data-desk makes the whole surface a place to let go (see useHomeDrag).
 *
 * Laid out for one width and shown at another, it is drawn scaled to fit
 * (CSS zoom): places, sizes and words together, so the arrangement keeps its
 * shape on any screen. data-scale tells the drag code how to turn a point on
 * screen back into a place on the desk.
 */
export function DeskCanvas({
  desk,
  minWidth,
  height,
  scale = 1,
  tidying,
  onWidth,
  children,
}: {
  desk: string;
  /** The rightmost edge of what is on the desk (desk units). */
  minWidth: number;
  height: number;
  /** Drawn this much bigger or smaller than its own units, to fit the screen. */
  scale?: number;
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
    // The window resizing (and the pane, when the sidebar folds) rescales
    // the desk to fit as it happens.
    window.addEventListener("resize", measure);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(el);
    return () => {
      window.removeEventListener("resize", measure);
      observer?.disconnect();
    };
  }, []);
  return (
    <div
      ref={ref}
      className={"dk-canvas" + (tidying ? " is-tidying" : "")}
      data-desk={desk}
      data-scale={scale}
      style={
        {
          minWidth,
          height,
          ...(scale !== 1 ? { zoom: scale } : {}),
          ["--desk-scale" as string]: scale,
        } as React.CSSProperties
      }
    >
      <DeskScale.Provider value={scale}>{children}</DeskScale.Provider>
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
