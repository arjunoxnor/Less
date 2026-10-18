"use client";

import { useLayoutEffect, useRef, type ReactNode } from "react";
import type { DocKind } from "@/lib/cover/kinds";
import { KIND_LABEL } from "@/lib/cover/kinds";
import type { Folder } from "@/lib/storage/folders";
import type { ProjectMeta } from "@/lib/storage/projects";
import { DotsIcon } from "../chrome/icons";
import { NameInput, relativeTime } from "../home/homeParts";
import { Cover } from "./Cover";
import { settle } from "./settle";
import { useCornerResize } from "./useCornerResize";

/**
 * A folder opened on its desk: a column of what it holds, like a column on a
 * Milanote board. Pick it up by its head to move it out of the way; fold it
 * shut again into a folder; carry things into it (onto its head to file them,
 * or between its rows to put them in a place) and out of it onto the desk.
 * Its corner handle sets its width and height; shorter than what it holds,
 * it scrolls. Wide enough, it shows its things as a small grid of covers
 * instead of a list (desk.css), and they settle into their new places.
 */
export function FolderColumn({
  folder,
  countLabel,
  title,
  isDrop,
  lifted,
  menuOpen,
  empty,
  onFold,
  onMenu,
  onHeadPointerDown,
  width,
  height,
  onResize,
  children,
}: {
  folder: Folder;
  countLabel: string;
  /** The name, or the field renaming it. */
  title: ReactNode;
  isDrop: boolean;
  lifted: boolean;
  menuOpen: boolean;
  empty: boolean;
  onFold: () => void;
  onMenu: (anchor: DOMRect) => void;
  onHeadPointerDown: (e: React.PointerEvent, el: HTMLElement) => void;
  /** Its width on the desk, and its height when the writer set one. */
  width: number;
  height?: number;
  /** Offer the corner handle; called with the new size when it is let go. */
  onResize?: (size: { w: number; h: number }) => void;
  children: ReactNode;
}) {
  const resize = useCornerResize({
    width,
    height: height ?? 320,
    minW: 220,
    maxW: 720,
    minH: 150,
    maxH: 2400,
    // A column that has never been sized starts from the size it has on screen.
    measure: (handle) => {
      const box = handle.closest(".dk-column")?.getBoundingClientRect();
      return box && box.width > 0 ? { w: Math.round(box.width), h: Math.round(box.height) } : null;
    },
    onCommit: onResize ? (size) => onResize({ w: size.w, h: size.h ?? height ?? 320 }) : undefined,
  });
  const shownW = resize.live?.w ?? width;
  const shownH = resize.live?.h ?? height;

  const bodyRef = useRef<HTMLDivElement>(null);
  const asCovers = useRef<boolean | null>(null);
  useLayoutEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    const now = getComputedStyle(body).display === "grid";
    const was = asCovers.current;
    asCovers.current = now;
    if (was === null || was === now) return;
    settle(
      Array.from(body.querySelectorAll("[data-row]")),
      [
        { opacity: 0.2, transform: "scale(0.94)" },
        { opacity: 1, transform: "none" },
      ],
      { duration: 260, stagger: 18 }
    );
  }, [shownW]);
  return (
    <section
      className={"dk-column" + (lifted ? " is-lifted" : "") + (resize.live ? " is-resizing" : "")}
      style={
        {
          ["--fc" as string]: folder.color,
          width: shownW,
          ...(shownH !== undefined ? { height: shownH } : {}),
        } as React.CSSProperties
      }
      aria-label={`${folder.name}, open folder`}
      data-folder-id={folder.id}
    >
      <header
        className={"dk-column-head" + (isDrop ? " is-drop" : "")}
        data-drop-into={folder.id}
        onPointerDown={(e) => {
          const column = e.currentTarget.parentElement;
          if (column) onHeadPointerDown(e, column);
        }}
      >
        <span className="dk-column-tab" aria-hidden="true" />
        <div className="dk-column-titles">
          {title}
          <span className="dk-column-sub">{countLabel}</span>
        </div>
        <button
          type="button"
          className="lib-icon-btn dk-column-fold"
          aria-label={`Fold ${folder.name} shut`}
          title="Fold it shut"
          onClick={(e) => {
            e.stopPropagation();
            onFold();
          }}
        >
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
            <path d="M4 10l4-4 4 4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <button
          type="button"
          className="lib-icon-btn lib-kebab"
          aria-label={`Actions for ${folder.name}`}
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
      </header>
      <div ref={bodyRef} className="dk-column-body" data-list={folder.id}>
        {children}
      </div>
      {empty && <p className="dk-column-empty">Carry things here to file them in {folder.name}.</p>}
      {onResize && (
        <button
          type="button"
          className="dk-column-resize"
          aria-label={`Resize ${folder.name}`}
          title="Drag to change the size of this folder"
          {...resize.handle}
        >
          <svg viewBox="0 0 12 12" aria-hidden="true">
            <path d="M11 4L4 11M11 8L8 11" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </button>
      )}
    </section>
  );
}

/** One thing in an open folder: its cover small, what it is, and its name. */
export function DeskRow({
  doc,
  kind,
  seed,
  versions,
  lifted,
  stackTarget,
  renaming,
  menuOpen,
  onOpen,
  onMenu,
  onPointerDown,
  onRenameCommit,
  onRenameDone,
}: {
  doc: ProjectMeta;
  kind: DocKind;
  seed: string;
  versions: number;
  lifted: boolean;
  stackTarget: boolean;
  renaming: boolean;
  menuOpen: boolean;
  onOpen: () => void;
  onMenu: (anchor: DOMRect) => void;
  onPointerDown: (e: React.PointerEvent, el: HTMLElement) => void;
  onRenameCommit: (title: string) => void;
  onRenameDone: () => void;
}) {
  const title = doc.title || "Untitled";
  return (
    <div
      className={"dk-row" + (lifted ? " is-lifted" : "") + (stackTarget ? " is-stack-target" : "")}
      data-row=""
      data-id={doc.id}
      data-kind={kind}
      role="button"
      tabIndex={0}
      aria-label={`${title}, ${KIND_LABEL[kind]}${versions > 1 ? `, ${versions} versions` : ""}`}
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
      onPointerDown={(e) => onPointerDown(e, e.currentTarget)}
    >
      <span className="dk-row-thumb" aria-hidden="true">
        {versions > 1 && <span className="dk-row-sheet" />}
        <Cover id={doc.id} seed={seed} title={doc.title} kind={kind} digest={doc.digest} mini />
      </span>
      <span className="dk-row-text">
        <span className="dk-kind">{KIND_LABEL[kind]}</span>
        {renaming ? (
          <NameInput
            initial={doc.title}
            className="lib-rename"
            ariaLabel={`${KIND_LABEL[kind]} title`}
            onCommit={(name) => {
              if (name && name !== doc.title) onRenameCommit(name);
            }}
            onDone={onRenameDone}
          />
        ) : (
          <span className="dk-row-title">{title}</span>
        )}
        <span className="dk-row-when">
          {versions > 1 ? `${versions} versions · ` : ""}
          {relativeTime(doc.updatedAt)}
        </span>
      </span>
      <button
        type="button"
        className="lib-icon-btn lib-kebab"
        aria-label={`Actions for ${title}`}
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
