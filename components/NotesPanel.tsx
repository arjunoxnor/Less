"use client";

import { useState } from "react";
import type { NoteEntry } from "@/types/screenplay";

/**
 * Script notes: jot a note on the line your caret is in, see them all in one
 * place, jump to any of them, or remove them. Notes live on the line as a sparse
 * attribute, so they sync and never touch the screenplay text or export.
 */
export function NotesPanel({
  notes,
  onJump,
  onAddToCurrent,
  onRemove,
  onClose,
}: {
  notes: NoteEntry[];
  onJump: (pos: number) => void;
  onAddToCurrent: (text: string) => void;
  onRemove: (pos: number) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState("");

  const add = () => {
    const t = draft.trim();
    if (!t) return;
    onAddToCurrent(t);
    setDraft("");
  };

  return (
    <aside className="side-panel notes-panel">
      <div className="side-panel-head">
        <strong>Notes</strong>
        <button type="button" className="side-panel-x" onClick={onClose} title="Close">
          Close
        </button>
      </div>

      <div className="notes-add">
        <textarea
          className="notes-input"
          placeholder="Note for the line your cursor is in..."
          value={draft}
          rows={2}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              add();
            }
          }}
        />
        <button type="button" className="tb-btn notes-add-btn" onClick={add}>
          Add to current line
        </button>
      </div>

      {notes.length === 0 ? (
        <div className="side-panel-empty">
          No notes yet. Put your cursor in a line and add one above.
        </div>
      ) : (
        <>
          <div className="side-panel-count">
            {notes.length === 1 ? "1 note" : `${notes.length} notes`}
          </div>
          <ul className="side-panel-list">
            {notes.map((n) => (
              <li key={n.pos} className="note-item">
                <button
                  type="button"
                  className="note-body"
                  onClick={() => onJump(n.pos)}
                  title="Jump to this line"
                >
                  <span className="note-text">{n.note}</span>
                  <span className="note-line">{n.lineText || "(empty line)"}</span>
                </button>
                <button
                  type="button"
                  className="note-remove"
                  onClick={() => onRemove(n.pos)}
                  title="Remove this note"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </aside>
  );
}
