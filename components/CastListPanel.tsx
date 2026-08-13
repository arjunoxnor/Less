"use client";

import { useEffect, useRef, useState } from "react";
import type { CastEntry, LocationEntry } from "@/types/screenplay";

/**
 * Cast and Locations management. Every speaking character and every location,
 * with usage counts, a click to jump, and an inline rename that updates the
 * whole script in one undo step. This is the "manage my characters and scene
 * headings" surface: a typo is fixed once, everywhere, and stops polluting
 * autocomplete. Arc auto-learns names but gives no clean way to clean them up.
 */
export function CastListPanel({
  cast,
  locations,
  onJump,
  onRenameCharacter,
  onRenameLocation,
  onClose,
}: {
  cast: CastEntry[];
  locations: LocationEntry[];
  onJump: (pos: number) => void;
  onRenameCharacter: (from: string, to: string) => void;
  onRenameLocation: (from: string, to: string) => void;
  onClose: () => void;
}) {
  // Which row is being renamed, keyed by "char:NAME" / "loc:NAME".
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const begin = (key: string, name: string) => {
    setDraft(name);
    setEditing(key);
  };
  const commit = (kind: "char" | "loc", from: string) => {
    const to = draft.trim();
    if (to && to.toUpperCase() !== from.toUpperCase()) {
      if (kind === "char") onRenameCharacter(from, to);
      else onRenameLocation(from, to);
    }
    setEditing(null);
  };

  const renameRow = (kind: "char" | "loc", name: string) => {
    const key = `${kind}:${name}`;
    if (editing === key) {
      return (
        <input
          ref={inputRef}
          className="manage-rename"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => commit(kind, name)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit(kind, name);
            } else if (e.key === "Escape") {
              setEditing(null);
            }
          }}
        />
      );
    }
    return (
      <>
        <button
          type="button"
          className="cast-name"
          title={`Jump to ${name}`}
          onClick={() => {
            const pos =
              kind === "char"
                ? cast.find((c) => c.name === name)?.pos
                : locations.find((l) => l.name === name)?.pos;
            if (pos != null) onJump(pos);
          }}
        >
          {name}
        </button>
        <button
          type="button"
          className="cast-rename"
          title="Rename everywhere"
          onClick={() => begin(key, name)}
        >
          Rename
        </button>
      </>
    );
  };

  return (
    <aside className="side-panel cast-panel">
      <div className="side-panel-head">
        <strong>Cast and Locations</strong>
        <button type="button" className="side-panel-x" onClick={onClose} title="Close">
          Close
        </button>
      </div>

      <div className="manage-section-title">Characters</div>
      {cast.length === 0 ? (
        <div className="side-panel-empty">No speaking characters yet.</div>
      ) : (
        <ul className="side-panel-list">
          {cast.map((c) => (
            <li key={c.name} className="cast-item">
              {renameRow("char", c.name)}
              {editing !== `char:${c.name}` && (
                <span className="cast-metrics">
                  {c.lines === 1 ? "1 line" : `${c.lines} lines`},{" "}
                  {c.scenes === 1 ? "1 scene" : `${c.scenes} scenes`}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="manage-section-title">Locations</div>
      {locations.length === 0 ? (
        <div className="side-panel-empty">No locations yet.</div>
      ) : (
        <ul className="side-panel-list">
          {locations.map((l) => (
            <li key={l.name} className="cast-item">
              {renameRow("loc", l.name)}
              {editing !== `loc:${l.name}` && (
                <span className="cast-metrics">
                  {l.scenes === 1 ? "1 scene" : `${l.scenes} scenes`}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
