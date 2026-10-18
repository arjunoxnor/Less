"use client";

import { kindCount, type DocKind } from "@/lib/cover/kinds";
import type { Card } from "@/lib/storage/library";
import type { ProjectMeta } from "@/lib/storage/projects";
import { relativeTime } from "../home/homeParts";
import { Cover } from "./Cover";

/** Where each cover sits in a project's fan, by how many there are. Current first. */
const FANS: Record<number, { x: number; r: number; y: number }[]> = {
  1: [{ x: 0, r: -2, y: 0 }],
  2: [
    { x: -24, r: -6, y: 0 },
    { x: 24, r: 6, y: 4 },
  ],
  3: [
    { x: 0, r: 0, y: -6 },
    { x: 46, r: 9, y: 2 },
    { x: -46, r: -9, y: 2 },
  ],
  4: [
    { x: -21, r: -3.5, y: -5 },
    { x: 21, r: 3.5, y: -3 },
    { x: -62, r: -11, y: 4 },
    { x: 62, r: 11, y: 6 },
  ],
};

/**
 * A project on a stage's page: a hand of its covers fanned out, its name, and
 * what is in it ("2 scripts, 4 one-pagers"). Click anywhere on it to open the
 * project; press anywhere and drag to move it (between the other projects, or
 * onto another stage in the sidebar). Anything carried onto it is filed there.
 */
export function ProjectTile({
  card,
  covers,
  counts,
  isDrop,
  lifted,
  kindFor,
  seedFor,
  onOpen,
  onPointerDown,
}: {
  card: Card;
  /** Up to four documents to show, the one to continue first. */
  covers: ProjectMeta[];
  /** How many of each kind it holds, most first. */
  counts: [DocKind, number][];
  isDrop: boolean;
  /** Being carried somewhere else. */
  lifted?: boolean;
  kindFor: (doc: ProjectMeta) => DocKind;
  seedFor: (doc: ProjectMeta) => string;
  onOpen: () => void;
  /** Pick the project up, to move it. */
  onPointerDown?: (e: React.PointerEvent, el: HTMLElement) => void;
}) {
  const f = card.folder;
  const fan = FANS[Math.min(4, covers.length)] ?? [];
  return (
    <div
      className={"dk-project" + (isDrop ? " is-drop" : "") + (lifted ? " is-lifted" : "")}
      style={{ ["--fc" as string]: f.color } as React.CSSProperties}
      data-drop-into={f.id}
      data-project-tile={f.id}
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      onPointerDown={onPointerDown ? (e) => onPointerDown(e, e.currentTarget) : undefined}
      aria-label={`${f.name}, ${card.total} ${card.total === 1 ? "item" : "items"}`}
    >
      <span className="dk-fan" aria-hidden="true">
        {covers.length === 0 ? (
          <span className="dk-fan-empty">Nothing in it yet</span>
        ) : (
          covers.slice(0, 4).map((doc, i) => (
            <span
              key={doc.id}
              className="dk-fan-card"
              style={
                {
                  ["--x" as string]: `${fan[i].x}px`,
                  ["--r" as string]: `${fan[i].r}deg`,
                  ["--y" as string]: `${fan[i].y}px`,
                  zIndex: 10 - i,
                } as React.CSSProperties
              }
            >
              <Cover
                id={doc.id}
                seed={seedFor(doc)}
                title={doc.title}
                kind={kindFor(doc)}
                digest={doc.digest}
                author={doc.coverAuthor}
                pageCount={doc.pageCount}
                mini
              />
            </span>
          ))
        )}
      </span>
      <span className="dk-project-name">{f.name}</span>
      <span className="dk-project-counts">
        {counts.slice(0, 4).map(([kind, n]) => (
          <span key={kind} className="dk-count" data-kind={kind}>
            {kindCount(kind, n)}
          </span>
        ))}
        {counts.length === 0 && <span>Empty</span>}
      </span>
      <span className="dk-project-when">edited {relativeTime(card.lastTouched)}</span>
    </div>
  );
}
