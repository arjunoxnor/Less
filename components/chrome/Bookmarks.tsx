"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { Editor } from "@tiptap/react";
import {
  BOOKMARK_COLORS,
  BOOKMARK_NAME_MAX,
  bookmarkHex,
  bookmarksOf,
  jumpToBookmark,
  type BookmarkColor,
  type BookmarkEntry,
} from "@/lib/editor/bookmarks";
import { modKeyLabel } from "@/lib/platform";
import { restoreFocus } from "@/lib/restoreFocus";

/**
 * Bookmarks on the page (lib/editor/bookmarks.ts): a coloured flag in the
 * left margin beside each bookmarked line, and the status bar's list of them.
 * Click a flag to name it, recolour it or take it off; click a row in the
 * list to go there.
 */

const shortcut = () => `${modKeyLabel()}+Shift+B`;

/** The document's bookmarks, kept current as it changes. */
export function useBookmarks(editor: Editor | null): BookmarkEntry[] {
  const [entries, setEntries] = useState<BookmarkEntry[]>([]);
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    const sync = () => {
      if (!editor.isDestroyed) setEntries(bookmarksOf(editor.state));
    };
    sync();
    editor.on("transaction", sync);
    return () => {
      editor.off("transaction", sync);
    };
  }, [editor]);
  return entries;
}

const entryById = (editor: Editor, id: string) => bookmarksOf(editor.state).find((e) => e.bookmark.id === id);

/** A small panel hung off an anchor, closed by Escape or a click elsewhere. */
function Popover({
  anchor,
  side = "bottom",
  onClose,
  label,
  className = "",
  children,
}: {
  anchor: DOMRect;
  side?: "bottom" | "top";
  onClose: () => void;
  label: string;
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const close = useRef(onClose);
  close.current = onClose;

  useLayoutEffect(() => {
    opener.current = document.activeElement as HTMLElement | null;
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const left = Math.max(8, Math.min(vw - w - 8, anchor.left));
    const below = anchor.bottom + 6;
    const above = anchor.top - 6 - h;
    const top = side === "top" ? (above >= 8 ? above : below) : below + h <= vh - 8 ? below : Math.max(8, above);
    setPos((p) => (p && p.left === left && p.top === top ? p : { left, top }));
  }, [anchor, side]);

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (ref.current && e.target instanceof Node && !ref.current.contains(e.target)) close.current();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      close.current();
      restoreFocus(opener.current);
    };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey, true);
    };
  }, []);

  return createPortal(
    <div
      ref={ref}
      className={"bm-pop " + className}
      role="dialog"
      aria-label={label}
      style={pos ? { left: pos.left, top: pos.top } : { left: -9999, top: -9999 }}
    >
      {children}
    </div>,
    document.body
  );
}

function Swatches({ value, onPick, label }: { value?: BookmarkColor; onPick: (c: BookmarkColor) => void; label: string }) {
  return (
    <div className="bm-swatches" role="group" aria-label={label}>
      {BOOKMARK_COLORS.map((c) => (
        <button
          key={c.id}
          type="button"
          className="bm-swatch"
          style={{ ["--bm" as string]: c.hex }}
          aria-pressed={value === c.id}
          aria-label={c.label}
          title={c.label}
          onClick={() => onPick(c.id)}
        />
      ))}
    </div>
  );
}

/** Name, colour and remove for one bookmark. */
function BookmarkFields({ editor, id, autoFocus }: { editor: Editor; id: string; autoFocus?: boolean }) {
  const entry = entryById(editor, id);
  const [name, setName] = useState(entry?.bookmark.name ?? "");
  if (!entry) return null;
  const set = (attrs: { color?: BookmarkColor; name?: string }) => {
    const now = entryById(editor, id);
    if (now) editor.commands.setBookmark(attrs, now.pos);
  };
  return (
    <div className="bm-fields">
      <input
        className="bm-name"
        value={name}
        maxLength={BOOKMARK_NAME_MAX}
        placeholder="Name (optional)"
        aria-label="Bookmark name"
        autoFocus={autoFocus}
        onChange={(e) => {
          setName(e.target.value);
          set({ name: e.target.value.trim() });
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            (e.currentTarget.closest(".bm-pop")?.querySelector(".bm-swatch[aria-pressed=true]") as HTMLElement | null)?.focus();
          }
        }}
      />
      <Swatches value={entry.bookmark.color} onPick={(color) => set({ color })} label="Colour" />
    </div>
  );
}

