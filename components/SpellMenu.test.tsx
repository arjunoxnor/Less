// @vitest-environment jsdom

import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EditorView } from "@tiptap/pm/view";
import type { SpellState } from "@/lib/editor/spellcheck";
import { SpellMenu } from "./SpellMenu";

/**
 * The spelling popover opens on a PLAIN LEFT CLICK on an underlined word, so
 * two things have to hold at once: it must never pull DOM focus out of the
 * document (the writer is still typing), and the two word-level actions must
 * keep working while the document changes underneath it (the writer types, or a
 * Duet collaborator does).
 */

const spell = vi.hoisted(() => ({
  acceptSpellFix: vi.fn(),
  ignoreWord: vi.fn(),
  addWord: vi.fn(),
}));

vi.mock("@/lib/editor/spellcheck", () => spell);

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;
/** Stands in for the editor's contenteditable: where focus must stay. */
let caretHolder: HTMLDivElement | null = null;

/**
 * A fake EditorView with just the surface SpellMenu touches. `retype` swaps in a
 * NEW doc object, the way any real transaction does, so the tests can tell the
 * difference between "the document changed" and "the range no longer holds the
 * word it was opened for".
 */
function makeView(text: string) {
  const makeDoc = (t: string) => ({
    textBetween: (from: number, to: number) => t.slice(from, to),
  });
  const view = {
    state: { doc: makeDoc(text) },
    focus: vi.fn(),
    dispatch: vi.fn(),
  };
  return {
    view: view as unknown as EditorView,
    retype(next: string) {
      view.state = { doc: makeDoc(next) };
    },
  };
}

function stateFor(word: string, suggestions: string[]): SpellState {
  return {
    open: true,
    word,
    from: 0,
    to: word.length,
    coords: { left: 40, top: 100, bottom: 118 },
    suggestions,
  };
}

async function render(node: ReactElement) {
  await act(async () => {
    root?.render(node);
  });
}

function items(): HTMLButtonElement[] {
  return Array.from(host?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []);
}

beforeEach(() => {
  spell.acceptSpellFix.mockClear();
  spell.ignoreWord.mockClear();
  spell.addWord.mockClear();
  host = document.createElement("div");
  caretHolder = document.createElement("div");
  caretHolder.tabIndex = 0;
  document.body.append(caretHolder, host);
  caretHolder.focus();
  root = createRoot(host);
});

afterEach(() => {
  if (root) act(() => root?.unmount());
  root = null;
  host?.remove();
  host = null;
  caretHolder?.remove();
  caretHolder = null;
});

describe("SpellMenu focus", () => {
  it("does not take focus when it opens, so typing keeps landing in the document", async () => {
    const { view } = makeView("teh");
    await render(
      <SpellMenu state={stateFor("teh", ["the", "tea"])} view={view} onClose={() => {}} />
    );
    expect(items()).toHaveLength(4);
    expect(document.activeElement).toBe(caretHolder);
    expect(host?.contains(document.activeElement)).toBe(false);
  });

  it("does not take focus when the pointer moves over an item", async () => {
    const { view } = makeView("teh");
    await render(
      <SpellMenu state={stateFor("teh", ["the", "tea"])} view={view} onClose={() => {}} />
    );
    const first = items()[0];
    await act(async () => {
      first.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
      first.dispatchEvent(new MouseEvent("mouseenter", { bubbles: false }));
    });
    expect(document.activeElement).toBe(caretHolder);
  });

  it("exposes exactly one tab stop and moves it with the arrow keys once focus is inside", async () => {
    const { view } = makeView("teh");
    await render(
      <SpellMenu state={stateFor("teh", ["the", "tea"])} view={view} onClose={() => {}} />
    );
    const menuItems = items();
    expect(menuItems.map((b) => b.tabIndex)).toEqual([0, -1, -1, -1]);

    // Only once the writer has actually reached the menu does it move focus.
    await act(async () => {
      menuItems[0].focus();
      menuItems[0].dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })
      );
    });
    expect(document.activeElement).toBe(items()[1]);
    expect(items().map((b) => b.tabIndex)).toEqual([-1, 0, -1, -1]);
  });
});

describe("SpellMenu staleness", () => {
  it("replaces the word when the range still holds it, even after other edits", async () => {
    const onClose = vi.fn();
    const { view, retype } = makeView("teh");
    await render(
      <SpellMenu state={stateFor("teh", ["the"])} view={view} onClose={onClose} />
    );
    // A collaborator typed elsewhere: brand new doc object, same target range.
    retype("teh");
    await act(async () => {
      items()[0].click();
    });
    expect(spell.acceptSpellFix).toHaveBeenCalledWith(view, 0, 3, "the");
    expect(onClose).toHaveBeenCalled();
  });

  it("refuses to replace when the range no longer holds the word", async () => {
    const onClose = vi.fn();
    const { view, retype } = makeView("teh");
    await render(
      <SpellMenu state={stateFor("teh", ["the"])} view={view} onClose={onClose} />
    );
    retype("xyz");
    await act(async () => {
      items()[0].click();
    });
    expect(spell.acceptSpellFix).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("still ignores and still adds to the dictionary after the document changed", async () => {
    const onClose = vi.fn();
    const { view, retype } = makeView("teh");
    await render(
      <SpellMenu state={stateFor("teh", ["the"])} view={view} onClose={onClose} />
    );
    // The whole target line is gone; Ignore and Add never needed positions.
    retype("");
    await act(async () => {
      items()[1].click();
    });
    expect(spell.ignoreWord).toHaveBeenCalledWith(view, "teh");

    await render(
      <SpellMenu state={stateFor("teh", ["the"])} view={view} onClose={onClose} />
    );
    await act(async () => {
      items()[2].click();
    });
    expect(spell.addWord).toHaveBeenCalledWith(view, "teh");
  });
});
