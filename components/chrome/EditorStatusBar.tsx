"use client";

import { useEffect, useRef, useState } from "react";
import {
  ELEMENT_CYCLE,
  ELEMENT_LABELS,
  ELEMENT_NUMBER,
  type ElementType,
} from "@/lib/editor/elements";
import { Menu, type MenuItem } from "../ui/Menu";
import { ChevronUpIcon } from "./icons";

/**
 * The 26px status bar (Superaudit 2, 2B.4). Left: the element pill (click or
 * Ctrl/Cmd+E opens an upward menu of the six elements with their shortcuts)
 * and a contextual Dual chip that appears only while the caret sits in a cue
 * cluster. Right: locked-pages chip, page count, word count, and the
 * aria-live save word.
 */
export function EditorStatusBar({
  currentElement,
  onSetElement,
  mod,
  dualVisible,
  dualActive,
  onToggleDual,
  caretPage,
  pageCount,
  pageTarget,
  wordCount,
  saved,
  saveError,
  collaborative,
  locked,
  lockRevision,
}: {
  currentElement: ElementType;
  onSetElement: (type: ElementType) => void;
  mod: string;
  dualVisible: boolean;
  dualActive: boolean;
  onToggleDual: () => void;
  caretPage: number;
  pageCount: number;
  pageTarget?: number;
  wordCount: number;
  saved: boolean;
  saveError: boolean;
  collaborative?: boolean;
  locked: boolean;
  lockRevision?: string;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const pillRef = useRef<HTMLButtonElement>(null);

  // Ctrl/Cmd+E toggles the element menu (2B.4). preventDefault so the
  // browser's own Cmd+E behavior never fires while writing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "e") {
        e.preventDefault();
        setMenuOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const items: MenuItem[] = ELEMENT_CYCLE.map((t) => ({
    kind: "radio" as const,
    group: "element",
    label: ELEMENT_LABELS[t],
    hint: mod + ELEMENT_NUMBER[t],
    checked: currentElement === t,
    onSelect: () => onSetElement(t),
  }));

  return (
    <div className="status-bar">
      <button
        type="button"
        ref={pillRef}
        className="element-pill"
        onClick={() => setMenuOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        title={`Line type (${mod}E)`}
      >
        {ELEMENT_LABELS[currentElement]}
        <ChevronUpIcon />
      </button>
      {menuOpen && pillRef.current && (
        <Menu
          side="top"
          anchor={pillRef.current.getBoundingClientRect()}
          items={items}
          onClose={() => setMenuOpen(false)}
          ariaLabel="Line type"
        />
      )}

      {dualVisible && (
        <button
          type="button"
          className={"dual-chip" + (dualActive ? " dual-chip-on" : "")}
          aria-pressed={dualActive}
          onClick={onToggleDual}
          title={`Dual dialogue (${mod}D)`}
        >
          Dual
        </button>
      )}

      <span className="status-spacer" />

      {collaborative && (
        <span className="status-item status-duet" title="Yjs is syncing this script. Account cloud sync is paused.">
          Cloud sync off while shared
        </span>
      )}

      {locked && (
        <span
          className="status-item status-locked"
          title="Page numbers are locked. Inserted material takes A-page letters."
        >
          {lockRevision ? `Locked · ${lockRevision}` : "Locked"}
        </span>
      )}
      <span className="status-item">
        {pageTarget
          ? `${pageCount} / ${pageTarget} ${pageTarget === 1 ? "page" : "pages"}`
          : `Page ${caretPage} of ${pageCount} · ${pageCount} min`}
      </span>
      <span className="status-item">{wordCount.toLocaleString()} words</span>
      <span
        className={"status-item status-saved" + (saveError ? " status-save-error" : "")}
        role="status"
        aria-live="polite"
        title={
          saveError
            ? "This device's storage is full, so the latest changes could not be saved locally. Sign in to save to the cloud, or free up space."
            : undefined
        }
      >
        {saveError ? "Not saved" : saved ? "Saved" : "Saving…"}
      </span>
    </div>
  );
}
