"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import type { JSONContent } from "@tiptap/core";
import {
  diffScripts,
  linesFromDoc,
  summarize,
  type DiffLine,
  type DiffRow,
} from "@/lib/editor/scriptDiff";

/**
 * What changed: an earlier version of the script against the script as it is
 * now, on one long page in screenplay format. Lines cut are struck through,
 * lines added are marked in the margin and tinted, and a reworded line shows
 * the words that changed inside it. Long stretches with no change fold away
 * (open any of them), and Previous / Next walk from one change to the next.
 */

export interface CompareSource {
  /** How the earlier version is named in the header ("Draft 2", "Sep 21, 4:10 pm"). */
  label: string;
  content: JSONContent;
}

/** Unchanged lines kept around each change when the rest is folded away. */
const CONTEXT = 2;

type Item =
  | { kind: "row"; row: DiffRow; index: number; hunk: number | null }
  | { kind: "fold"; from: number; to: number };

export function CompareView({
  earlier,
  current,
  onClose,
}: {
  earlier: CompareSource;
  current: JSONContent;
  onClose: () => void;
}) {
  const rows = useMemo(
    () => diffScripts(linesFromDoc(earlier.content), linesFromDoc(current)),
    [earlier.content, current]
  );
  const summary = useMemo(() => summarize(rows), [rows]);
  const [opened, setOpened] = useState<Set<number>>(() => new Set());
  const [wholeScript, setWholeScript] = useState(false);
  const [at, setAt] = useState(-1);
  const rootRef = useRef<HTMLDivElement>(null);
  const hunkEls = useRef(new Map<number, HTMLElement>());

  // Hunks: runs of changed rows. hunkOf[i] is the hunk row i belongs to.
  const { hunkOf, hunkCount } = useMemo(() => {
    const of: (number | null)[] = [];
    let count = 0;
    let inHunk = false;
    rows.forEach((row) => {
      if (row.kind === "same") {
        inHunk = false;
        of.push(null);
      } else {
        if (!inHunk) count++;
        inHunk = true;
        of.push(count - 1);
      }
    });
    return { hunkOf: of, hunkCount: count };
  }, [rows]);

  const items = useMemo<Item[]>(() => {
    const out: Item[] = [];
    const keep = rows.map((row, i) => {
      if (wholeScript || row.kind !== "same") return true;
      for (let d = 1; d <= CONTEXT; d++) {
        if (rows[i - d] && rows[i - d].kind !== "same") return true;
        if (rows[i + d] && rows[i + d].kind !== "same") return true;
      }
      return false;
    });
    let i = 0;
    while (i < rows.length) {
      if (keep[i]) {
        out.push({ kind: "row", row: rows[i], index: i, hunk: hunkOf[i] });
        i++;
        continue;
      }
      let j = i;
      while (j < rows.length && !keep[j]) j++;
      // A fold that hides one or two lines costs more than it saves.
      if (opened.has(i) || j - i < 3) {
        for (let x = i; x < j; x++) out.push({ kind: "row", row: rows[x], index: x, hunk: null });
      } else {
        out.push({ kind: "fold", from: i, to: j });
      }
      i = j;
    }
    return out;
  }, [rows, wholeScript, opened, hunkOf]);

  useEffect(() => {
    rootRef.current?.focus({ preventScroll: true });
  }, []);

  const goTo = (hunk: number) => {
    if (hunkCount === 0) return;
    const next = (hunk + hunkCount) % hunkCount;
    setAt(next);
    hunkEls.current.get(next)?.scrollIntoView({ block: "center", behavior: "smooth" });
  };

  const parts: string[] = [];
  if (summary.scenesChanged) {
    parts.push(`${summary.scenesChanged} ${summary.scenesChanged === 1 ? "scene" : "scenes"} changed`);
  }
  if (summary.added) parts.push(`${summary.added} ${summary.added === 1 ? "line" : "lines"} added`);
  if (summary.changed) parts.push(`${summary.changed} reworded`);
  if (summary.removed) parts.push(`${summary.removed} cut`);

  // Lines are siblings, as on the page: a wrapper around each would make every
  // line a first child and drop the blank line the page puts before it.
  const renderLine = (
    key: number,
    line: DiffLine,
    kind: DiffRow["kind"],
    current: boolean,
    ref: ((el: HTMLElement | null) => void) | undefined,
    content?: React.ReactNode
  ) => (
    <p
      key={key}
      ref={ref}
      className={`sp-line sp-${line.element} cmp-row cmp-${kind}` + (current ? " is-current" : "")}
    >
      {content ?? (line.text || "\u00a0")}
    </p>
  );

  return (
    <div
      ref={rootRef}
      className="cmp-root"
      tabIndex={-1}
      aria-label="Changes"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          onClose();
        } else if (e.key === "ArrowDown" && e.altKey) {
          e.preventDefault();
          goTo(at + 1);
        } else if (e.key === "ArrowUp" && e.altKey) {
          e.preventDefault();
          goTo(at - 1);
        }
      }}
    >
      <header className="cmp-head">
        <div className="cmp-title">
          <strong>Changes since {earlier.label}</strong>
          <span className="cmp-sub">
            {hunkCount === 0 ? "No changes: this version and the script now are the same." : parts.join(" · ")}
          </span>
        </div>
        <div className="cmp-actions">
          <label className="cmp-toggle">
            <input
              type="checkbox"
              checked={wholeScript}
              onChange={(e) => setWholeScript(e.target.checked)}
            />
            Whole script
          </label>
          <button type="button" className="ui-btn" disabled={hunkCount === 0} onClick={() => goTo(at - 1)}>
            Previous
          </button>
          <button type="button" className="ui-btn" disabled={hunkCount === 0} onClick={() => goTo(at + 1)}>
            Next change
          </button>
          <button type="button" className="ui-btn ui-btn-solid" onClick={onClose}>
            Done
          </button>
        </div>
      </header>

      <div className="cmp-scroll">
        <div className="cmp-sheet sp-prose">
          {items.map((item) => {
            if (item.kind === "fold") {
              const count = item.to - item.from;
              return (
                <button
                  key={"fold" + item.from}
                  type="button"
                  className="cmp-fold"
                  onClick={() => setOpened((prev) => new Set(prev).add(item.from))}
                >
                  {count} unchanged {count === 1 ? "line" : "lines"}
                </button>
              );
            }
            const { row, index, hunk } = item;
            const first = hunk !== null && (index === 0 || hunkOf[index - 1] !== hunk);
            const current = hunk !== null && hunk === at;
            const ref = first
              ? (el: HTMLElement | null) => {
                  if (el) hunkEls.current.set(hunk!, el);
                }
              : undefined;
            return row.kind === "changed"
              ? renderLine(
                  index,
                  row.after,
                  "changed",
                  current,
                  ref,
                  row.words.map((w, k) =>
                    w.kind === "same" ? (
                      <Fragment key={k}>{w.text}</Fragment>
                    ) : w.kind === "added" ? (
                      <ins key={k}>{w.text}</ins>
                    ) : (
                      <del key={k}>{w.text}</del>
                    )
                  )
                )
              : renderLine(index, row.line, row.kind, current, ref);
          })}
        </div>
      </div>
    </div>
  );
}
