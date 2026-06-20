"use client";

import { useEffect, useRef } from "react";
import type { EditorView } from "@tiptap/pm/view";
import type { SpellState } from "@/lib/editor/spellcheck";
import { acceptSpellFix, addWord, ignoreWord } from "@/lib/editor/spellcheck";

/**
 * The caret-anchored spelling popover, a sibling of the autocomplete menu. Shows
 * up to six suggestions, then Ignore and Add to dictionary. onMouseDown is
 * preventDefault so a click never blurs the editor. Escape or an outside click
 * closes it.
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
      style={{ position: "fixed", left: state.coords.left, top: state.coords.bottom + 2 }}
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
