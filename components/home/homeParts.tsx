"use client";

import { useEffect, useRef, useState } from "react";
import type { ProjectStatus, ProjectType } from "@/lib/storage/projects";
import { MAX_LIBRARY_NAME_LENGTH, normalizeLibraryName } from "@/lib/storage/library";
import { claimSyncCode } from "@/lib/cloud/auth";
import { Modal } from "../ui/Modal";
import { showToast } from "../ui/Toast";

/* Small pieces the home is built from: times, status words, glyphs, the
   hold-to-delete button, the inline name field and the sync-code dialog. */

export const STATUS_LABEL: Record<ProjectStatus, string> = {
  not_started: "Idea",
  writing: "Writing",
  done: "Done",
};

export function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const secs = Math.round((Date.now() - then) / 1000);
  if (secs < 60) return "just now";
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} ${hrs === 1 ? "hour" : "hours"} ago`;
  const days = Math.round(hrs / 24);
  if (days < 7) return `${days} ${days === 1 ? "day" : "days"} ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** The status dot + word pair. */
export function StatusWord({ status }: { status: ProjectStatus }) {
  return (
    <span className="st">
      <span className={"dot dot-" + status} aria-hidden="true" />
      {STATUS_LABEL[status]}
    </span>
  );
}

const svg = {
  width: 16,
  height: 16,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.75,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

/** A page with a folded corner: a script. */
export const ScriptGlyph = () => (
  <svg {...svg}>
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
    <polyline points="14 3 14 8 19 8" />
  </svg>
);
/** A lined sheet: a document. */
export const DocGlyph = () => (
  <svg {...svg}>
    <line x1="5" y1="7" x2="19" y2="7" />
    <line x1="5" y1="12" x2="19" y2="12" />
    <line x1="5" y1="17" x2="13" y2="17" />
  </svg>
);
/** Four frames: a board. */
export const BoardGlyph = () => (
  <svg {...svg}>
    <rect x="4" y="4" width="7" height="7" rx="1" />
    <rect x="13" y="4" width="7" height="7" rx="1" />
    <rect x="4" y="13" width="7" height="7" rx="1" />
    <rect x="13" y="13" width="7" height="7" rx="1" />
  </svg>
);
/** A microphone: a voice script (the older dictation documents). */
export const VoiceGlyph = () => (
  <svg {...svg}>
    <rect x="9" y="3" width="6" height="11" rx="3" />
    <path d="M5 11a7 7 0 0 0 14 0" />
    <line x1="12" y1="18" x2="12" y2="21" />
  </svg>
);
export const FolderGlyph = () => (
  <svg {...svg}>
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
  </svg>
);
export const ClockGlyph = () => (
  <svg {...svg}>
    <circle cx="12" cy="12" r="8.5" />
    <polyline points="12 7.5 12 12 15 14" />
  </svg>
);
export const TrayGlyph = () => (
  <svg {...svg}>
    <path d="M4 13l2.5-7h11L20 13v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z" />
    <path d="M4 13h4.5l1 2h5l1-2H20" />
  </svg>
);
export const SearchGlyph = () => (
  <svg {...svg}>
    <circle cx="11" cy="11" r="6.5" />
    <line x1="16" y1="16" x2="20" y2="20" />
  </svg>
);
export const PlusGlyph = () => (
  <svg {...svg}>
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);
export const MenuGlyph = () => (
  <svg {...svg}>
    <line x1="4" y1="7" x2="20" y2="7" />
    <line x1="4" y1="12" x2="20" y2="12" />
    <line x1="4" y1="17" x2="20" y2="17" />
  </svg>
);
export const ChevronDown = () => (
  <svg {...svg} width={12} height={12} strokeWidth={2}>
    <polyline points="6 9 12 15 18 9" />
  </svg>
);

export function TypeGlyph({ type }: { type: ProjectType }) {
  if (type === "screenplay") return <ScriptGlyph />;
  if (type === "board") return <BoardGlyph />;
  if (type === "voice") return <VoiceGlyph />;
  return <DocGlyph />;
}

/**
 * Press-and-hold to confirm a destructive action. The bar fills over ~2s; let
 * go early and nothing happens. Deliberately harder than a single click so a
 * folder is never deleted by accident. Lives inside the confirm modal.
 */
export function HoldDelete({ onConfirm }: { onConfirm: () => void }) {
  const [holding, setHolding] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const active = useRef(false);
  const confirmRef = useRef(onConfirm);
  confirmRef.current = onConfirm;
  const cancel = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    active.current = false;
    setHolding(false);
  };
  const start = () => {
    if (active.current) return;
    active.current = true;
    setHolding(true);
    timer.current = setTimeout(() => {
      timer.current = null;
      active.current = false;
      setHolding(false);
      confirmRef.current();
    }, 2000);
  };
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      active.current = false;
    },
    []
  );
  return (
    <button
      type="button"
      className={"hold-btn" + (holding ? " holding" : "")}
      onPointerDown={start}
      onPointerUp={cancel}
      onPointerLeave={cancel}
      onPointerCancel={cancel}
      onBlur={cancel}
      onKeyDown={(event) => {
        if ((event.key === "Enter" || event.key === " ") && !event.repeat) {
          event.preventDefault();
          start();
        }
      }}
      onKeyUp={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          cancel();
        }
      }}
    >
      <span className="hold-fill" />
      <span className="hold-label">{holding ? "Keep holding" : "Hold to delete"}</span>
    </button>
  );
}

