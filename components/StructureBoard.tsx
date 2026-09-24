"use client";

import { memo, useEffect, useMemo, useRef, useState } from "react";
import type { Editor } from "@tiptap/core";
import {
  buildSceneCards,
  formatEighths,
  storylinesOf,
  type SceneCardData,
  type StorylineEntry,
} from "@/lib/editor/sceneCards";
import { moveSceneTr, sceneIndexAfterMove } from "@/lib/editor/sceneMove";
import { MAX_STORYLINE_LENGTH, MAX_SYNOPSIS_LENGTH } from "@/lib/editor/sceneAttrs";
import {
  nextStorylineColor,
  setSceneCardTr,
  STORYLINE_COLORS,
  updateStorylineTr,
} from "@/lib/editor/storylines";
import { beginPointerDrag, gridSlotAt } from "@/lib/ui/pointerDrag";
import { DotsIcon } from "./chrome/icons";
import { Menu, type MenuItem } from "./ui/Menu";
import { Modal } from "./ui/Modal";

/**
 * The structure board: the script as index cards, one per scene, in order.
 *
 * Drag a card to move the whole scene; everything else on the board is a way
 * of seeing the shape of the script. Each card can wear a storyline (a plot
 * line, a timeline) with its color, and carry a one-line summary. The board is
 * a layer over the page, not a second copy of the script: every change is an
 * ordinary edit of the document underneath, undoable like any other.
 */

const COLOR_NAMES: Record<string, string> = {
  "#378add": "Blue",
  "#ba7517": "Amber",
  "#3fa663": "Green",
  "#c45fb8": "Magenta",
  "#e0533b": "Red",
  "#1d9e75": "Teal",
  "#7f77dd": "Purple",
  "#e08a2e": "Orange",
};

