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
 *
 * Focus rule, and it is the important one: this popover NEVER takes DOM focus
 * on its own. It opens on a plain left click (or a right click) on an underlined
 * word, so the writer's caret is in the document and has to stay there. If the
 * popover grabbed focus on mount or on hover, the next characters typed would
 * land on a <button> and disappear, and the first Space or Enter would activate
 * whatever item happened to be focused and silently rewrite the clicked word.
 * The roving index below therefore moves focus only in response to a key press
 * that already arrived inside the popover, never from an effect.
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

  /**
   * The document can change underneath an open popover: the writer keeps typing,
   * or a Duet collaborator does. Only the replacement depends on [from,to] still
   * pointing at the word the popover was opened for, so only the replacement is
   * gated. Ignore and Add to dictionary take the word string alone and never
   * touch a position, so they stay live no matter what the document does. (An
   * earlier version also required the doc object to be identity-equal to the one
   * captured at open, which made every control a no-op after a single keystroke
   * from anyone: in a shared session a writer could never add a word.)
   */
  const rangeStillHoldsWord = () => {
    try {
      return view.state.doc.textBetween(state.from, state.to) === state.word;
    } catch {
      return false;
    }
  };

  const pick = (suggestion: string) => {
    if (!rangeStillHoldsWord()) {
      onClose();
      return;
    }
    acceptSpellFix(view, state.from, state.to, suggestion);
    onClose();
  };

  const runWordAction = (action: "ignore" | "add") => {
    if (action === "ignore") ignoreWord(view, state.word);
    else addWord(view, state.word);
    onClose();
  };

  const itemCount = state.suggestions.length + 2;
  // Suggestions can shrink when the popover is reused for another word; keep the
  // roving tab stop inside the list so the menu never becomes unreachable.
  const activeIndex = Math.min(active, itemCount - 1);

  /**
   * Move the roving index. Called only from the container's keydown handler,
   * which cannot fire unless focus is already inside the popover, so this can
   * safely move DOM focus without ever pulling the caret out of the editor.
   */
  const moveTo = (index: number) => {
    const items = ref.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]');
    if (!items || items.length === 0) return;
    const next = Math.max(0, Math.min(index, items.length - 1));
    setActive(next);
    items[next].focus();
  };

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
          moveTo(activeIndex + 1);
        } else if (event.key === "ArrowUp") {
          event.preventDefault();
          moveTo(activeIndex - 1);
        } else if (event.key === "Home") {
          event.preventDefault();
          moveTo(0);
        } else if (event.key === "End") {
          event.preventDefault();
          moveTo(itemCount - 1);
        }
      }}
    >
      {state.suggestions.length === 0 ? (
        <div className="spell-empty" role="presentation">No suggestions</div>
      ) : (
        state.suggestions.map((s, index) => (
          <button
            key={`${index}-${s}`}
            type="button"
            role="menuitem"
            tabIndex={activeIndex === index ? 0 : -1}
            className="spell-item"
            onMouseDown={(e) => {
              e.preventDefault();
            }}
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
        tabIndex={activeIndex === state.suggestions.length ? 0 : -1}
        className="spell-action"
        onMouseDown={(e) => {
          e.preventDefault();
        }}
        onClick={() => runWordAction("ignore")}
      >
        Ignore
      </button>
      <button
        type="button"
        role="menuitem"
        tabIndex={activeIndex === state.suggestions.length + 1 ? 0 : -1}
        className="spell-action"
        onMouseDown={(e) => {
          e.preventDefault();
        }}
        onClick={() => runWordAction("add")}
      >
        Add to dictionary
      </button>
    </div>
  );
}, (previous, next) => previous.state === next.state && previous.view === next.view);
