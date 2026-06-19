"use client";

import type { CastEntry } from "@/types/screenplay";

/**
 * The cast list: every speaking character with line and scene counts, ordered
 * by how much they speak. Click a name to jump to their first cue; Rename opens
 * find and replace in rename mode, pre-filled.
 */
export function CastListPanel({
  cast,
  onJump,
  onRename,
  onClose,
}: {
  cast: CastEntry[];
  onJump: (pos: number) => void;
  onRename: (name: string) => void;
  onClose: () => void;
}) {
  return (
    <aside className="side-panel cast-panel">
      <div className="side-panel-head">
        <strong>Cast</strong>
        <button type="button" className="side-panel-x" onClick={onClose} title="Close">
          Close
        </button>
      </div>

      {cast.length === 0 ? (
        <div className="side-panel-empty">
          No speaking characters yet. Add a character cue to build your cast.
        </div>
      ) : (
        <>
          <div className="side-panel-count">
            {cast.length === 1 ? "1 speaking character" : `${cast.length} speaking characters`}
          </div>
          <ul className="side-panel-list">
            {cast.map((c) => (
              <li key={c.name} className="cast-item">
                <button
                  type="button"
                  className="cast-name"
                  title={c.name}
                  onClick={() => onJump(c.pos)}
                >
                  {c.name}
                </button>
                <span className="cast-metrics">
                  {c.lines === 1 ? "1 line" : `${c.lines} lines`},{" "}
                  {c.scenes === 1 ? "1 scene" : `${c.scenes} scenes`}
                </span>
                <button
                  type="button"
                  className="cast-rename"
                  title="Rename this character"
                  onClick={() => onRename(c.name)}
                >
                  Rename
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </aside>
  );
}
