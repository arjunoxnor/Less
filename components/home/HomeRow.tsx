"use client";

import type { ProjectMeta } from "@/lib/storage/projects";
import { DotsIcon } from "../chrome/icons";
import { NameInput, relativeTime, STATUS_LABEL, TypeGlyph } from "./homeParts";

/**
 * One script, document, board or voice script in a list on the home. The whole
 * row opens it; it can be picked up and carried (see useHomeDrag); its
 * actions sit behind the dots at the end.
 */
export function HomeRow({
  project,
  where,
  whereColor,
  lifted,
  renaming,
  menuOpen,
  onOpen,
  onMenu,
  onPointerDown,
  onRenameCommit,
  onRenameDone,
}: {
  project: ProjectMeta;
  /** The folder it lives in, for lists that mix folders (Recent, search). */
  where?: string;
  whereColor?: string;
  lifted: boolean;
  renaming: boolean;
  menuOpen: boolean;
  onOpen: () => void;
  onMenu: (anchor: DOMRect) => void;
  onPointerDown?: (e: React.PointerEvent, el: HTMLElement) => void;
  onRenameCommit: (title: string) => void;
  onRenameDone: () => void;
}) {
  const p = project;
  const kind =
    p.type === "screenplay"
      ? "Script"
      : p.type === "board"
        ? "Board"
        : p.type === "voice"
          ? "Voice script"
          : "Document";
  const status = p.type === "screenplay" && p.status !== "not_started" ? STATUS_LABEL[p.status] : null;
  return (
    <div
      className={"lib-row" + (lifted ? " is-lifted" : "")}
      data-row=""
      data-id={p.id}
      role="button"
      tabIndex={0}
      aria-label={`${p.title}, ${kind}${where ? `, in ${where}` : ""}`}
      onClick={() => {
        if (!renaming) onOpen();
      }}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      onPointerDown={onPointerDown ? (e) => onPointerDown(e, e.currentTarget) : undefined}
    >
      <span className={"lib-row-icon lib-kind-" + p.type} aria-hidden="true">
        <TypeGlyph type={p.type} />
      </span>
      {renaming ? (
        <NameInput
          initial={p.title}
          className="lib-rename"
          ariaLabel={`${kind} title`}
          onCommit={(name) => {
            if (name && name !== p.title) onRenameCommit(name);
          }}
          onDone={onRenameDone}
        />
      ) : (
        <span className="lib-row-title">{p.title || "Untitled"}</span>
      )}
      {where && (
        <span className="lib-row-where">
          {whereColor && <span className="lib-dot" style={{ background: whereColor }} aria-hidden="true" />}
          {where}
        </span>
      )}
      <span className="lib-row-meta">
        {status && <span className={"lib-status lib-status-" + p.status}>{status}</span>}
        {p.type === "screenplay" && p.pageCount != null && <span>{p.pageCount} pp</span>}
        {p.type === "board" && <span>Board</span>}
        {p.type === "voice" && <span>Voice</span>}
      </span>
      <span className="lib-row-when">{relativeTime(p.updatedAt)}</span>
      <button
        type="button"
        className="lib-icon-btn lib-kebab"
        aria-label={`Actions for ${p.title}`}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        onClick={(e) => {
          e.stopPropagation();
          onMenu(e.currentTarget.getBoundingClientRect());
        }}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <DotsIcon />
      </button>
    </div>
  );
}
