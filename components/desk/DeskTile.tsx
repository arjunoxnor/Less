"use client";

import type { DocKind } from "@/lib/cover/kinds";
import { KIND_LABEL } from "@/lib/cover/kinds";
import { paletteFor, stickyFor } from "@/lib/cover/palette";
import type { ProjectMeta } from "@/lib/storage/projects";
import { DotsIcon } from "../chrome/icons";
import { NameInput, relativeTime, STATUS_LABEL } from "../home/homeParts";
import { Cover } from "./Cover";
import { StackGlyph } from "./glyphs";

/**
 * One thing on the desk: its cover, and under it what it is, its name, and
 * when it was last touched. The whole tile opens it; it can be picked up and
 * carried (to a folder, to a new place, or onto another cover to stack it as a
 * version of that one); its actions sit behind the dots.
 *
 * A stack shows the other versions as sheets behind the cover, and a pill on
 * the cover fans them out.
 */
export function DeskTile({
  doc,
  kind,
  seed,
  group,
  versions = 1,
  where,
  spine,
  current,
  lifted,
  stackTarget,
  stackable,
  renaming,
  menuOpen,
  trayOpen,
  trayId,
  index,
  onOpen,
  onMenu,
  onPointerDown,
  onToggleTray,
  onRenameCommit,
  onRenameDone,
}: {
  doc: ProjectMeta;
  kind: DocKind;
  /** What the cover's colors come from (its stack, or itself). */
  seed: string;
  /** Its group on the desk (its stack), so nothing is stacked onto its own stack. */
  group?: string;
  /** How many versions its stack holds here; 1 for a document on its own. */
  versions?: number;
  /** Where it lives, for views that mix folders (Recent, search). */
  where?: { label: string; color?: string };
  spine?: string;
  /** In a fanned-out stack: this is the version on top. */
  current?: boolean;
  lifted: boolean;
  /** Something is being carried onto this cover, to stack it here. */
  stackTarget: boolean;
  /** Offer this cover as a place to stack carried documents. */
  stackable: boolean;
  renaming: boolean;
  menuOpen: boolean;
  trayOpen?: boolean;
  trayId?: string;
  /** Position in a fanned-out stack, for the fan's stagger. */
  index?: number;
  onOpen: () => void;
  onMenu: (anchor: DOMRect) => void;
  onPointerDown?: (e: React.PointerEvent, el: HTMLElement) => void;
  onToggleTray?: () => void;
  onRenameCommit: (title: string) => void;
  onRenameDone: () => void;
}) {
  const title = doc.title || "Untitled";
  const sheet = kind === "notes" ? stickyFor(seed) : paletteFor(seed).bg;
  const status = doc.type === "screenplay" && doc.status !== "not_started" ? STATUS_LABEL[doc.status] : null;
  const label = KIND_LABEL[kind];
  return (
    <div
      className={"dk-tile" + (lifted ? " is-lifted" : "") + (stackTarget ? " is-stack-target" : "")}
      data-row=""
      data-id={doc.id}
      data-kind={kind}
      data-group={group}
      data-stack-onto={stackable ? doc.id : undefined}
      role="button"
      tabIndex={0}
      aria-label={
        `${title}, ${label}` +
        (versions > 1 ? `, ${versions} versions` : "") +
        (current ? ", current version" : "") +
        (where ? `, in ${where.label}` : "")
      }
      style={index !== undefined ? ({ ["--i" as string]: index } as React.CSSProperties) : undefined}
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
      <div className="dk-art" style={{ ["--sheet" as string]: sheet } as React.CSSProperties}>
        {versions > 2 && <span className="dk-sheet dk-sheet-2" aria-hidden="true" />}
        {versions > 1 && <span className="dk-sheet dk-sheet-1" aria-hidden="true" />}
        <Cover
          id={doc.id}
          seed={seed}
          title={title}
          kind={kind}
          digest={doc.digest}
          author={doc.coverAuthor}
          pageCount={doc.pageCount}
          spine={spine}
        />
        {versions > 1 && onToggleTray && (
          <button
            type="button"
            className="dk-versions"
            aria-expanded={!!trayOpen}
            aria-controls={trayOpen ? trayId : undefined}
            aria-label={trayOpen ? `Fold the versions of ${title}` : `Fan out ${versions} versions of ${title}`}
            title={trayOpen ? "Fold the versions" : "Fan out the versions"}
            onClick={(e) => {
              e.stopPropagation();
              onToggleTray();
            }}
            onKeyDown={(e) => e.stopPropagation()}
          >
            <StackGlyph />
            {versions}
          </button>
        )}
      </div>
      <div className="dk-label">
        <span className="dk-kind">{label}</span>
        {renaming ? (
          <NameInput
            initial={doc.title}
            className="lib-rename"
            ariaLabel={`${label} title`}
            onCommit={(name) => {
              if (name && name !== doc.title) onRenameCommit(name);
            }}
            onDone={onRenameDone}
          />
        ) : (
          <span className="dk-title">{title}</span>
        )}
        <span className="dk-meta">
          {current && <span className="dk-current">Current</span>}
          {where && (
            <span className="dk-where">
              {where.color && <span className="lib-dot" style={{ background: where.color }} aria-hidden="true" />}
              {where.label}
            </span>
          )}
          {status && <span className={"lib-status lib-status-" + doc.status}>{status}</span>}
          {doc.type === "screenplay" && doc.pageCount != null && <span>{doc.pageCount} pp</span>}
          <span>{relativeTime(doc.updatedAt)}</span>
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
    </div>
  );
}
