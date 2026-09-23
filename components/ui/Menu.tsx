"use client";

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { restoreFocus } from "@/lib/restoreFocus";

/**
 * Anchored popover menu (Superaudit 2, Part 2B.5): the base the Phase 2
 * overflow menu builds on. Positions itself against an anchor rect on a
 * preferred side, clamps to the viewport, and speaks full keyboard: ArrowUp
 * and ArrowDown cycle, Enter activates, Esc closes and restores focus,
 * clicking outside closes. Items can be plain actions, checkbox toggles,
 * radio rows, dividers, or danger-styled actions.
 */

export type MenuItem =
  | {
      kind?: "item";
      label: string;
      onSelect: () => void;
      danger?: boolean;
      disabled?: boolean;
      /** Right-aligned muted hint, e.g. a keyboard shortcut. */
      hint?: string;
    }
  | {
      kind: "checkbox";
      label: string;
      checked: boolean;
      onToggle: () => void;
      hint?: string;
    }
  | {
      kind: "radio";
      label: string;
      checked: boolean;
      onSelect: () => void;
      /** Rows sharing a group name announce as one radio set. */
      group?: string;
      hint?: string;
    }
  | { kind: "divider" };

type Side = "bottom" | "top";

const GAP = 4;
const EDGE = 8;

export function Menu({
  anchor,
  side = "bottom",
  items,
  onClose,
  ariaLabel,
}: {
  /** Where to hang the menu: the trigger's bounding rect. */
  anchor: { left: number; top: number; bottom: number; right?: number };
  side?: Side;
  items: MenuItem[];
  onClose: () => void;
  ariaLabel?: string;
}) {
  const id = useId();
  const menuRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const selectable = useMemo(
    () =>
      items
        .map((it, i) => ({ it, i }))
        .filter(({ it }) => it.kind !== "divider" && !("disabled" in it && it.disabled)),
    [items]
  );
  const [active, setActive] = useState(() => (selectable.length ? selectable[0].i : -1));

  useEffect(() => {
    if (selectable.some(({ i }) => i === active)) return;
    setActive(selectable.length ? selectable[0].i : -1);
  }, [active, selectable]);

  // Position after first paint (needs the rendered size), clamped to the
  // viewport; flips to the other side when the preferred one cannot fit.
  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    let top =
      side === "bottom" ? anchor.bottom + GAP : anchor.top - h - GAP;
    if (side === "bottom" && top + h > window.innerHeight - EDGE) {
      top = anchor.top - h - GAP;
    } else if (side === "top" && top < EDGE) {
      top = anchor.bottom + GAP;
    }
    top = Math.max(EDGE, Math.min(top, window.innerHeight - h - EDGE));
    const left = Math.max(EDGE, Math.min(anchor.left, window.innerWidth - w - EDGE));
    setPos({ left, top });
  }, [anchor, side]);

  // Take focus so arrow keys land here, and give it back on close. An item
  // that moved focus on purpose keeps it: choosing a line type focuses the
  // script, and handing focus back to the menu's button then sent the
  // writer's next keystrokes to that button instead of the page.
  useLayoutEffect(() => {
    openerRef.current = document.activeElement as HTMLElement | null;
    const menu = menuRef.current;
    menu?.focus();
    return () => {
      const active = document.activeElement;
      const focusLeftMenu =
        active && active !== document.body && !(menu && menu.contains(active));
      if (focusLeftMenu) return;
      if (openerRef.current?.isConnected) restoreFocus(openerRef.current);
    };
  }, []);

  // Click-outside closes.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        !menuRef.current?.contains(target) &&
        !openerRef.current?.contains(target)
      ) {
        onClose();
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [onClose]);

  const activate = (i: number) => {
    const it = items[i];
    if (!it || it.kind === "divider") return;
    if ("disabled" in it && it.disabled) return;
    if (it.kind === "checkbox") {
      it.onToggle();
      return; // toggles keep the menu open so several can be flipped
    }
    it.onSelect();
    onClose();
  };

  const move = (dir: 1 | -1) => {
    if (selectable.length === 0) return;
    const cur = selectable.findIndex(({ i }) => i === active);
    const next = selectable[(cur + dir + selectable.length) % selectable.length];
    setActive(next.i);
    const nextElement = menuRef.current?.querySelector<HTMLElement>(
      `[data-idx="${next.i}"]`
    );
    nextElement?.scrollIntoView?.({ block: "nearest" });
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      move(1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      move(-1);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      activate(active);
    }
  };

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      ref={menuRef}
      className="ui-menu"
      role="menu"
      aria-label={ariaLabel}
      aria-activedescendant={active >= 0 ? `${id}-item-${active}` : undefined}
      tabIndex={-1}
      style={pos ? { left: pos.left, top: pos.top } : { left: -9999, top: -9999 }}
      onKeyDown={onKeyDown}
    >
      {items.map((it, i) => {
        if (it.kind === "divider") {
          return <div key={"d" + i} className="ui-menu-divider" role="separator" />;
        }
        const checked =
          it.kind === "checkbox" || it.kind === "radio" ? it.checked : undefined;
        const disabled = "disabled" in it && it.disabled;
        return (
          <button
            key={it.label + i}
            id={`${id}-item-${i}`}
            type="button"
            data-idx={i}
            className={
              "ui-menu-item" +
              (i === active ? " ui-menu-item-active" : "") +
              ("danger" in it && it.danger ? " ui-menu-item-danger" : "")
            }
            role={
              it.kind === "checkbox"
                ? "menuitemcheckbox"
                : it.kind === "radio"
                  ? "menuitemradio"
                  : "menuitem"
            }
            aria-checked={checked}
            aria-disabled={disabled || undefined}
            tabIndex={-1}
            onMouseEnter={() => !disabled && setActive(i)}
            onClick={() => activate(i)}
          >
            <span className="ui-menu-mark" aria-hidden="true">
              {checked ? (it.kind === "radio" ? "•" : "✓") : ""}
            </span>
            {it.label}
            {"hint" in it && it.hint && (
              <span className="ui-menu-hint">{it.hint}</span>
            )}
          </button>
        );
      })}
    </div>,
    document.body
  );
}
