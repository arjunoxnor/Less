"use client";

import type { Editor } from "@tiptap/react";
import {
  ELEMENT_CYCLE,
  ELEMENT_LABELS,
  ELEMENT_NUMBER,
  type ElementType,
} from "@/lib/editor/elements";
import type { Prefs } from "@/lib/storage/localStore";
import { modKeyLabel } from "@/lib/platform";

/**
 * The top toolbar: element-type buttons (with their Cmd/Ctrl+number hints),
 * the font toggle, dark mode, and the focus-mode toggle.
 *
 * The element buttons both *show* the current element (highlighted) and let a
 * mouse user do everything the keyboard shortcuts do.
 */
export function Toolbar({
  editor,
  currentElement,
  prefs,
  onPrefsChange,
  mod,
}: {
  editor: Editor | null;
  currentElement: ElementType;
  prefs: Prefs;
  onPrefsChange: (next: Partial<Prefs>) => void;
  mod: string;
}) {
  const setElement = (type: ElementType) => {
    editor?.chain().focus().setElement(type).run();
  };

  return (
    <div className="toolbar">
      <div className="toolbar-brand" title="Last Ever Screenwriting Software">
        LESS
      </div>

      <div className="toolbar-group toolbar-elements">
        {ELEMENT_CYCLE.map((type) => (
          <button
            key={type}
            type="button"
            className={
              "tb-btn" + (currentElement === type ? " tb-btn-active" : "")
            }
            onClick={() => setElement(type)}
            title={`${ELEMENT_LABELS[type]}  (${mod}+${ELEMENT_NUMBER[type]})`}
          >
            {ELEMENT_LABELS[type]}
            <span className="tb-key">{ELEMENT_NUMBER[type]}</span>
          </button>
        ))}
      </div>

      <div className="toolbar-spacer" />

      <div className="toolbar-group">
        <select
          className="tb-select"
          value={prefs.font}
          onChange={(e) =>
            onPrefsChange({ font: e.target.value as Prefs["font"] })
          }
          title="Font"
        >
          <option value="courier-prime">Courier Prime</option>
          <option value="courier">Courier</option>
        </select>

        <button
          type="button"
          className="tb-btn"
          onClick={() =>
            onPrefsChange({ theme: prefs.theme === "dark" ? "light" : "dark" })
          }
          title="Toggle dark mode"
        >
          {prefs.theme === "dark" ? "Light" : "Dark"}
        </button>

        <button
          type="button"
          className={"tb-btn" + (prefs.focusMode ? " tb-btn-active" : "")}
          onClick={() => onPrefsChange({ focusMode: !prefs.focusMode })}
          title="Focus mode — hide everything but the page"
        >
          Focus
        </button>
      </div>
    </div>
  );
}

/** Convenience used by the page to show the right modifier symbol. */
export function useModLabel() {
  return modKeyLabel();
}
