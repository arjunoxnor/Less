"use client";

import { useEffect, useReducer, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import {
  currentBoard,
  currentPalette,
  putPalette,
  setBoardColumns,
  swatchesFromText,
  swatchesToText,
  type Swatch,
} from "@/lib/editor/boardNodes";
import { Modal } from "./ui/Modal";

/**
 * A board's own controls, beside the text formatting row: add images, change
 * how many columns the grid under the caret has, and add or edit a palette.
 * Dropping or pasting images onto the page does the same as the Images button.
 */

const STARTER_PALETTE: Swatch[] = [
  { hex: "#17171a", name: "Ink" },
  { hex: "#f6f6f4", name: "Paper" },
  { hex: "#c8553d", name: "Accent" },
];

export function BoardTools({
  editor,
  onAddImages,
}: {
  editor: Editor | null;
  onAddImages: (files: File[]) => void;
}) {
  const [, force] = useReducer((x: number) => x + 1, 0);
  const fileRef = useRef<HTMLInputElement>(null);
  const [paletteDraft, setPaletteDraft] = useState<string | null>(null);

  // Columns and "Edit palette" depend on where the caret is.
  useEffect(() => {
    if (!editor) return;
    editor.on("selectionUpdate", force);
    editor.on("transaction", force);
    return () => {
      editor.off("selectionUpdate", force);
      editor.off("transaction", force);
    };
  }, [editor]);

  if (!editor) return null;
  const board = currentBoard(editor);
  const palette = currentPalette(editor);
  const draftColors = paletteDraft === null ? [] : swatchesFromText(paletteDraft);

  return (
    <div className="toolbar-group brd-tools">
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        multiple
        hidden
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = "";
          if (files.length) onAddImages(files);
        }}
      />
      <button
        type="button"
        className="tb-btn"
        title="Add images (or drop them on the page)"
        onClick={() => fileRef.current?.click()}
      >
        Images
      </button>
      <button
        type="button"
        className="tb-btn"
        title="Fewer columns in this grid"
        aria-label="Fewer columns in this grid"
        disabled={!board || board.columns <= 2}
        onClick={() => board && setBoardColumns(editor, board.columns - 1)}
      >
        −
      </button>
      <span className="brd-cols" aria-live="polite">
        {board ? `${board.columns} across` : "Grid"}
      </span>
      <button
        type="button"
        className="tb-btn"
        title="More columns in this grid"
        aria-label="More columns in this grid"
        disabled={!board || board.columns >= 6}
        onClick={() => board && setBoardColumns(editor, board.columns + 1)}
      >
        +
      </button>
      <button
        type="button"
        className="tb-btn"
        title={palette ? "Edit this palette" : "Add a palette"}
        onClick={() => setPaletteDraft(swatchesToText(palette ? palette.colors : STARTER_PALETTE))}
      >
        {palette ? "Edit palette" : "Palette"}
      </button>

      {paletteDraft !== null && (
        <Modal
          title={palette ? "Edit palette" : "Add a palette"}
          onClose={() => setPaletteDraft(null)}
          actions={[
            { label: "Cancel", onClick: () => setPaletteDraft(null) },
            {
              label: palette ? "Save palette" : "Add palette",
              variant: "solid",
              onClick: () => {
                if (draftColors.length) putPalette(editor, draftColors);
                setPaletteDraft(null);
              },
            },
          ]}
        >
          <p className="ui-modal-note">One color per line: a hex code, then its name.</p>
          <textarea
            className="brd-palette-input"
            value={paletteDraft}
            onChange={(e) => setPaletteDraft(e.target.value)}
            rows={8}
            spellCheck={false}
            aria-label="Palette colors"
          />
          <div className="brd-palette brd-palette-preview" aria-hidden="true">
            {draftColors.map((c, i) => (
              <div className="brd-swatch" key={`${c.hex}-${i}`}>
                <span className="brd-chip" style={{ background: c.hex }} />
                <span className="brd-swatch-name">{c.name || c.hex}</span>
              </div>
            ))}
          </div>
        </Modal>
      )}
    </div>
  );
}
