"use client";

import { memo, useEffect, useState } from "react";
import type { CastEntry } from "@/types/screenplay";
import type { RenamePlan } from "@/lib/editor/renameCharacter";
import { ELEMENT_CYCLE, ELEMENT_LABELS } from "@/lib/editor/elements";

export interface FindInputs {
  query: string;
  replace: string;
  caseSensitive: boolean;
  wholeWord: boolean;
  element: string;
}

/**
 * Find and replace, plus the rename-a-character-everywhere mode. The plugin
 * owns match state; this panel owns the inputs and reads the count/active index
 * back. Rename always requires a second confirm click before it touches the
 * document.
 */
export const FindReplacePanel = memo(function FindReplacePanel({
  findState,
  setFindState,
  matchCount,
  activeIndex,
  cast,
  onPrev,
  onNext,
  onReplaceOne,
  onReplaceAll,
  onRename,
  getPreview,
  onClose,
}: {
  findState: FindInputs;
  setFindState: (patch: Partial<FindInputs>) => void;
  matchCount: number;
  activeIndex: number;
  cast: CastEntry[];
  onPrev: () => void;
  onNext: () => void;
  onReplaceOne: () => void;
  onReplaceAll: () => number;
  onRename: (from: string, to: string, includeMentions: boolean) => RenamePlan;
  getPreview: (from: string, to: string, includeMentions: boolean) => RenamePlan;
  onClose: () => void;
}) {
  // The panel always opens in Find mode with blank rename fields; the planned
  // cast-panel handoff that pre-filled a name was never wired and its plumbing
  // is gone (superaudit 2 B10).
  const [mode, setMode] = useState<"find" | "rename">("find");
  const [queryDraft, setQueryDraft] = useState(findState.query);
  const [fromName, setFromName] = useState("");
  const [toName, setToName] = useState("");
  const [includeMentions, setIncludeMentions] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [replaceMsg, setReplaceMsg] = useState("");
  const [renameMsg, setRenameMsg] = useState("");
  const [preview, setPreview] = useState<RenamePlan | null>(null);

  const hasQuery = findState.query.trim().length > 0;
  const canReplace = hasQuery && matchCount > 0;
  const counter =
    !hasQuery
      ? ""
      : matchCount === 0
      ? "No matches"
      : `${Math.min(Math.max(activeIndex, 0), matchCount - 1) + 1} of ${matchCount}`;

  const cleanFrom = fromName.trim();
  const cleanTo = toName.trim();
  const canRename =
    !!cleanFrom &&
    !!cleanTo &&
    cleanFrom.toUpperCase() !== cleanTo.toUpperCase();

  // Previewing walks the document. Debounce it so typing a name in a long
  // screenplay does not synchronously rescan hundreds of pages per keypress.
  useEffect(() => {
    setPreview(null);
    if (mode !== "rename" || !canRename) return;
    const timer = window.setTimeout(() => {
      setPreview(getPreview(cleanFrom, cleanTo, includeMentions));
    }, 150);
    return () => window.clearTimeout(timer);
  }, [canRename, cast, cleanFrom, cleanTo, getPreview, includeMentions, mode]);

  const doRename = () => {
    if (!canRename) return;
    if (!confirming) {
      setConfirming(true);
      return;
    }
    // Re-read immediately on the confirmation click. The document may have
    // changed since the debounced preview (or since the first click).
    const livePreview = getPreview(cleanFrom, cleanTo, includeMentions);
    setPreview(livePreview);
    if (livePreview.cues + livePreview.mentions === 0) {
      setRenameMsg("Nothing to rename; the source text is no longer present.");
      setConfirming(false);
      return;
    }
    const r = onRename(cleanFrom, cleanTo, includeMentions);
    setRenameMsg(
      `Renamed ${r.cues === 1 ? "1 cue" : `${r.cues} cues`} and ${
        r.mentions === 1 ? "1 mention" : `${r.mentions} mentions`
      }.`
    );
    setConfirming(false);
    // Clear the inputs so the just-used (now stale) source name cannot be
    // re-applied against the already-renamed document.
    setFromName("");
    setToName("");
  };

  return (
    <aside className="side-panel find-panel">
      <div className="side-panel-head">
        <strong>Find and replace</strong>
        <button type="button" className="side-panel-x" onClick={onClose} title="Close">
          Close
        </button>
      </div>

      <div className="find-seg">
        <button
          type="button"
          className={"seg" + (mode === "find" ? " seg-active" : "")}
          onClick={() => setMode("find")}
          aria-pressed={mode === "find"}
        >
          Find
        </button>
        <button
          type="button"
          className={"seg" + (mode === "rename" ? " seg-active" : "")}
          onClick={() => setMode("rename")}
          aria-pressed={mode === "rename"}
        >
          Rename
        </button>
      </div>

      {mode === "find" ? (
        <div className="find-body">
          <input
            className="find-input"
            placeholder="Find in script"
            aria-label="Find in script"
            autoFocus
            value={queryDraft}
            onChange={(e) => {
              const query = e.target.value;
              setQueryDraft(query);
              setReplaceMsg("");
              // Preserve leading/trailing spaces once there is real text, but
              // never ask the document plugin to enumerate whitespace for an
              // all-space query.
              setFindState({ query: query.trim() ? query : "" });
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                if (hasQuery && matchCount > 0) onNext();
              }
            }}
          />
          <input
            className="find-input"
            placeholder="Replace with"
            aria-label="Replace with"
            value={findState.replace}
            onChange={(e) => setFindState({ replace: e.target.value })}
          />
          <label className="find-check">
            <input
              type="checkbox"
              checked={findState.caseSensitive}
              onChange={(e) => setFindState({ caseSensitive: e.target.checked })}
            />
            Match case
          </label>
          <label className="find-check">
            <input
              type="checkbox"
              checked={findState.wholeWord}
              onChange={(e) => setFindState({ wholeWord: e.target.checked })}
            />
            Whole word
          </label>
          <label className="find-check find-check-select">
            <span>In</span>
            <select
              className="find-input"
              value={findState.element}
              onChange={(e) => setFindState({ element: e.target.value })}
            >
              <option value="all">All elements</option>
              {ELEMENT_CYCLE.map((t) => (
                <option key={t} value={t}>
                  {ELEMENT_LABELS[t]}
                </option>
              ))}
            </select>
          </label>

          <div className="find-row">
            <button type="button" className="tb-btn" onClick={onPrev} disabled={!hasQuery || matchCount === 0}>
              Previous
            </button>
            <button type="button" className="tb-btn" onClick={onNext} disabled={!hasQuery || matchCount === 0}>
              Next
            </button>
            <button
              type="button"
              className="tb-btn"
              onClick={() => {
                onReplaceOne();
                setReplaceMsg("");
              }}
              disabled={!canReplace}
            >
              Replace
            </button>
            <button
              type="button"
              className="tb-btn"
              onClick={() => {
                const count = onReplaceAll();
                setReplaceMsg(
                  count === 1 ? "Replaced 1 match" : `Replaced ${count} matches`
                );
              }}
              disabled={!canReplace}
            >
              Replace all
            </button>
          </div>

          <div className="find-count" role="status" aria-live="polite">
            {replaceMsg || counter}
          </div>
        </div>
      ) : (
        <div className="find-body">
          <select
            className="find-input"
            aria-label="Character to rename"
            value={cast.some((c) => c.name === fromName) ? fromName : ""}
            onChange={(e) => {
              setFromName(e.target.value);
              setConfirming(false);
              setRenameMsg("");
            }}
          >
            <option value="">Choose a character</option>
            {cast.map((c) => (
              <option key={c.name} value={c.name}>
                {c.name}
              </option>
            ))}
          </select>
          <input
            className="find-input"
            placeholder="Or type a name"
            aria-label="Current character name"
            value={fromName}
            onChange={(e) => {
              setFromName(e.target.value);
              setConfirming(false);
              setRenameMsg("");
            }}
          />
          <input
            className="find-input"
            placeholder="New name"
            aria-label="New character name"
            value={toName}
            onChange={(e) => {
              setToName(e.target.value);
              setConfirming(false);
              setRenameMsg("");
            }}
          />
          <label className="find-check">
            <input
              type="checkbox"
              checked={includeMentions}
              onChange={(e) => {
                setIncludeMentions(e.target.checked);
                setConfirming(false);
                setRenameMsg("");
              }}
            />
            Also rename mentions in action and dialogue
          </label>

          {preview ? (
            <div className="find-count">
              Will rename {preview.cues === 1 ? "1 cue" : `${preview.cues} cues`} and{" "}
              {preview.mentions === 1 ? "1 mention" : `${preview.mentions} mentions`}.
            </div>
          ) : canRename ? (
            <div className="find-hint">Calculating rename preview…</div>
          ) : (
            <div className="find-hint">Pick a character and a new name.</div>
          )}

          <div className="find-row">
            <button
              type="button"
              className={"tb-btn" + (confirming ? " tb-btn-active" : "")}
              onClick={doRename}
              disabled={!canRename}
            >
              {confirming ? "Confirm rename" : "Rename everywhere"}
            </button>
            {confirming && (
              <button type="button" className="tb-btn" onClick={() => setConfirming(false)}>
                Cancel
              </button>
            )}
          </div>

          {renameMsg && (
            <div className="find-count" role="status" aria-live="polite">
              {renameMsg}
            </div>
          )}
        </div>
      )}
    </aside>
  );
}, (previous, next) =>
  previous.findState === next.findState &&
  previous.matchCount === next.matchCount &&
  previous.activeIndex === next.activeIndex &&
  previous.cast === next.cast &&
  previous.setFindState === next.setFindState &&
  previous.onPrev === next.onPrev &&
  previous.onNext === next.onNext &&
  previous.onReplaceOne === next.onReplaceOne &&
  previous.onReplaceAll === next.onReplaceAll &&
  previous.onRename === next.onRename &&
  previous.getPreview === next.getPreview
);
