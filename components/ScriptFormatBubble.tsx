"use client";

import { useEffect, useReducer, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Editor } from "@tiptap/react";
import { NodeSelection } from "@tiptap/pm/state";
import { SCRIPT_HIGHLIGHTS } from "@/lib/editor/scriptMarks";
import { modKeyLabel } from "@/lib/platform";

/**
 * Bold, italic, underline and highlight for a script, offered only when text
 * is selected: a small bar above the selection, so the page itself keeps no
 * formatting toolbar. The keys work without it (Ctrl/Cmd+B, I, U and
 * Ctrl/Cmd+Shift+H).
 */
export function ScriptFormatBubble({ editor }: { editor: Editor | null }) {
  const [spot, setSpot] = useState<{ left: number; top: number } | null>(null);
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const selecting = useRef(false);

  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    const view = editor.view;
    const update = () => {
      if (editor.isDestroyed) return;
      const sel = editor.state.selection;
      if (sel.empty || sel instanceof NodeSelection || selecting.current || !view.hasFocus()) {
        setSpot((s) => (s ? null : s));
        return;
      }
      try {
        const a = view.coordsAtPos(sel.from);
        const b = view.coordsAtPos(sel.to, -1);
        const box = view.dom.closest(".page-scroll")?.getBoundingClientRect();
        const oneRow = Math.abs(a.top - b.top) < 4;
        let left = oneRow ? (a.left + b.left) / 2 : a.left + 60;
        let top = Math.min(a.top, b.top);
        // A selection that starts above the view: the bar waits at its top.
        if (box) {
          if (top < box.top + 44) top = Math.max(box.top + 44, Math.min(a.bottom, b.bottom) + 44);
          if (top > box.bottom) return setSpot(null);
        }
        left = Math.max(120, Math.min(window.innerWidth - 120, left));
        setSpot((s) => (s && s.left === left && s.top === top ? s : { left, top }));
        rerender();
      } catch {
        setSpot(null);
      }
    };
    // While the mouse is still dragging out a selection the bar stays away.
    const down = () => {
      selecting.current = true;
      setSpot(null);
    };
    const up = () => {
      if (!selecting.current) return;
      selecting.current = false;
      setTimeout(update, 0);
    };
    editor.on("selectionUpdate", update);
    editor.on("transaction", update);
    editor.on("blur", update);
    view.dom.addEventListener("pointerdown", down);
    window.addEventListener("pointerup", up);
    document.addEventListener("scroll", update, { capture: true, passive: true });
    return () => {
      editor.off("selectionUpdate", update);
      editor.off("transaction", update);
      editor.off("blur", update);
      view.dom.removeEventListener("pointerdown", down);
      window.removeEventListener("pointerup", up);
      document.removeEventListener("scroll", update, { capture: true });
    };
  }, [editor]);

  if (!editor || !spot) return null;
  const mod = modKeyLabel();
  const run = (fn: () => void) => (e: React.MouseEvent) => {
    e.preventDefault();
    fn();
  };
  const btn = (label: React.ReactNode, active: boolean, title: string, fn: () => void) => (
    <button
      type="button"
      className="fmt-btn"
      aria-pressed={active}
      title={title}
      aria-label={title}
      onMouseDown={(e) => e.preventDefault()}
      onClick={run(fn)}
    >
      {label}
    </button>
  );
  const chain = () => editor.chain().focus();
  const anyMark = ["bold", "italic", "underline", "highlight"].some((m) => editor.isActive(m));

  return createPortal(
    <div className="fmt-bubble" role="toolbar" aria-label="Formatting" style={{ left: spot.left, top: spot.top }}>
      {btn(<strong>B</strong>, editor.isActive("bold"), `Bold (${mod}+B)`, () => chain().toggleBold().run())}
      {btn(<em>I</em>, editor.isActive("italic"), `Italic (${mod}+I)`, () => chain().toggleItalic().run())}
      {btn(<span className="fmt-u">U</span>, editor.isActive("underline"), `Underline (${mod}+U)`, () =>
        chain().toggleUnderline().run()
      )}
      <span className="fmt-sep" aria-hidden="true" />
      {SCRIPT_HIGHLIGHTS.map((h, i) => {
        const on = editor.isActive("highlight", { color: h.value });
        return (
          <button
            key={h.value}
            type="button"
            className="fmt-swatch"
            style={{ background: h.value }}
            aria-pressed={on}
            title={`${h.label} highlight${i === 0 ? ` (${mod}+Shift+H)` : ""}`}
            aria-label={`${h.label} highlight`}
            onMouseDown={(e) => e.preventDefault()}
            onClick={run(() =>
              on ? chain().unsetHighlight().run() : chain().setHighlight({ color: h.value }).run()
            )}
          />
        );
      })}
      {anyMark && (
        <>
          <span className="fmt-sep" aria-hidden="true" />
          {btn(<span className="fmt-clear">Clear</span>, false, "Clear formatting", () =>
            chain().unsetBold().unsetItalic().unsetUnderline().unsetHighlight().run()
          )}
        </>
      )}
    </div>,
    document.body
  );
}
