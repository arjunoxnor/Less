"use client";

import { memo, useEffect, useRef, useState } from "react";
import type { CastEntry, LocationEntry } from "@/types/screenplay";

/**
 * Cast and Locations management. Every speaking character and every location,
 * with usage counts, a click to jump, and an inline rename that updates the
 * whole script in one undo step. This is the "manage my characters and scene
 * headings" surface: a typo is fixed once, everywhere, and stops polluting
 * autocomplete. Arc auto-learns names but gives no clean way to clean them up.
 */
export const CastListPanel = memo(function CastListPanel({
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
  const panelRef = useRef<HTMLElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const cancellingRef = useRef(false);
  const focusAfterEdit = useRef<{
    kind: "char" | "loc";
    from: string;
    to: string;
  } | null>(null);
  const latestCast = useRef(cast);
  const latestLocations = useRef(locations);
  latestCast.current = cast;
  latestLocations.current = locations;

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  useEffect(() => {
    if (!editing) return;
    const split = editing.indexOf(":");
    const kind = editing.slice(0, split);
    const name = editing.slice(split + 1);
    const stillExists =
      kind === "char"
        ? cast.some((entry) => entry.name === name)
        : locations.some((entry) => entry.name === name);
    if (!stillExists) {
      focusAfterEdit.current = {
        kind: kind === "char" ? "char" : "loc",
        from: name,
        to: name,
      };
      setEditing(null);
    }
  }, [cast, editing, locations]);

  useEffect(() => {
    if (editing || !focusAfterEdit.current || document.activeElement !== document.body) {
      return;
    }
    const pending = focusAfterEdit.current;
    const rows = Array.from(
      panelRef.current?.querySelectorAll<HTMLElement>("[data-cast-kind]") ?? []
    );
    const target =
      rows.find(
        (row) =>
          row.dataset.castKind === pending.kind &&
          row.dataset.castName === pending.to
      ) ??
      rows.find(
        (row) =>
          row.dataset.castKind === pending.kind &&
          row.dataset.castName === pending.from
      );
    target?.querySelector<HTMLButtonElement>("button")?.focus();
    if (!target) panelRef.current?.querySelector<HTMLButtonElement>(".side-panel-x")?.focus();
    if (!target || target.dataset.castName === pending.to) {
      focusAfterEdit.current = null;
    }
  }, [cast, editing, locations]);

  const begin = (key: string, name: string) => {
    cancellingRef.current = false;
    setDraft(name);
    setEditing(key);
  };
  const commit = (kind: "char" | "loc", from: string) => {
    if (cancellingRef.current) {
      cancellingRef.current = false;
      setEditing(null);
      return;
    }
    const to = draft.trim();
    const sourceStillExists =
      kind === "char"
        ? latestCast.current.some((entry) => entry.name === from)
        : latestLocations.current.some((entry) => entry.name === from);
    const willRename =
      sourceStillExists && !!to && to.toUpperCase() !== from.toUpperCase();
    if (willRename) {
      if (kind === "char") onRenameCharacter(from, to);
      else onRenameLocation(from, to);
    }
    focusAfterEdit.current = {
      kind,
      from,
      to: willRename ? to.toUpperCase() : from,
    };
    setEditing(null);
  };

  const cancel = (kind: "char" | "loc", name: string) => {
    cancellingRef.current = true;
    focusAfterEdit.current = { kind, from: name, to: name };
    setEditing(null);
  };

  const renameRow = (kind: "char" | "loc", name: string) => {
    const key = `${kind}:${name}`;
    if (editing === key) {
      return (
        <input
          ref={inputRef}
          className="manage-rename"
          aria-label={`Rename ${name}`}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => commit(kind, name)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit(kind, name);
            } else if (e.key === "Escape") {
              e.preventDefault();
              cancel(kind, name);
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
                ? latestCast.current.find((c) => c.name === name)?.pos
                : latestLocations.current.find((l) => l.name === name)?.pos;
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
    <aside className="side-panel cast-panel" ref={panelRef}>
      <div className="side-panel-head">
        <strong>Cast and locations</strong>
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
            <li
              key={c.name}
              className="cast-item"
              data-cast-kind="char"
              data-cast-name={c.name}
            >
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
            <li
              key={l.name}
              className="cast-item"
              data-cast-kind="loc"
              data-cast-name={l.name}
            >
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
}, (previous, next) =>
  previous.cast === next.cast &&
  previous.locations === next.locations &&
  previous.onJump === next.onJump &&
  previous.onRenameCharacter === next.onRenameCharacter &&
  previous.onRenameLocation === next.onRenameLocation
);
