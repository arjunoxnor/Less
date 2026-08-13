"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { EditorView } from "@tiptap/pm/view";
import type { SpellState } from "@/lib/editor/spellcheck";
import { acceptSpellFix, addWord, ignoreWord } from "@/lib/editor/spellcheck";

/**
 * The caret-anchored spelling popover, a sibling of the autocomplete menu. Shows
 * up to six suggestions, then Ignore and Add to dictionary. onMouseDown is
 * preventDefault so a click never blurs the editor. Escape or an outside click
 * closes it. Like the autocomplete menu, it measures itself and clamps to the
 * viewport (flips above the word near the window bottom).
 */
export function SpellMenu({
  state,
  view,
  onClose,
}: {
  state: SpellState;
  view: EditorView;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({
    left: state.coords.left,
    top: state.coords.bottom + 2,
  });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { height, width } = el.getBoundingClientRect();
    let top = state.coords.bottom + 2;
    if (state.coords.bottom + height > window.innerHeight - 8) {
      top = state.coords.top - height - 2;
    }
    const left = Math.max(
      8,
      Math.min(state.coords.left, window.innerWidth - width - 8)
    );
    setPos({ left, top });
  }, [state.coords, state.suggestions]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("mousedown", onDown);
    };
  }, [onClose]);

  const pick = (suggestion: string) => {
    acceptSpellFix(view, state.from, state.to, suggestion);
    onClose();
  };

  return (
    <div
      ref={ref}
      className="spell-menu"
      style={{ position: "fixed", left: pos.left, top: pos.top }}
      role="listbox"
    >
      {state.suggestions.length === 0 ? (
        <div className="spell-empty">No suggestions</div>
      ) : (
        state.suggestions.map((s) => (
          <button
            key={s}
            type="button"
            role="option"
            aria-selected={false}
            className="spell-item"
            onMouseDown={(e) => {
              e.preventDefault();
              pick(s);
            }}
          >
            {s}
          </button>
        ))
      )}
      <div className="spell-divider" />
      <button
        type="button"
        className="spell-action"
        onMouseDown={(e) => {
          e.preventDefault();
          ignoreWord(view, state.word);
          onClose();
        }}
      >
        Ignore
      </button>
      <button
        type="button"
        className="spell-action"
        onMouseDown={(e) => {
          e.preventDefault();
          addWord(view, state.word);
          onClose();
        }}
      >
        Add to dictionary
      </button>
    </div>
  );
}