/**
 * Name field that buffers keystrokes locally and commits on blur or Enter, so
 * a cloud-synced rename fires one write instead of one per letter.
 */
export function NameInput({
  initial,
  className,
  ariaLabel,
  onCommit,
  onDone,
}: {
  initial: string;
  className: string;
  ariaLabel: string;
  onCommit: (name: string) => void;
  onDone: () => void;
}) {
  const [val, setVal] = useState(initial);
  const commit = () => onCommit(normalizeLibraryName(val, ""));
  const ref = useRef<HTMLInputElement>(null);
  // Focus on the next tick, not via autoFocus: the Menu that triggered this
  // rename restores focus to its opener when it closes, and that restore runs
  // after this input mounts. The timeout wins the race, so typing lands here.
  useEffect(() => {
    const t = setTimeout(() => {
      ref.current?.focus();
      ref.current?.select();
    }, 0);
    return () => clearTimeout(t);
  }, []);
  return (
    <input
      ref={ref}
      className={className}
      value={val}
      maxLength={MAX_LIBRARY_NAME_LENGTH}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onChange={(e) => setVal(e.target.value)}
      onBlur={() => {
        commit();
        onDone();
      }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") {
          commit();
          onDone();
        } else if (e.key === "Escape") {
          onDone();
        }
      }}
      aria-label={ariaLabel}
    />
  );
}

/** "Import a code": pull another sync code's work into this account. */
export function CodeImportModal({
  onClose,
  onSyncNow,
}: {
  onClose: () => void;
  onSyncNow: () => Promise<boolean>;
}) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const apply = async () => {
    setBusy(true);
    setError(null);
    try {
      const ok = await claimSyncCode(code);
      if (!mounted.current) return;
      if (!ok) {
        setError("That code did not work. Paste the full code from your other device.");
        return;
      }
      await onSyncNow();
      if (!mounted.current) return;
      onClose();
      showToast("Imported. Your other work is now in this account.");
    } catch {
      if (mounted.current) setError("Could not import that code.");
    } finally {
      if (mounted.current) setBusy(false);
    }
  };
  const close = () => {
    if (!busy) onClose();
  };
  return (
    <Modal
      title="Import a code"
      onClose={close}
      actions={[
        { label: "Cancel", onClick: close, disabled: busy },
        {
          label: busy ? "Importing" : "Apply",
          variant: "solid",
          onClick: () => void apply(),
          disabled: busy || !code.trim(),
        },
      ]}
    >
      <p>Pull in work saved under a sync code from another device.</p>
      <input
        type="text"
        className="code-input"
        value={code}
        onChange={(e) => setCode(e.target.value)}
        placeholder="Paste a sync code"
        autoComplete="off"
        spellCheck={false}
        aria-label="Sync code"
        onKeyDown={(e) => {
          if (e.key === "Enter" && code.trim() && !busy) void apply();
        }}
      />
      {error && <p className="ui-modal-note">{error}</p>}
    </Modal>
  );
}
