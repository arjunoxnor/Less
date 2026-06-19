"use client";

import type { AcItem } from "@/lib/editor/autocomplete";

/**
 * The caret-anchored suggestion dropdown. Purely presentational: the plugin
 * decides what to show and where; this renders it. onMouseDown is preventDefault
 * so clicking a row never blurs the editor or moves the selection.
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
  return (
    <div
      className="ac-menu"
      style={{ position: "fixed", left: coords.left, top: coords.bottom + 2 }}
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
