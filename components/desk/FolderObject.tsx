"use client";

import { useState } from "react";
import type { DocKind } from "@/lib/cover/kinds";
import type { Folder } from "@/lib/storage/folders";
import type { ProjectMeta } from "@/lib/storage/projects";
import { DotsIcon } from "../chrome/icons";
import { Cover } from "./Cover";

/**
 * A folder sitting on a desk, shut: a real-looking folder with its papers
 * peeking out of the top. Run the pointer across it and the papers come up one
 * at a time, so a writer can rifle through a folder of one-pagers without
 * opening it; click the one that came up to open it, or drag it out onto the
 * desk. Click the front of the folder to open it into a column. Carry
 * something onto the folder to file it inside (data-drop-into).
 *
 * Keyboard: Left and Right rifle, Enter opens what came up (or the folder),
 * Space opens the folder.
 */
export function FolderObject({
  folder,
  docs,
  countLabel,
  kindFor,
  seedFor,
  isDrop,
  lifted,
  menuOpen,
  onOpenDoc,
  onOpen,
  onMenu,
  onPointerDown,
  onPullStart,
}: {
  folder: Folder;
  /** What is inside, one per stack, in the writer's order. */
  docs: ProjectMeta[];
  countLabel: string;
  kindFor: (doc: ProjectMeta) => DocKind;
  seedFor: (doc: ProjectMeta) => string;
  isDrop: boolean;
  lifted: boolean;
  menuOpen: boolean;
  onOpenDoc: (id: string) => void;
  /** Open the folder into a column on the desk. */
  onOpen: () => void;
  onMenu: (anchor: DOMRect) => void;
  /** Pick the folder up, to move it around the desk. */
  onPointerDown: (e: React.PointerEvent, el: HTMLElement) => void;
  /** Pull the paper that came up out of the folder. */
  onPullStart: (e: React.PointerEvent, el: HTMLElement, doc: ProjectMeta) => void;
}) {
  const [pulled, setPulled] = useState<number | null>(null);
  const n = docs.length;
  const shown = docs.slice(0, 5);
  const up = pulled !== null && pulled < n ? docs[pulled] : null;

  const rifle = (e: React.PointerEvent<HTMLElement>) => {
    if (n === 0 || document.documentElement.classList.contains("is-dragging")) return;
    const box = e.currentTarget.getBoundingClientRect();
    if (box.width <= 0) return;
    const i = Math.floor(((e.clientX - box.left) / box.width) * n);
    setPulled(Math.min(n - 1, Math.max(0, i)));
  };

  const label = `${folder.name}, a folder with ${countLabel}`;
  return (
    <div
      className={
        "dk-folder" + (isDrop ? " is-drop" : "") + (lifted ? " is-lifted" : "") + (up ? " is-rifling" : "")
      }
      style={{ ["--fc" as string]: folder.color } as React.CSSProperties}
      data-drop-into={folder.id}
      role="group"
      tabIndex={0}
      aria-label={label}
      onPointerDown={(e) => onPointerDown(e, e.currentTarget)}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
          if (n === 0) return;
          e.preventDefault();
          const step = e.key === "ArrowRight" ? 1 : -1;
          setPulled((i) => (i === null ? (step > 0 ? 0 : n - 1) : (i + step + n) % n));
        } else if (e.key === "Enter") {
          e.preventDefault();
          if (up) onOpenDoc(up.id);
          else onOpen();
        } else if (e.key === " ") {
          e.preventDefault();
          onOpen();
        } else if (e.key === "Escape") {
          setPulled(null);
        }
      }}
      onBlur={(e) => {
        // Clicking the paper that came up moves focus into it: keep it up.
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setPulled(null);
      }}
    >
      <div
        className="dk-folder-body"
        onPointerMove={rifle}
        onPointerLeave={() => setPulled(null)}
      >
        <div className="dk-folder-back" aria-hidden="true">
          <span className="dk-folder-tab" />
        </div>
        <div className="dk-folder-papers" aria-hidden="true">
          {shown.map((doc, i) => (
            <span
              key={doc.id}
              className="dk-folder-paper"
              style={{ ["--i" as string]: i, ["--n" as string]: shown.length } as React.CSSProperties}
            >
              <Cover id={doc.id} seed={seedFor(doc)} title={doc.title} kind={kindFor(doc)} digest={doc.digest} mini />
            </span>
          ))}
        </div>
        {up && (
          <div
            className="dk-folder-pulled"
            role="button"
            tabIndex={-1}
            style={{ ["--at" as string]: n > 1 ? pulled! / (n - 1) : 0.5 } as React.CSSProperties}
            aria-label={`Open ${up.title || "Untitled"}`}
            onPointerDown={(e) => {
              // Pulling the paper out, not moving the folder.
              e.stopPropagation();
              onPullStart(e, e.currentTarget, up);
            }}
            onClick={(e) => {
              e.stopPropagation();
              onOpenDoc(up.id);
            }}
          >
            <Cover
              id={up.id}
              seed={seedFor(up)}
              title={up.title}
              kind={kindFor(up)}
              digest={up.digest}
              author={up.coverAuthor}
              pageCount={up.pageCount}
              mini
            />
            <span className="dk-folder-pulled-title">{up.title || "Untitled"}</span>
          </div>
        )}
        <div
          className="dk-folder-front"
          onClick={(e) => {
            e.stopPropagation();
            onOpen();
          }}
          title="Open the folder"
        >
          <span className="dk-folder-front-line" aria-hidden="true" />
          {n === 0 && <span className="dk-folder-empty">Empty</span>}
        </div>
      </div>
      <div className="dk-folder-label">
        <span className="dk-folder-name">{folder.name}</span>
        <span className="dk-folder-count">{up ? `${pulled! + 1} of ${n}` : countLabel}</span>
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
      </div>
    </div>
  );
}