/** Rebuild the cards on every change to the script, at most once a frame. */
function useSceneCards(editor: Editor): SceneCardData[] {
  const [cards, setCards] = useState(() => buildSceneCards(editor.state.doc));
  useEffect(() => {
    let frame = 0;
    const rebuild = () => {
      frame = 0;
      if (!editor.isDestroyed) setCards(buildSceneCards(editor.state.doc));
    };
    const onTransaction = ({ transaction }: { transaction: { docChanged: boolean } }) => {
      if (!transaction.docChanged || frame) return;
      frame = requestAnimationFrame(rebuild);
    };
    editor.on("transaction", onTransaction);
    rebuild();
    return () => {
      editor.off("transaction", onTransaction);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [editor]);
  return cards;
}

type Dialog =
  | { kind: "new-storyline"; headingPos: number }
  | { kind: "rename-storyline"; name: string };

export function StructureBoard({
  editor,
  pageCount,
  initialScene = 0,
  onOpenScene,
}: {
  editor: Editor;
  /** The script's length as the page shows it (the real pagination). */
  pageCount: number;
  /** The scene to start on: the one the writer was in. */
  initialScene?: number;
  /** Open the script at this scene heading. */
  onOpenScene: (headingPos: number) => void;
}) {
  const cards = useSceneCards(editor);
  const storylines = useMemo(() => storylinesOf(cards), [cards]);
  const [filter, setFilter] = useState<string | null>(null);
  const [selected, setSelected] = useState(Math.max(0, initialScene));
  const [editing, setEditing] = useState<number | null>(null);
  const [menu, setMenu] = useState<
    | null
    | { kind: "card" | "storyline"; index: number; anchor: DOMRect }
    | { kind: "legend"; name: string; anchor: DOMRect }
  >(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [drag, setDrag] = useState<{ from: number; slot: number | null } | null>(null);
  const [marker, setMarker] = useState<{ left: number; top: number; height: number } | null>(null);
  const [announcement, setAnnouncement] = useState("");

  const scrollerRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const cardEls = useRef(new Map<number, HTMLElement>());
  // The authority during a drag; the state above only draws it.
  const dragRef = useRef<{ from: number; slot: number | null } | null>(null);

  // A storyline that no scene wears any more is no longer a filter.
  useEffect(() => {
    if (filter && !storylines.some((s) => s.name === filter)) setFilter(null);
  }, [filter, storylines]);

  const visible = useMemo(
    () => (filter ? cards.filter((c) => c.storyline === filter) : cards),
    [cards, filter]
  );
  // A scene's position moves with every edit above it. Heading plus
  // occurrence keeps a card the same card when scenes move around it.
  const keys = useMemo(() => {
    const seen = new Map<string, number>();
    return cards.map((card) => {
      const n = seen.get(card.heading) ?? 0;
      seen.set(card.heading, n + 1);
      return `${card.heading}\u0000${n}`;
    });
  }, [cards]);

  useEffect(() => {
    if (selected >= cards.length && cards.length) setSelected(cards.length - 1);
  }, [cards.length, selected]);

  const focusCard = (index: number) => {
    setSelected(index);
    requestAnimationFrame(() => cardEls.current.get(index)?.focus({ preventScroll: false }));
  };

  // Focus the board on arrival, on the scene the writer was last in.
  useEffect(() => {
    const el = cardEls.current.get(selected) ?? scrollerRef.current;
    el?.focus({ preventScroll: true });
    cardEls.current.get(selected)?.scrollIntoView({ block: "center" });
    // Only on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---- Edits ---- */

  const move = (from: number, slot: number) => {
    const tr = moveSceneTr(editor.state, from, slot);
    if (!tr) return;
    editor.view.dispatch(tr);
    const to = sceneIndexAfterMove(from, slot);
    setAnnouncement(`Scene ${from + 1} moved to position ${to + 1}.`);
    focusCard(to);
  };

  const setCard = (index: number, patch: { storyline?: string; color?: string; synopsis?: string }) => {
    const card = cards[index];
    if (!card) return;
    const tr = setSceneCardTr(editor.state, card.headingPos, patch);
    if (tr) editor.view.dispatch(tr);
  };

  const assignStoryline = (index: number, entry: StorylineEntry | null) => {
    setCard(index, entry ? { storyline: entry.name, color: entry.color } : { storyline: "", color: "" });
  };

  const updateStoryline = (name: string, change: { name?: string; color?: string }) => {
    const tr = updateStorylineTr(editor.state, name, change);
    if (tr) editor.view.dispatch(tr);
    if (change.name !== undefined && filter === name) setFilter(change.name.trim() || null);
  };

  /* ---- Drag ---- */

  /** A slot among the visible cards, as a slot among all the scenes. */
  const sceneSlot = (visibleSlot: number): number => {
    if (visibleSlot < visible.length) return visible[visibleSlot].index;
    const last = visible[visible.length - 1];
    return last ? last.index + 1 : cards.length;
  };

  const placeMarker = (visibleSlot: number) => {
    const grid = gridRef.current;
    if (!grid) return setMarker(null);
    const gridRect = grid.getBoundingClientRect();
    const before = visible[visibleSlot] ? cardEls.current.get(visible[visibleSlot].index) : undefined;
    const after = visible[visibleSlot - 1] ? cardEls.current.get(visible[visibleSlot - 1].index) : undefined;
    // In the gap before the card it lands in front of; at the end of a row
    // (or the list), just after the card it follows.
    const rect = before?.getBoundingClientRect();
    const prev = after?.getBoundingClientRect();
    if (rect && (!prev || Math.abs(prev.top - rect.top) < 4)) {
      setMarker({ left: rect.left - gridRect.left - 9.5, top: rect.top - gridRect.top, height: rect.height });
    } else if (prev) {
      setMarker({ left: prev.right - gridRect.left + 6.5, top: prev.top - gridRect.top, height: prev.height });
    } else {
      setMarker(null);
    }
  };

  const startDrag = (event: React.PointerEvent, index: number) => {
    const target = event.target as HTMLElement;
    if (target.closest("button, textarea, input, a")) return;
    const source = cardEls.current.get(index);
    if (!source || editing !== null) return;
    setSelected(index);
    beginPointerDrag(event.nativeEvent, {
      source,
      scroller: scrollerRef.current,
      ghost: (el) => {
        const copy = el.cloneNode(true) as HTMLElement;
        copy.classList.remove("is-selected");
        return copy;
      },
      onStart: () => {
        dragRef.current = { from: index, slot: null };
        setDrag(dragRef.current);
      },
      onMove: ({ x, y }) => {
        const els = visible.map((c) => cardEls.current.get(c.index)).filter(Boolean) as HTMLElement[];
        const visibleSlot = gridSlotAt(els, x, y);
        const scene = sceneSlot(visibleSlot);
        const slot = scene === index || scene === index + 1 ? null : scene;
        // The marker follows the page as it scrolls, so it is placed on every
        // move; the cards only re-render when the landing place changes.
        if (slot === null) setMarker(null);
        else placeMarker(visibleSlot);
        if (dragRef.current?.slot !== slot) {
          dragRef.current = { from: index, slot };
          setDrag(dragRef.current);
        }
      },
      onDrop: () => {
        const done = dragRef.current;
        dragRef.current = null;
        setDrag(null);
        setMarker(null);
        if (done?.slot != null) move(done.from, done.slot);
      },
      onCancel: () => {
        dragRef.current = null;
        setDrag(null);
        setMarker(null);
      },
    });
  };

  /* ---- Keyboard ---- */

  const neighbourInRow = (index: number, direction: 1 | -1): number | null => {
    const at = visible.findIndex((c) => c.index === index);
    const here = cardEls.current.get(index)?.getBoundingClientRect();
    if (at < 0 || !here) return null;
    let best: { index: number; distance: number } | null = null;
    for (const card of visible) {
      const rect = cardEls.current.get(card.index)?.getBoundingClientRect();
      if (!rect) continue;
      const rowStep = direction > 0 ? rect.top > here.bottom - 4 : rect.bottom < here.top + 4;
      if (!rowStep) continue;
      const rowDistance = Math.abs(rect.top - here.top);
      const distance = rowDistance * 10 + Math.abs(rect.left - here.left);
      if (!best || distance < best.distance) best = { index: card.index, distance };
    }
    return best?.index ?? null;
  };

  const onCardKey = (event: React.KeyboardEvent, card: SceneCardData) => {
    if (event.target !== event.currentTarget) return;
    const at = visible.findIndex((c) => c.index === card.index);
    const mod = event.metaKey || event.ctrlKey;
    if (mod && event.key.toLowerCase() === "z") {
      event.preventDefault();
      if (event.shiftKey) editor.commands.redo();
      else editor.commands.undo();
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      onOpenScene(card.headingPos);
      return;
    }
    const earlier = event.key === "ArrowLeft" || event.key === "ArrowUp";
    const later = event.key === "ArrowRight" || event.key === "ArrowDown";
    if (!earlier && !later) return;
    event.preventDefault();
    if (event.altKey) {
      // Move the scene one place among what is shown.
      if (earlier && at > 0) move(card.index, visible[at - 1].index);
      if (later && at < visible.length - 1) move(card.index, visible[at + 1].index + 1);
      return;
    }
    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      const next = neighbourInRow(card.index, event.key === "ArrowDown" ? 1 : -1);
      if (next !== null) focusCard(next);
      return;
    }
    const next = visible[at + (later ? 1 : -1)];
    if (next) focusCard(next.index);
  };

  /* ---- Menus ---- */

  const cardMenu = (index: number): MenuItem[] => {
    const at = visible.findIndex((c) => c.index === index);
    return [
      { label: "Open in the script", hint: "Enter", onSelect: () => onOpenScene(cards[index].headingPos) },
      { label: cards[index].synopsis ? "Edit summary" : "Add a summary", onSelect: () => setEditing(index) },
      { kind: "divider" },
      {
        label: "Move earlier",
        hint: "Alt ←",
        disabled: at <= 0,
        onSelect: () => at > 0 && move(index, visible[at - 1].index),
      },
      {
        label: "Move later",
        hint: "Alt →",
        disabled: at < 0 || at >= visible.length - 1,
        onSelect: () => at < visible.length - 1 && move(index, visible[at + 1].index + 1),
      },
    ];
  };

  const storylineMenu = (index: number): MenuItem[] => {
    const card = cards[index];
    return [
      { kind: "label", label: "Storyline" },
      ...storylines.map(
        (s): MenuItem => ({
          kind: "radio",
          group: "storyline",
          label: s.name,
          swatch: s.color,
          checked: card.storyline === s.name,
          onSelect: () => assignStoryline(index, s),
        })
      ),
      {
        kind: "radio",
        group: "storyline",
        label: "None",
        swatch: "",
        checked: !card.storyline,
        onSelect: () => assignStoryline(index, null),
      },
      { kind: "divider" },
      { label: "New storyline…", onSelect: () => setDialog({ kind: "new-storyline", headingPos: card.headingPos }) },
    ];
  };

  const legendMenu = (name: string): MenuItem[] => {
    const entry = storylines.find((s) => s.name === name);
    return [
      filter === name
        ? { label: "Show every scene", onSelect: () => setFilter(null) }
        : { label: "Show only these scenes", onSelect: () => setFilter(name) },
      { label: "Rename…", onSelect: () => setDialog({ kind: "rename-storyline", name }) },
      { kind: "divider" },
      { kind: "label", label: "Color" },
      ...STORYLINE_COLORS.map(
        (color): MenuItem => ({
          kind: "radio",
          group: "color",
          label: COLOR_NAMES[color] ?? color,
          swatch: color,
          checked: entry?.color === color,
          onSelect: () => updateStoryline(name, { color }),
        })
      ),
      { kind: "divider" },
      {
        label: "Remove from every scene",
        danger: true,
        onSelect: () => updateStoryline(name, { name: "" }),
      },
    ];
  };

  /* ---- Render ---- */

  return (
    <div
      ref={scrollerRef}
      className={"sb-root" + (drag ? " is-dragging-card" : "")}
      tabIndex={-1}
      aria-label="Structure board"
    >
      <div className="sb-inner">
        <header className="sb-head">
          <div className="sb-count">
            {cards.length} {cards.length === 1 ? "scene" : "scenes"}
            <span className="sb-sep" aria-hidden="true">·</span>
            {pageCount} {pageCount === 1 ? "page" : "pages"}
          </div>
          {storylines.length > 0 ? (
            <div className="sb-legend" role="group" aria-label="Storylines">
              {storylines.map((s) => (
                <button
                  key={s.name}
                  type="button"
                  className={
                    "sb-legend-item" +
                    (filter === s.name ? " is-on" : "") +
                    (filter && filter !== s.name ? " is-off" : "")
                  }
                  style={{ ["--story-color" as string]: s.color || "var(--faint)" }}
                  aria-haspopup="menu"
                  onClick={(e) =>
                    setMenu({ kind: "legend", name: s.name, anchor: e.currentTarget.getBoundingClientRect() })
                  }
                >
                  <span className="sb-dot" aria-hidden="true" />
                  {s.name}
                  <span className="sb-legend-count">{s.scenes}</span>
                </button>
              ))}
              {filter && (
                <button type="button" className="sb-legend-clear" onClick={() => setFilter(null)}>
                  Show all
                </button>
              )}
            </div>
          ) : (
            cards.length > 0 && (
              <p className="sb-hint">
                Give scenes a storyline with the dot on each card, to color and filter them.
              </p>
            )
          )}
        </header>

        {cards.length === 0 ? (
          <div className="sb-empty">
            <p>No scenes yet.</p>
            <p className="sb-empty-sub">Every scene heading in the script becomes a card here.</p>
          </div>
        ) : (
          <div ref={gridRef} className="sb-grid" role="list">
            {visible.map((card) => (
              <SceneCard
                key={keys[card.index]}
                card={card}
                selected={selected === card.index}
                lifted={drag?.from === card.index}
                editing={editing === card.index}
                register={(el) => {
                  if (el) cardEls.current.set(card.index, el);
                  else cardEls.current.delete(card.index);
                }}
                onPointerDown={(e) => startDrag(e, card.index)}
                onFocus={() => setSelected(card.index)}
                onOpen={() => onOpenScene(card.headingPos)}
                onKeyDown={(e) => onCardKey(e, card)}
                onStorylineMenu={(anchor) => setMenu({ kind: "storyline", index: card.index, anchor })}
                onCardMenu={(anchor) => setMenu({ kind: "card", index: card.index, anchor })}
                onEditSummary={() => setEditing(card.index)}
                onCommitSummary={(text) => {
                  setEditing(null);
                  if (text !== null) setCard(card.index, { synopsis: text });
                  focusCard(card.index);
                }}
              />
            ))}
            {marker && (
              <div
                className="sb-drop"
                style={{ left: marker.left, top: marker.top, height: marker.height }}
                aria-hidden="true"
              />
            )}
          </div>
        )}
      </div>

      <div className="sr-only" role="status" aria-live="polite">
        {announcement}
      </div>

      {menu?.kind === "card" && cards[menu.index] && (
        <Menu anchor={menu.anchor} items={cardMenu(menu.index)} onClose={() => setMenu(null)} ariaLabel="Scene" />
      )}
      {menu?.kind === "storyline" && cards[menu.index] && (
        <Menu
          anchor={menu.anchor}
          items={storylineMenu(menu.index)}
          onClose={() => setMenu(null)}
          ariaLabel="Storyline"
        />
      )}
      {menu?.kind === "legend" && (
        <Menu
          anchor={menu.anchor}
          items={legendMenu(menu.name)}
          onClose={() => setMenu(null)}
          ariaLabel={menu.name}
        />
      )}

      {dialog && (
        <StorylineDialog
          title={dialog.kind === "new-storyline" ? "New storyline" : "Rename storyline"}
          initial={dialog.kind === "rename-storyline" ? dialog.name : ""}
          confirm={dialog.kind === "new-storyline" ? "Add" : "Rename"}
          taken={storylines
            .map((s) => s.name)
            .filter((n) => dialog.kind !== "rename-storyline" || n !== dialog.name)}
          onClose={() => setDialog(null)}
          onSave={(name) => {
            if (dialog.kind === "new-storyline") {
              const index = cards.findIndex((c) => c.headingPos === dialog.headingPos);
              const existing = storylines.find((s) => s.name === name);
              const color = existing?.color || nextStorylineColor(storylines.map((s) => s.color));
              if (index >= 0) setCard(index, { storyline: name, color });
            } else {
              updateStoryline(dialog.name, { name });
            }
            setDialog(null);
          }}
        />
      )}
    </div>
  );
}

const SceneCard = memo(function SceneCard({
  card,
  selected,
  lifted,
  editing,
  register,
  onPointerDown,
  onFocus,
  onOpen,
  onKeyDown,
  onStorylineMenu,
  onCardMenu,
  onEditSummary,
  onCommitSummary,
}: {
  card: SceneCardData;
  selected: boolean;
  lifted: boolean;
  editing: boolean;
  register: (el: HTMLElement | null) => void;
  onPointerDown: (e: React.PointerEvent) => void;
  onFocus: () => void;
  onOpen: () => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  onStorylineMenu: (anchor: DOMRect) => void;
  onCardMenu: (anchor: DOMRect) => void;
  onEditSummary: () => void;
  /** The new summary, or null to leave it as it was. */
  onCommitSummary: (text: string | null) => void;
}) {
  const heading = card.heading || "Untitled scene";
  return (
    <article
      ref={register}
      className={
        "sb-card" +
        (selected ? " is-selected" : "") +
        (lifted ? " is-lifted" : "") +
        (card.color ? " has-story" : "")
      }
      style={card.color ? { ["--story-color" as string]: card.color } : undefined}
      role="listitem"
      tabIndex={selected ? 0 : -1}
      aria-label={`Scene ${card.index + 1}. ${heading}${card.storyline ? `. ${card.storyline}` : ""}`}
      onPointerDown={onPointerDown}
      onFocus={onFocus}
      onDoubleClick={(e) => {
        if ((e.target as HTMLElement).closest("button, textarea")) return;
        onOpen();
      }}
      onKeyDown={onKeyDown}
    >
      <div className="sb-top">
        <span className="sb-num">{card.index + 1}</span>
        <button
          type="button"
          className={"sb-pill" + (card.storyline ? "" : " is-empty")}
          aria-haspopup="menu"
          aria-label={card.storyline ? `Storyline: ${card.storyline}` : "Choose a storyline"}
          title={card.storyline ? "Storyline" : "Choose a storyline"}
          onClick={(e) => onStorylineMenu(e.currentTarget.getBoundingClientRect())}
        >
          <span className="sb-dot" aria-hidden="true" />
          {card.storyline && <span className="sb-pill-name">{card.storyline}</span>}
        </button>
        <button
          type="button"
          className="sb-kebab"
          aria-haspopup="menu"
          aria-label={`Actions for scene ${card.index + 1}`}
          onClick={(e) => onCardMenu(e.currentTarget.getBoundingClientRect())}
        >
          <DotsIcon />
        </button>
      </div>

      <div className="sb-heading">{heading}</div>

      {editing ? (
        <SummaryField initial={card.synopsis} onDone={onCommitSummary} />
      ) : card.synopsis ? (
        <p className="sb-body">{card.synopsis}</p>
      ) : card.preview ? (
        <p className="sb-body is-preview">{card.preview}</p>
      ) : (
        <button type="button" className="sb-add-summary" onClick={onEditSummary}>
          Add a summary
        </button>
      )}

      <div className="sb-foot">
        <span className="sb-cast" title={card.characters.join(", ")}>
          {card.characters.join(", ")}
        </span>
        <span className="sb-len" title="Length in eighths of a page">
          {formatEighths(card.eighths)}
        </span>
      </div>
    </article>
  );
});

function SummaryField({
  initial,
  onDone,
}: {
  initial: string;
  onDone: (text: string | null) => void;
}) {
  const [value, setValue] = useState(initial);
  const ref = useRef<HTMLTextAreaElement>(null);
  const done = useRef(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);
  const finish = (text: string | null) => {
    if (done.current) return;
    done.current = true;
    onDone(text);
  };
  return (
    <textarea
      ref={ref}
      className="sb-summary-field"
      value={value}
      rows={3}
      maxLength={MAX_SYNOPSIS_LENGTH}
      placeholder="What happens in this scene"
      aria-label="Scene summary"
      onChange={(e) => setValue(e.target.value)}
      onPointerDown={(e) => e.stopPropagation()}
      onBlur={() => finish(value)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          finish(value);
        } else if (e.key === "Escape") {
          e.preventDefault();
          finish(null);
        }
      }}
    />
  );
}

function StorylineDialog({
  title,
  initial,
  confirm,
  taken,
  onClose,
  onSave,
}: {
  title: string;
  initial: string;
  confirm: string;
  taken: string[];
  onClose: () => void;
  onSave: (name: string) => void;
}) {
  const [name, setName] = useState(initial);
  const clean = name.trim();
  const clash = clean !== "" && taken.includes(clean) && confirm !== "Add";
  const save = () => {
    if (!clean || clash) return;
    onSave(clean);
  };
  return (
    <Modal
      title={title}
      onClose={onClose}
      actions={[
        { label: "Cancel", onClick: onClose },
        { label: confirm, variant: "solid", disabled: !clean || clash, onClick: save },
      ]}
    >
      <label className="field">
        <span>Name</span>
        <input
          value={name}
          maxLength={MAX_STORYLINE_LENGTH}
          placeholder="Present, Flashback, B story"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              save();
            }
          }}
        />
      </label>
      {clash && <p className="modal-error">Another storyline already has that name.</p>}
    </Modal>
  );
}
