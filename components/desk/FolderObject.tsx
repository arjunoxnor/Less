"use client";

import { useLayoutEffect, useRef, useState } from "react";
import type { DocKind } from "@/lib/cover/kinds";
import type { Folder } from "@/lib/storage/folders";
import type { ProjectMeta } from "@/lib/storage/projects";
import { DotsIcon } from "../chrome/icons";
import { Cover } from "./Cover";
import { settle } from "./settle";
import { useCornerResize } from "./useCornerResize";

/**
 * A folder sitting on a desk, shut: a real-looking folder with its papers
 * peeking out of the top. Run the pointer across the papers and they come up
 * one at a time, so a writer can rifle through a folder of one-pagers without
 * opening it; click the one that came up to open it, or drag it out onto the
 * desk. Anywhere else (its front, its tab, its name) is the folder itself:
 * press and drag to move it, click to open it into a column. Carry something
 * onto the folder to file it inside (data-drop-into).
 *
 * Keyboard: Left and Right rifle, Enter opens what came up (or the folder),
 * Space opens the folder. The handle at its corner makes it bigger or
 * smaller, and the folder uses the room: a small one shows a few papers, a big
 * one fans out more of them, and past a size it carries a typed contents slip
 * on its front listing the first few titles. It is drawn in proportion to its
 * width, so it keeps its shape at any size.
 */

/** How many papers peek out of a folder this wide. */
export const papersFor = (width: number) => (width < 170 ? 3 : width < 250 ? 5 : width < 330 ? 7 : 9);
/** How many titles its contents slip lists (none on a smaller folder). */
export const slipLinesFor = (width: number) => (width >= 380 ? 5 : width >= 290 ? 3 : 0);
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
  width,
  onResize,
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
  /** Its width on the desk. */
  width: number;
  /** Offer the corner handle; called with the new width when it is let go. */
  onResize?: (width: number) => void;
}) {
  const [pulled, setPulled] = useState<number | null>(null);
  const resize = useCornerResize({
    width,
    minW: 140,
    maxW: 460,
    onCommit: onResize ? (size) => onResize(size.w) : undefined,
  });
  const shownWidth = resize.live?.w ?? width;
  const n = docs.length;
  // A bigger folder shows more of what it holds; the fan opens more gently
  // the more papers there are, so it never splays.
  const shown = docs.slice(0, papersFor(shownWidth));
  const spread = shown.length <= 3 ? 5 : shown.length <= 5 ? 3.5 : shown.length <= 7 ? 2.4 : 1.8;
  const slipLines = slipLinesFor(shownWidth);
  const up = pulled !== null && pulled < n ? docs[pulled] : null;

  // Papers that come into view as the folder grows rise out of its pocket.
  const papersRef = useRef<HTMLDivElement>(null);
  const shownBefore = useRef(shown.length);
  useLayoutEffect(() => {
    const before = shownBefore.current;
    shownBefore.current = shown.length;
    if (shown.length <= before || !papersRef.current) return;
    settle(
      Array.from(papersRef.current.children).slice(before),
      [
        { opacity: 0, translate: "0 45%" },
        { opacity: 1, translate: "0 0" },
      ],
      { duration: 280, stagger: 40 }
    );
  }, [shown.length]);

  const rifle = (e: React.PointerEvent<HTMLElement>) => {
    // A held button is a paper (or the folder) being picked up: the paper that
    // came up stays the one that was pressed.
    if (n === 0 || e.buttons !== 0 || document.documentElement.classList.contains("is-dragging")) return;
    const box = e.currentTarget.getBoundingClientRect();
    if (box.width <= 0) return;
    // Only the strip of papers sticking out rifles (and the paper that came
    // up, while the pointer is on it). Above it (the tab, the folder's top
    // edge) and below it (the front) the pointer is on the folder itself, to
    // move it or open it, so the paper goes back in. The strip is measured
    // from the folder's own shape, so papers moving never move it.
    const u = box.width / 214;
    const onPaper = (e.target as Element).closest(".dk-folder-pulled");
    if (!onPaper && (e.clientY < box.top + 30 * u || e.clientY >= box.bottom - 104 * u)) {
      setPulled(null);
      return;
    }
    const i = Math.floor(((e.clientX - box.left) / box.width) * n);
    setPulled(Math.min(n - 1, Math.max(0, i)));
  };

  const label = `${folder.name}, a folder with ${countLabel}`;
  return (
    <div
      className={
        "dk-folder" +
        (isDrop ? " is-drop" : "") +
        (lifted ? " is-lifted" : "") +
        (up ? " is-rifling" : "") +
        (resize.live ? " is-resizing" : "")
      }
      style={{ ["--fc" as string]: folder.color, width: shownWidth } as React.CSSProperties}
      data-drop-into={folder.id}
      role="group"
      tabIndex={0}
      aria-label={label}
      onPointerDown={(e) => onPointerDown(e, e.currentTarget)}
      onClick={(e) => {
        // Anywhere on the folder but a paper that came up (or its dots) opens it.
        if ((e.target as Element).closest(".dk-folder-pulled, button")) return;
        onOpen();
      }}
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
        <div
          ref={papersRef}
          className="dk-folder-papers"
          aria-hidden="true"
          style={{ ["--spread" as string]: `${spread}deg` } as React.CSSProperties}
        >
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
        <div className="dk-folder-front" title="Open the folder">
          <span className="dk-folder-front-line" aria-hidden="true" />
          {n === 0 && <span className="dk-folder-empty">Empty</span>}
          {n > 0 && slipLines > 0 && (
            <span className="dk-folder-slip" aria-hidden="true">
              {docs.slice(0, slipLines).map((doc) => (
                <span key={doc.id} className="dk-folder-slip-line">
                  {doc.title || "Untitled"}
                </span>
              ))}
              {n > slipLines && <span className="dk-folder-slip-more">and {n - slipLines} more</span>}
            </span>
          )}
        </div>
        {onResize && (
          <button
            type="button"
            className="dk-resize dk-folder-resize"
            aria-label={`Resize ${folder.name}`}
            title="Drag to make the folder bigger or smaller"
            {...resize.handle}
          >
            <svg viewBox="0 0 12 12" aria-hidden="true">
              <path d="M11 4L4 11M11 8L8 11" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
        )}
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
