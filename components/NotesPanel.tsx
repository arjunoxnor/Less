"use client";

import { memo, useEffect, useMemo, useRef, useState } from "react";
import type { NoteEntry } from "@/types/screenplay";

/**
 * Script notes: jot a note on the line your caret is in, see them all in one
 * place, jump to any of them, or remove them. Notes live on the line as a sparse
 * attribute, so they sync and never touch the screenplay text or export.
 */
export const NotesPanel = memo(function NotesPanel({
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
  const panelRef = useRef<HTMLElement>(null);
  const latestNotes = useRef(notes);
  const focusedRow = useRef<number | null>(null);
  latestNotes.current = notes;

  const rows = useMemo(() => {
    const seen = new Map<string, number>();
    return notes.map((note) => {
      const fingerprint = `${note.note}\u0000${note.lineText}\u0000${note.element}`;
      const occurrence = seen.get(fingerprint) ?? 0;
      seen.set(fingerprint, occurrence + 1);
      return { note, fingerprint, occurrence, key: `${fingerprint}\u0000${occurrence}` };
    });
  }, [notes]);

  const resolve = (snapshot: NoteEntry, fingerprint: string) => {
    const matches = latestNotes.current.filter(
      (note) => `${note.note}\u0000${note.lineText}\u0000${note.element}` === fingerprint
    );
    // Duplicate identical notes have no persistent identifier. Only reuse an
    // old position for them; otherwise a deleted duplicate could target its
    // neighbour. Unique notes can safely follow edits that shifted their pos.
    if (matches.length === 1) return matches[0];
    return matches.find((note) => note.pos === snapshot.pos);
  };

  useEffect(() => {
    const row = focusedRow.current;
    if (row == null || document.activeElement !== document.body) return;
    const buttons = panelRef.current?.querySelectorAll<HTMLButtonElement>(
      "[data-note-action]"
    );
    if (buttons?.length) buttons[Math.min(row * 2, buttons.length - 1)]?.focus();
    else panelRef.current?.querySelector<HTMLTextAreaElement>(".notes-input")?.focus();
  }, [notes]);

  const add = () => {
    const t = draft.trim();
    if (!t) return;
    onAddToCurrent(t);
    setDraft("");
  };

  return (
    <aside className="side-panel notes-panel" ref={panelRef}>
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
            {rows.map(({ note: n, fingerprint, key }, rowIndex) => (
              <li key={key} className="note-item">
                <button
                  type="button"
                  className="note-body"
                  data-note-action
                  onFocus={() => {
                    focusedRow.current = rowIndex;
                  }}
                  onClick={() => {
                    const live = resolve(n, fingerprint);
                    if (live) onJump(live.pos);
                  }}
                  title="Jump to this line"
                >
                  <span className="note-text">{n.note}</span>
                  <span className="note-line">{n.lineText || "(empty line)"}</span>
                </button>
                <button
                  type="button"
                  className="note-remove"
                  data-note-action
                  onFocus={() => {
                    focusedRow.current = rowIndex;
                  }}
                  onClick={() => {
                    const live = resolve(n, fingerprint);
                    if (live) onRemove(live.pos);
                  }}
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
}, (previous, next) =>
  previous.notes === next.notes &&
  previous.onJump === next.onJump &&
  previous.onAddToCurrent === next.onAddToCurrent &&
  previous.onRemove === next.onRemove
);
