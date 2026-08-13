"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";

export interface PaletteCommand {
  id: string;
  label: string;
  group?: string;
  run: () => void;
}

/**
 * A Cmd/Ctrl+K command palette over every editor command, panel, export,
 * toggle, and scene. Type to filter, arrows to move, Enter to run, Escape to
 * close. The fastest way to do anything without hunting the toolbar.
 */
export function CommandPalette({
  commands,
  onClose,
}: {
  commands: PaletteCommand[];
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  // Focus the input on mount and restore focus to whatever was focused when the
  // palette opened (usually the editor) once it closes, mirroring Modal.tsx so a
  // keystroke after Escape never falls into document.body.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    inputRef.current?.focus();
    return () => {
      opener?.focus?.();
    };
  }, []);

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    if (!query) return commands;
    return commands.filter((c) =>
      (c.label + " " + (c.group ?? "")).toLowerCase().includes(query)
    );
  }, [q, commands]);

  useEffect(() => {
    setActive(0);
  }, [q]);

  useEffect(() => {
    listRef.current?.querySelector(".cmd-item-active")?.scrollIntoView({ block: "nearest" });
  }, [active, filtered]);

  const run = (i: number) => {
    const c = filtered[i];
    if (c) {
      onClose();
      c.run();
    }
  };

  return (
    <div
      className="cmd-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="cmd-palette" role="dialog" aria-label="Command palette">
        <input
          ref={inputRef}
          className="cmd-input"
          placeholder="Type a command or search scenes..."
          role="combobox"
          aria-expanded={filtered.length > 0}
          aria-controls={listId}
          aria-activedescendant={
            filtered.length > 0 ? `${listId}-opt-${active}` : undefined
          }
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((a) => Math.min(a + 1, filtered.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => Math.max(a - 1, 0));
            } else if (e.key === "Enter") {
              e.preventDefault();
              run(active);
            } else if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              onClose();
            } else if (e.key === "Tab") {
              // The input is the only tab stop (options are reached with the
              // arrows), so keep Tab from leaking focus to the chrome behind
              // the still-open palette.
              e.preventDefault();
            }
          }}
        />
        <div className="cmd-list" ref={listRef} id={listId} role="listbox">
          {filtered.length === 0 ? (
            <div className="cmd-empty">No matches</div>
          ) : (
            filtered.map((c, i) => (
              <button
                key={c.id}
                id={`${listId}-opt-${i}`}
                type="button"
                role="option"
                tabIndex={-1}
                aria-selected={i === active}
                className={"cmd-item" + (i === active ? " cmd-item-active" : "")}
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  run(i);
                }}
              >
                <span className="cmd-label">{c.label}</span>
                {c.group && <span className="cmd-group">{c.group}</span>}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
