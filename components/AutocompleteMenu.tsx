"use client";

import { memo, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { AcItem } from "@/lib/editor/autocomplete";
import { positionAutocompleteMenu } from "@/lib/editor/autocompletePosition";

/**
 * The caret-anchored suggestion dropdown. Purely presentational: the plugin
 * decides what to show and where; this renders it. onMouseDown is preventDefault
 * so clicking a row never blurs the editor or moves the selection.
 *
 * The menu measures itself after render and clamps to the viewport: near the
 * bottom of the window it flips above the caret instead of being cut off, and
 * it never runs past the right edge.
 */
export const AutocompleteMenu = memo(function AutocompleteMenu({
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
  const latestItems = useRef(items);
  const latestOnPick = useRef(onPick);
  const listId = useId();
  const [pos, setPos] = useState({ left: coords.left, top: coords.bottom + 2 });
  latestItems.current = items;
  latestOnPick.current = onPick;
  const safeActive = items.length
    ? Math.min(Math.max(active, 0), items.length - 1)
    : 0;

  const pick = (snapshot: AcItem) => {
    const index = latestItems.current.findIndex(
      (item) =>
        item.text === snapshot.text &&
        item.hint === snapshot.hint &&
        item.retypeTo === snapshot.retypeTo
    );
    if (index >= 0) latestOnPick.current(index);
  };

  // Measure after render (the item list decides the height), then position:
  // below the caret when it fits, above it when the viewport bottom is near.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { height, width } = el.getBoundingClientRect();
    setPos(
      positionAutocompleteMenu(
        coords,
        { width, height },
        { width: window.innerWidth, height: window.innerHeight }
      )
    );
  }, [coords, items]);

  // Keep the keyboard-selected row visible inside the scrolling list (the
  // command palette does the same).
  useEffect(() => {
    ref.current
      ?.querySelector(".ac-item-active")
      ?.scrollIntoView({ block: "nearest" });
  }, [safeActive, items]);

  return (
    <div
      ref={ref}
      className="ac-menu"
      style={{ position: "fixed", left: pos.left, top: pos.top }}
      role="listbox"
      id={listId}
      aria-label="Suggestions"
      aria-activedescendant={items.length ? `${listId}-option-${safeActive}` : undefined}
    >
      {items.map((item, i) => (
        <button
          key={`${item.text}\u0000${item.hint}\u0000${item.retypeTo ?? ""}\u0000${i}`}
          id={`${listId}-option-${i}`}
          type="button"
          role="option"
          tabIndex={-1}
          aria-selected={i === safeActive}
          className={"ac-item" + (i === safeActive ? " ac-item-active" : "")}
          onMouseDown={(e) => {
            e.preventDefault();
          }}
          onClick={() => pick(item)}
        >
          <span className="ac-text">{item.text}</span>
          {item.hint && <span className="ac-hint">{item.hint}</span>}
        </button>
      ))}
    </div>
  );
}, (previous, next) =>
  previous.items === next.items &&
  previous.active === next.active &&
  previous.coords.left === next.coords.left &&
  previous.coords.top === next.coords.top &&
  previous.coords.bottom === next.coords.bottom
);
