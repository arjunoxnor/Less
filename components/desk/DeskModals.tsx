"use client";

import { useMemo, useState } from "react";
import { KIND_LABEL, PROSE_KINDS, type DocKind } from "@/lib/cover/kinds";
import type { ProjectMeta } from "@/lib/storage/projects";
import { Modal } from "../ui/Modal";
import { Cover } from "./Cover";

/**
 * "What is this?": a plain document's kind, picked by looking at what each
 * choice would make its cover. It changes the cover and the label only; the
 * text is never touched.
 */
export function KindPickerModal({
  doc,
  seed,
  kind,
  explicit,
  onPick,
  onClose,
}: {
  doc: ProjectMeta;
  seed: string;
  /** The kind it shows as now. */
  kind: DocKind;
  /** Whether the writer chose it (as opposed to LESS reading it from the title). */
  explicit: boolean;
  /** null: let LESS read it from the title again. */
  onPick: (kind: DocKind | null) => void;
  onClose: () => void;
}) {
  return (
    <Modal title="What is this?" onClose={onClose}>
      <p className="modal-sub">
        Pick what &quot;{doc.title || "Untitled"}&quot; is. It changes the cover and the label on your
        desk. The writing stays exactly as it is.
      </p>
      <div className="dk-kind-grid" role="group" aria-label="Kinds">
        {PROSE_KINDS.map((k) => (
          <button
            key={k}
            type="button"
            className="dk-kind-option"
            data-kind={k}
            aria-pressed={k === kind}
            onClick={() => onPick(k)}
          >
            <Cover id={doc.id} seed={seed} title={doc.title} kind={k} digest={doc.digest} mini />
            <span className="dk-kind">{KIND_LABEL[k]}</span>
          </button>
        ))}
      </div>
      {explicit && (
        <div className="dk-modal-foot">
          <button type="button" className="ui-btn ui-btn-text" onClick={() => onPick(null)}>
            Let LESS tell from the title
          </button>
        </div>
      )}
    </Modal>
  );
}

/**
 * "Stack with": pick the document this one is a version of. Same folder and
 * same kind come first, since that is nearly always the one.
 */
export function StackWithModal({
  doc,
  candidates,
  kindFor,
  seedFor,
  whereOf,
  onPick,
  onClose,
}: {
  doc: ProjectMeta;
  candidates: ProjectMeta[];
  kindFor: (d: ProjectMeta) => DocKind;
  seedFor: (d: ProjectMeta) => string;
  whereOf: (d: ProjectMeta) => string;
  onPick: (targetId: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (q ? candidates.filter((c) => c.title.toLowerCase().includes(q)) : candidates).slice(0, 60);
  }, [candidates, query]);
  return (
    <Modal title="Stack as a version of" onClose={onClose}>
      <p className="modal-sub">
        Pick the document &quot;{doc.title || "Untitled"}&quot; is a version of. It joins that stack, and
        the version on top stays on top.
      </p>
      <label className="field">
        <span>Find</span>
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by name" />
      </label>
      <div className="dk-pick-list" role="list">
        {shown.map((c) => (
          <button
            key={c.id}
            type="button"
            role="listitem"
            className="dk-pick"
            data-kind={kindFor(c)}
            onClick={() => onPick(c.id)}
            aria-label={`${c.title || "Untitled"}, in ${whereOf(c)}`}
          >
            <Cover
              id={c.id}
              seed={seedFor(c)}
              title={c.title}
              kind={kindFor(c)}
              digest={c.digest}
              author={c.coverAuthor}
              pageCount={c.pageCount}
              mini
            />
            <span className="dk-pick-title">{c.title || "Untitled"}</span>
            <span className="dk-pick-where">{whereOf(c)}</span>
          </button>
        ))}
        {shown.length === 0 && <p className="dk-pick-none">Nothing by that name.</p>}
      </div>
    </Modal>
  );
}
