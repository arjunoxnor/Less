"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { AcItem } from "@/lib/editor/autocomplete";

/**
 * The caret-anchored suggestion dropdown. Purely presentational: the plugin
 * decides what to show and where; this renders it. onMouseDown is preventDefault
 * so clicking a row never blurs the editor or moves the selection.
 *
 * The menu measures itself after render and clamps to the viewport: near the
 * bottom of the window it flips above the caret instead of being cut off, and
 * it never runs past the right edge.
 */
export function AutocompleteMenu({
  items,
  active,
  coords,
  onPick,
}: {
  items: AcItem[];
  active: number;
  coords: { left: number; top: number; bottom: number };
  onPick: (index: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: coords.left, top: coords.bottom + 2 });

  // Measure after render (the item list decides the height), then position:
  // below the caret when it fits, above it when the viewport bottom is near.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { height, width } = el.getBoundingClientRect();
    let top = coords.bottom + 2;
    if (coords.bottom + height > window.innerHeight - 8) {
      top = coords.top - height - 2;
    }
    const left = Math.max(8, Math.min(coords.left, window.innerWidth - width - 8));
    setPos({ left, top });
  }, [coords, items]);

  // Keep the keyboard-selected row visible inside the scrolling list (the
  // command palette does the same).
  useEffect(() => {
    ref.current
      ?.querySelector(".ac-item-active")
      ?.scrollIntoView({ block: "nearest" });
  }, [active, items]);

  return (
    <div
      ref={ref}
      className="ac-menu"
      style={{ position: "fixed", left: pos.left, top: pos.top }}
      role="listbox"
    >
      {items.map((item, i) => (
        <button
          key={item.text}
          type="button"
          role="option"
          aria-selected={i === active}
          className={"ac-item" + (i === active ? " ac-item-active" : "")}
          onMouseDown={(e) => {
            e.preventDefault();
            onPick(i);
          }}
        >
          <span className="ac-text">{item.text}</span>
          {item.hint && <span className="ac-hint">{item.hint}</span>}
        </button>
      ))}
    </div>
  );
}