const clip = (s: string, n: number) => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n - 1).trimEnd() + "…" : t;
};

/** What a bookmark is called in a list: its name, else its line. */
export const bookmarkTitle = (e: { bookmark: { name: string }; text: string }) =>
  e.bookmark.name.trim() || clip(e.text, 70) || "Empty line";

/**
 * The flags in the margin. Drawn on a layer inside the page host, so they
 * scale with the zoom and scroll with the page; placed by measuring each
 * bookmarked line (the paginator moves lines, so they are measured again
 * whenever the document or the layout changes).
 */
export function BookmarkLayer({ editor, entries, zoom }: { editor: Editor | null; entries: BookmarkEntry[]; zoom: number }) {
  const layer = useRef<HTMLDivElement>(null);
  const [spots, setSpots] = useState<{ id: string; top: number; left: number }[]>([]);
  const [editing, setEditing] = useState<{ id: string; anchor: DOMRect } | null>(null);

  useEffect(() => {
    if (!editor || editor.isDestroyed || entries.length === 0) {
      setSpots((s) => (s.length ? [] : s));
      return;
    }
    let frame = 0;
    let late: ReturnType<typeof setTimeout> | null = null;
    const measure = () => {
      frame = 0;
      const host = layer.current?.parentElement;
      if (!host || editor.isDestroyed) return;
      const view = editor.view;
      const hostRect = host.getBoundingClientRect();
      const scale = host.offsetWidth ? hostRect.width / host.offsetWidth : 1;
      if (!(scale > 0)) return;
      const root = view.dom as HTMLElement;
      const rootRect = root.getBoundingClientRect();
      const padLeft = parseFloat(getComputedStyle(root).paddingLeft) || 0;
      // Three quarters of an inch into the margin: clear of the line-type
      // icon and the note dot nearer the text, and of the scene numbers
      // further out.
      const left = Math.max(4, (rootRect.left - hostRect.left) / scale + padLeft - 72);
      const next: { id: string; top: number; left: number }[] = [];
      for (const e of bookmarksOf(view.state)) {
        const dom = view.nodeDOM(e.pos);
        if (!(dom instanceof HTMLElement)) continue;
        const r = dom.getBoundingClientRect();
        const lh = parseFloat(getComputedStyle(dom).lineHeight);
        const lineH = Number.isFinite(lh) ? lh : 18;
        next.push({ id: e.bookmark.id, top: Math.round((r.top - hostRect.top) / scale + Math.max(0, (lineH - 15) / 2)), left: Math.round(left) });
      }
      setSpots((prev) =>
        prev.length === next.length && prev.every((p, i) => p.id === next[i].id && p.top === next[i].top && p.left === next[i].left)
          ? prev
          : next
      );
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure);
      // The paginator settles after the edit: look again once it has.
      if (late) clearTimeout(late);
      late = setTimeout(measure, 160);
    };
    schedule();
    editor.on("update", schedule);
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(schedule) : null;
    observer?.observe(editor.view.dom);
    window.addEventListener("resize", schedule);
    return () => {
      cancelAnimationFrame(frame);
      if (late) clearTimeout(late);
      editor.off("update", schedule);
      observer?.disconnect();
      window.removeEventListener("resize", schedule);
    };
  }, [editor, entries, zoom]);

  return (
    <div className="bm-layer" ref={layer} aria-hidden={spots.length ? undefined : true}>
      {editor &&
        spots.map((s) => {
          const e = entries.find((x) => x.bookmark.id === s.id);
          if (!e) return null;
          return (
            <button
              key={s.id}
              type="button"
              className="bm-flag"
              style={{ top: s.top, left: s.left, ["--bm" as string]: bookmarkHex(e.bookmark.color) }}
              title={`${bookmarkTitle(e)} (click to name, recolour or remove)`}
              aria-label={`Bookmark: ${bookmarkTitle(e)}`}
              onMouseDown={(ev) => ev.preventDefault()}
              onClick={(ev) => setEditing({ id: s.id, anchor: ev.currentTarget.getBoundingClientRect() })}
            />
          );
        })}
      {editor && editing && entryById(editor, editing.id) && (
        <Popover anchor={editing.anchor} onClose={() => setEditing(null)} label="Bookmark">
          <BookmarkFields editor={editor} id={editing.id} autoFocus />
          <button
            type="button"
            className="bm-remove"
            onClick={() => {
              const now = entryById(editor, editing.id);
              if (now) editor.commands.removeBookmark(now.pos);
              setEditing(null);
              editor.commands.focus();
            }}
          >
            Remove bookmark
          </button>
        </Popover>
      )}
    </div>
  );
}

