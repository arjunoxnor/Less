"use client";

import { useEffect, useReducer, useState } from "react";
import type { Editor } from "@tiptap/react";
import { TextSelection } from "@tiptap/pm/state";
import { listComments } from "@/lib/editor/comments";
import { scrollPosToCenter } from "@/lib/editor/findPlugin";

const clip = (s: string, n: number) => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n - 1).trimEnd() + "…" : t;
};

/**
 * Comments in a document: add one to what is selected, see them all, go to
 * one, change it or take it off (the text stays).
 */
export function CommentsPanel({
  editor,
  activeId,
  onClose,
}: {
  editor: Editor | null;
  /** The comment just clicked on the page. */
  activeId: string | null;
  onClose: () => void;
}) {
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);

  useEffect(() => {
    if (!editor) return;
    editor.on("transaction", rerender);
    return () => {
      editor.off("transaction", rerender);
    };
  }, [editor]);

  if (!editor) return null;
  const comments = listComments(editor.state.doc);
  const { from, to, empty } = editor.state.selection;
  const selected = empty ? "" : editor.state.doc.textBetween(from, to, " ", " ").trim();

  const add = () => {
    if (editor.commands.addComment(draft)) setDraft("");
  };
  const go = (pos: number, end: number) => {
    const view = editor.view;
    view.dispatch(
      view.state.tr.setSelection(TextSelection.create(view.state.doc, pos, end)).setMeta("addToHistory", false)
    );
    view.focus();
    scrollPosToCenter(view, pos);
  };

  return (
    <aside className="side-panel notes-panel">
      <div className="side-panel-head">
        <strong>Comments</strong>
        <button type="button" className="side-panel-x" onClick={onClose} title="Close">
          Close
        </button>
      </div>

      <div className="notes-add">
        <div className="comment-quote">{selected ? clip(selected, 90) : "Select some words on the page to comment on them."}</div>
        <textarea
          className="notes-input"
          placeholder="Comment"
          aria-label="Comment"
          value={draft}
          rows={2}
          disabled={!selected}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              add();
            }
          }}
        />
        <button type="button" className="tb-btn notes-add-btn" onClick={add} disabled={!selected || !draft.trim()}>
          Add comment
        </button>
      </div>

      {comments.length === 0 ? (
        <div className="side-panel-empty">No comments yet.</div>
      ) : (
        <>
          <div className="side-panel-count">{comments.length === 1 ? "1 comment" : `${comments.length} comments`}</div>
          <ul className="side-panel-list">
            {comments.map((c) => (
              <li key={c.id} className={"note-item" + (c.id === activeId ? " comment-active" : "")}>
                {editing?.id === c.id ? (
                  <div className="comment-edit">
                    <textarea
                      className="notes-input"
                      aria-label="Change comment"
                      autoFocus
                      rows={3}
                      value={editing.text}
                      onChange={(e) => setEditing({ id: c.id, text: e.target.value })}
                    />
                    <div className="comment-edit-row">
                      <button type="button" className="tb-btn" onClick={() => setEditing(null)}>
                        Cancel
                      </button>
                      <button
                        type="button"
                        className="tb-btn tb-btn-active"
                        disabled={!editing.text.trim()}
                        onClick={() => {
                          editor.commands.updateComment(c.id, editing.text);
                          setEditing(null);
                        }}
                      >
                        Save
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <button type="button" className="note-body" onClick={() => go(c.from, c.to)} title="Go to these words">
                      <span className="note-text">{c.text}</span>
                      <span className="note-line">{clip(c.quote, 70)}</span>
                    </button>
                    <button
                      type="button"
                      className="note-remove"
                      title="Change this comment"
                      onClick={() => setEditing({ id: c.id, text: c.text })}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="note-remove"
                      title="Take this comment off (the text stays)"
                      onClick={() => editor.commands.removeComment(c.id)}
                    >
                      Remove
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </aside>
  );
}
