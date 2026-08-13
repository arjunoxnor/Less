"use client";

import { memo, useEffect, useLayoutEffect, useRef, useState } from "react";
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
export const SpellMenu = memo(function SpellMenu({
  state,
  view,
  onClose,
}: {
  state: SpellState;
  view: EditorView;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const targetSnapshot = useRef({ state, doc: view.state.doc });
  if (targetSnapshot.current.state !== state) {
    targetSnapshot.current = { state, doc: view.state.doc };
  }
  const [active, setActive] = useState(0);
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
    top = Math.max(8, top);
    const left = Math.max(
      8,
      Math.min(state.coords.left, window.innerWidth - width - 8)
    );
    setPos({ left, top });
  }, [state.coords, state.suggestions]);

  useLayoutEffect(() => {
    ref.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')[active]?.focus();
  }, [active, state.suggestions]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        // A palette or modal above this popover owns the first Escape.
        if (document.querySelector(".cmd-backdrop, .ui-modal-scrim, .modal-backdrop")) {
          return;
        }
        e.preventDefault();
        e.stopImmediatePropagation();
        view.focus();
        onClose();
      }
    };
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    window.addEventListener("keydown", onKey, true);
    document.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      document.removeEventListener("mousedown", onDown);
    };
  }, [onClose, view]);

  const targetStillMatches = () => {
    try {
      return (
        view.state.doc === targetSnapshot.current.doc &&
        view.state.doc.textBetween(state.from, state.to) === state.word
      );
    } catch {
      return false;
    }
  };

  const pick = (suggestion: string) => {
    if (!targetStillMatches()) {
      onClose();
      return;
    }
    acceptSpellFix(view, state.from, state.to, suggestion);
    onClose();
  };

  const runWordAction = (action: "ignore" | "add") => {
    if (!targetStillMatches()) {
      onClose();
      return;
    }
    if (action === "ignore") ignoreWord(view, state.word);
    else addWord(view, state.word);
    onClose();
  };

  const itemCount = state.suggestions.length + 2;

  return (
    <div
      ref={ref}
      className="spell-menu"
      style={{ position: "fixed", left: pos.left, top: pos.top }}
      role="menu"
      aria-label={`Spelling suggestions for ${state.word}`}
      onKeyDown={(event) => {
        if (event.key === "ArrowDown") {
          event.preventDefault();
          setActive((index) => Math.min(index + 1, itemCount - 1));
        } else if (event.key === "ArrowUp") {
          event.preventDefault();
          setActive((index) => Math.max(index - 1, 0));
        } else if (event.key === "Home") {
          event.preventDefault();
          setActive(0);
        } else if (event.key === "End") {
          event.preventDefault();
          setActive(itemCount - 1);
        }
      }}
    >
      {state.suggestions.length === 0 ? (
        <div className="spell-empty" role="presentation">No suggestions</div>
      ) : (
        state.suggestions.map((s, index) => (
          <button
            key={`${s}\u0000${index}`}
            type="button"
            role="menuitem"
            tabIndex={active === index ? 0 : -1}
            className="spell-item"
            onMouseDown={(e) => {
              e.preventDefault();
            }}
            onMouseEnter={() => setActive(index)}
            onClick={() => pick(s)}
          >
            {s}
          </button>
        ))
      )}
      <div className="spell-divider" role="separator" />
      <button
        type="button"
        role="menuitem"
        tabIndex={active === state.suggestions.length ? 0 : -1}
        className="spell-action"
        onMouseDown={(e) => {
          e.preventDefault();
        }}
        onMouseEnter={() => setActive(state.suggestions.length)}
        onClick={() => runWordAction("ignore")}
      >
        Ignore
      </button>
      <button
        type="button"
        role="menuitem"
        tabIndex={active === state.suggestions.length + 1 ? 0 : -1}
        className="spell-action"
        onMouseDown={(e) => {
          e.preventDefault();
        }}
        onMouseEnter={() => setActive(state.suggestions.length + 1)}
        onClick={() => runWordAction("add")}
      >
        Add to dictionary
      </button>
    </div>
  );
}, (previous, next) => previous.state === next.state && previous.view === next.view);
