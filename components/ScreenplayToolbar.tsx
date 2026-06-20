"use client";

import { useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import {
  ELEMENT_CYCLE,
  ELEMENT_LABELS,
  ELEMENT_NUMBER,
  type ElementType,
} from "@/lib/editor/elements";
import type { ExportFormat, ImportFormat } from "@/lib/export";
import type { Prefs } from "@/lib/storage/localStore";

/**
 * The screenplay-specific toolbar groups (element buttons, dual dialogue,
 * export/import, and the navigation + spelling toggles). The universal chrome
 * (back, title, status, account, prefs) lives in EditorChrome; this is rendered
 * as its children for a screenplay project.
 */
export function ScreenplayToolbar({
  editor,
  currentElement,
  prefs,
  mod,
  onExport,
  onImport,
  onScenesClick,
  onFindClick,
  onCastClick,
  onTitlePageClick,
  onToggleSpell,
  onToggleDual,
  dualActive,
  scenesOpen,
  findOpen,
  castOpen,
}: {
  editor: Editor | null;
  currentElement: ElementType;
  prefs: Prefs;
  mod: string;
  onExport: (format: ExportFormat) => void;
  onImport: (format: ImportFormat, file: File) => void;
  onScenesClick: () => void;
  onFindClick: () => void;
  onCastClick: () => void;
  onTitlePageClick: () => void;
  onToggleSpell: () => void;
  onToggleDual: () => void;
  dualActive: boolean;
  scenesOpen: boolean;
  findOpen: boolean;
  castOpen: boolean;
}) {
  const setElement = (type: ElementType) => {
    editor?.chain().focus().setElement(type).run();
  };

  const [openMenu, setOpenMenu] = useState<null | "export" | "import">(null);
  const fountainInputRef = useRef<HTMLInputElement>(null);
  const fdxInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!openMenu) return;
    const onDown = (e: MouseEvent) => {
      if (!(e.target as HTMLElement)?.closest(".tb-menu")) setOpenMenu(null);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [openMenu]);

  return (
    <>
      <div className="toolbar-group toolbar-elements">
        {ELEMENT_CYCLE.map((type) => (
          <button
            key={type}
            type="button"
            className={"tb-btn" + (currentElement === type ? " tb-btn-active" : "")}
            onClick={() => setElement(type)}
            title={`${ELEMENT_LABELS[type]}  (${mod}+${ELEMENT_NUMBER[type]})`}
          >
            {ELEMENT_LABELS[type]}
            <span className="tb-key">{ELEMENT_NUMBER[type]}</span>
          </button>
        ))}
        <button
          type="button"
          className={"tb-btn" + (dualActive ? " tb-btn-active" : "")}
          onClick={onToggleDual}
          title={`Dual dialogue  (${mod}+D)`}
        >
          Dual
        </button>
      </div>

      <div className="toolbar-spacer" />

      <div className="toolbar-group">
        <div className="tb-menu">
          <button
            type="button"
            className={"tb-btn" + (openMenu === "export" ? " tb-btn-active" : "")}
            onClick={() => setOpenMenu((m) => (m === "export" ? null : "export"))}
            title="Export your script"
          >
            Export
          </button>
          {openMenu === "export" && (
            <div className="tb-menu-list">
              <button type="button" className="tb-menu-item" onClick={() => { onExport("pdf"); setOpenMenu(null); }}>
                PDF
              </button>
              <button type="button" className="tb-menu-item" onClick={() => { onExport("fountain"); setOpenMenu(null); }}>
                Fountain
              </button>
            </div>
          )}
        </div>

        <div className="tb-menu">
          <button
            type="button"
            className={"tb-btn" + (openMenu === "import" ? " tb-btn-active" : "")}
            onClick={() => setOpenMenu((m) => (m === "import" ? null : "import"))}
            title="Import a script"
          >
            Import
          </button>
          {openMenu === "import" && (
            <div className="tb-menu-list">
              <button type="button" className="tb-menu-item" onClick={() => { fountainInputRef.current?.click(); setOpenMenu(null); }}>
                Fountain
              </button>
              <button type="button" className="tb-menu-item" onClick={() => { fdxInputRef.current?.click(); setOpenMenu(null); }}>
                FDX
              </button>
            </div>
          )}
        </div>

        <input
          ref={fountainInputRef}
          type="file"
          accept=".fountain,.txt,.spmd"
          className="tb-file-input"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onImport("fountain", f);
            e.target.value = "";
          }}
        />
        <input
          ref={fdxInputRef}
          type="file"
          accept=".fdx,.xml"
          className="tb-file-input"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onImport("fdx", f);
            e.target.value = "";
          }}
        />
      </div>

      <div className="toolbar-group">
        <button type="button" className={"tb-btn" + (scenesOpen ? " tb-btn-active" : "")} onClick={onScenesClick} title="Scene navigator">
          Scenes
        </button>
        <button type="button" className={"tb-btn" + (findOpen ? " tb-btn-active" : "")} onClick={onFindClick} title="Find and replace">
          Find
        </button>
        <button type="button" className={"tb-btn" + (castOpen ? " tb-btn-active" : "")} onClick={onCastClick} title="Cast list">
          Cast
        </button>
        <button type="button" className="tb-btn" onClick={onTitlePageClick} title="Edit the title page">
          Title Page
        </button>
        <button
          type="button"
          className={"tb-btn" + (prefs.spellCheck ? " tb-btn-active" : "")}
          onClick={onToggleSpell}
          title="Spell check"
        >
          Spelling
        </button>
      </div>
    </>
  );
}
