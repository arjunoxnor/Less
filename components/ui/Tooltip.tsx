"use client";

import {
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactElement,
  type Ref,
} from "react";
import { createPortal } from "react-dom";

/**
 * Small text tooltip on the inverted surface: 200ms show delay, positioned
 * above its trigger (flipping below when there is no room), wired up with
 * aria-describedby. Wrap any single element:
 *
 *   <Tooltip label="Scenes (Cmd+1)"><button .../></Tooltip>
 *
 * Meant for the icon rail and other terse controls in later phases.
 */

const SHOW_DELAY_MS = 200;
const GAP = 6;
const EDGE = 8;

type TriggerProps = {
  ref: Ref<HTMLElement>;
  "aria-describedby"?: string;
  onMouseEnter?: (e: unknown) => void;
  onMouseLeave?: (e: unknown) => void;
  onFocus?: (e: unknown) => void;
  onBlur?: (e: unknown) => void;
};

export function Tooltip({
  label,
  children,
}: {
  label: string;
  children: ReactElement<TriggerProps>;
}) {
  const id = useId();
  const triggerRef = useRef<HTMLElement | null>(null);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  const show = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setOpen(true), SHOW_DELAY_MS);
  }, []);
  const hide = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setOpen(false);
    setPos(null);
  }, []);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    []
  );

  // Position above the trigger once the bubble has a size; flip below if the
  // top edge is out of room, and clamp horizontally.
  useEffect(() => {
    if (!open) return;
    const t = triggerRef.current;
    const b = bubbleRef.current;
    if (!t || !b) return;
    const r = t.getBoundingClientRect();
    const w = b.offsetWidth;
    const h = b.offsetHeight;
    let top = r.top - h - GAP;
    if (top < EDGE) top = r.bottom + GAP;
    const left = Math.max(
      EDGE,
      Math.min(r.left + r.width / 2 - w / 2, window.innerWidth - w - EDGE)
    );
    setPos({ left, top });
  }, [open]);

  if (!isValidElement(children)) return children;

  const child = children as ReactElement<TriggerProps> & {
    props: TriggerProps;
  };

  // In React 19 the ref lives on props (element.ref is a deprecation trap).
  const childRef = (child.props as { ref?: Ref<HTMLElement> }).ref;

  const trigger = cloneElement(child, {
    ref: (node: HTMLElement | null) => {
      triggerRef.current = node;
      const orig = childRef;
      if (typeof orig === "function") orig(node);
      else if (orig && typeof orig === "object") {
        (orig as { current: HTMLElement | null }).current = node;
      }
    },
    "aria-describedby": open ? id : undefined,
    onMouseEnter: (e: unknown) => {
      child.props.onMouseEnter?.(e);
      show();
    },
    onMouseLeave: (e: unknown) => {
      child.props.onMouseLeave?.(e);
      hide();
    },
    onFocus: (e: unknown) => {
      child.props.onFocus?.(e);
      show();
    },
    onBlur: (e: unknown) => {
      child.props.onBlur?.(e);
      hide();
    },
  });

  return (
    <>
      {trigger}
      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={bubbleRef}
            className="ui-tooltip"
            role="tooltip"
            id={id}
            style={pos ? { left: pos.left, top: pos.top } : { left: -9999, top: -9999 }}
          >
            {label}
          </div>,
          document.body
        )}
    </>
  );
}
