"use client";

import {
  memo,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

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
export const CommandPalette = memo(function CommandPalette({
  commands,
  onClose,
}: {
  commands: PaletteCommand[];
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const [activeId, setActiveId] = useState<string | null>(commands[0]?.id ?? null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const commandsRef = useRef(commands);
  const closingRef = useRef(false);
  const listId = useId();
  commandsRef.current = commands;

  // Focus the input on mount and restore focus to whatever was focused when the
  // palette opened (usually the editor) once it closes, mirroring Modal.tsx so a
  // keystroke after Escape never falls into document.body.
  useLayoutEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    inputRef.current?.focus();
    return () => {
      // A command can replace the palette with a modal in the same commit. Let
      // that newer surface keep focus; otherwise restore the original trigger.
      queueMicrotask(() => {
        const active = document.activeElement as HTMLElement | null;
        if (active?.isConnected && active !== document.body) return;
        if (opener?.isConnected) opener.focus();
      });
    };
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // A true modal can be stacked over the palette; it owns the first Escape.
      if (document.querySelector(".ui-modal-scrim, .modal-backdrop")) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (!closingRef.current) {
        closingRef.current = true;
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    if (!query) return commands;
    return commands.filter((c) =>
      (c.label + " " + (c.group ?? "")).toLowerCase().includes(query)
    );
  }, [q, commands]);

  const activeIndex = filtered.findIndex((command) => command.id === activeId);
  const safeActiveIndex = activeIndex >= 0 ? activeIndex : 0;
  const activeCommand = filtered[safeActiveIndex];

  useEffect(() => {
    if (filtered.length === 0) {
      if (activeId !== null) setActiveId(null);
    } else if (activeIndex < 0) {
      setActiveId(filtered[0].id);
    }
  }, [activeId, activeIndex, filtered]);

  useEffect(() => {
    listRef.current?.querySelector(".cmd-item-active")?.scrollIntoView({ block: "nearest" });
  }, [activeCommand?.id, filtered]);

  const run = (snapshot: PaletteCommand | undefined) => {
    if (!snapshot || closingRef.current) return;
    // Resolve the command through current props. Label/group are part of the
    // identity check because scene ids are renumbered and can be reused after
    // a deletion; a detached old row must not run the new scene at that id.
    const live = commandsRef.current.find(
      (command) =>
        command.id === snapshot.id &&
        command.label === snapshot.label &&
        command.group === snapshot.group
    );
    if (!live) return;
    closingRef.current = true;
    onClose();
    live.run();
  };

  return (
    <div
      className="cmd-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="cmd-palette"
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
      >
        <input
          ref={inputRef}
          className="cmd-input"
          placeholder="Type a command or search scenes..."
          role="combobox"
          aria-expanded="true"
          aria-haspopup="listbox"
          aria-autocomplete="list"
          aria-controls={listId}
          aria-activedescendant={
            activeCommand ? `${listId}-opt-${safeActiveIndex}` : undefined
          }
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setActiveId(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              if (filtered.length > 0) {
                setActiveId(
                  filtered[Math.min(safeActiveIndex + 1, filtered.length - 1)].id
                );
              }
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              if (filtered.length > 0) {
                setActiveId(filtered[Math.max(safeActiveIndex - 1, 0)].id);
              }
            } else if (e.key === "Home") {
              e.preventDefault();
              if (filtered.length > 0) setActiveId(filtered[0].id);
            } else if (e.key === "End") {
              e.preventDefault();
              if (filtered.length > 0) {
                setActiveId(filtered[filtered.length - 1].id);
              }
            } else if (e.key === "Enter") {
              e.preventDefault();
              run(activeCommand);
            } else if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              if (!closingRef.current) {
                closingRef.current = true;
                onClose();
              }
            } else if (e.key === "Tab") {
              // The input is the only tab stop (options are reached with the
              // arrows), so keep Tab from leaking focus to the chrome behind
              // the still-open palette.
              e.preventDefault();
            }
          }}
        />
        <div
          className="cmd-list"
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label="Commands"
        >
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
                aria-selected={i === safeActiveIndex}
                className={
                  "cmd-item" + (i === safeActiveIndex ? " cmd-item-active" : "")
                }
                onMouseEnter={() => setActiveId(c.id)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  run(c);
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
}, (previous, next) => previous.commands === next.commands);