/** The status bar's Bookmarks: mark the caret's line, see them all, go to one. */
export function BookmarkControl({
  editor,
  entries,
  pageOf,
}: {
  editor: Editor | null;
  entries: BookmarkEntry[];
  /** The page a position is on, for the list. */
  pageOf?: (pos: number) => number;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [only, setOnly] = useState<BookmarkColor | null>(null);
  if (!editor) return null;
  const from = editor.state.selection.from;
  const here = entries.find((e) => from > e.pos && from < e.end);
  const colours = new Set(entries.map((e) => e.bookmark.color));
  const shown = only && colours.has(only) ? entries.filter((e) => e.bookmark.color === only) : entries;
  const close = () => setOpen(false);
  return (
    <>
      <button
        type="button"
        ref={ref}
        className={"status-bm" + (entries.length ? " status-bm-some" : "")}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={`Bookmarks. ${shortcut()} marks the line you are on`}
      >
        <span className="status-bm-icon" aria-hidden="true" />
        {entries.length ? (
          <>
            {entries.length}
            <span className="sr-only"> bookmarks</span>
          </>
        ) : (
          "Bookmarks"
        )}
      </button>
      {open && ref.current && (
        <Popover anchor={ref.current.getBoundingClientRect()} side="top" onClose={close} label="Bookmarks" className="bm-list-pop">
          <div className="bm-head">
            <strong>Bookmarks</strong>
            <span className="bm-hint">{shortcut()}</span>
          </div>
          {here ? (
            <div className="bm-here">
              <span className="bm-here-label">This line</span>
              <BookmarkFields key={here.bookmark.id} editor={editor} id={here.bookmark.id} />
              <button
                type="button"
                className="bm-remove"
                onClick={() => editor.commands.removeBookmark(here.pos)}
              >
                Remove bookmark
              </button>
            </div>
          ) : (
            <div className="bm-here">
              <span className="bm-here-label">Bookmark the line you are on</span>
              <Swatches
                value={undefined}
                label="Bookmark this line in"
                onPick={(color) => editor.commands.setBookmark({ color })}
              />
            </div>
          )}
          {colours.size > 1 && (
            <div className="bm-filter" role="group" aria-label="Show only">
              <button type="button" className="bm-chip" aria-pressed={!only} onClick={() => setOnly(null)}>
                All
              </button>
              {BOOKMARK_COLORS.filter((c) => colours.has(c.id)).map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className="bm-chip bm-chip-dot"
                  style={{ ["--bm" as string]: c.hex }}
                  aria-pressed={only === c.id}
                  aria-label={`Only ${c.label.toLowerCase()}`}
                  title={`Only ${c.label.toLowerCase()}`}
                  onClick={() => setOnly(only === c.id ? null : c.id)}
                />
              ))}
            </div>
          )}
          {entries.length === 0 ? (
            <p className="bm-empty">
              None yet. Choose a colour above, or press {shortcut()}, to mark the line you are on and come back to it from here.
            </p>
          ) : (
            <ul className="bm-rows">
              {shown.map((e) => (
                <li key={e.bookmark.id} className="bm-row-wrap">
                  <button
                    type="button"
                    className={"bm-row" + (e === here ? " bm-row-here" : "")}
                    onClick={() => {
                      close();
                      jumpToBookmark(editor.view, e.pos);
                    }}
                  >
                    <span className="bm-dot" style={{ ["--bm" as string]: bookmarkHex(e.bookmark.color) }} aria-hidden="true" />
                    <span className="bm-row-text">
                      {bookmarkTitle(e)}
                      {e.bookmark.name.trim() && e.text.trim() ? <span className="bm-row-line">{clip(e.text, 60)}</span> : null}
                    </span>
                    {pageOf ? <span className="bm-row-page">p. {pageOf(e.pos + 1)}</span> : null}
                  </button>
                  <button
                    type="button"
                    className="bm-row-x"
                    aria-label={`Remove bookmark ${bookmarkTitle(e)}`}
                    title="Remove"
                    onClick={() => editor.commands.removeBookmark(e.pos)}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Popover>
      )}
    </>
  );
}
