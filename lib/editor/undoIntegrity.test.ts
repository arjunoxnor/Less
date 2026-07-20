import { describe, it, expect, afterEach } from "vitest";
import type { Editor } from "@tiptap/core";
import { closeHistory } from "@tiptap/pm/history";
import { acceptAutocomplete, autocompleteKey } from "./autocomplete";
import { runEnterFlow } from "./keymap";
import { EMPTY_OUTLINE } from "./outline";
import { docOf, line, linesOf, makeEditor, typeText } from "./testKit";

/**
 * The B1 property test: undo must only ever visit document states that
 * actually existed. Before the fix, the auto-behaviors (AutoElement's slug
 * conversion, AutoCaps' uppercase rewrite, the two-dispatch autocomplete
 * Enter-accept) were hidden from history with addToHistory:false, so undo's
 * inverse steps applied against a drifted document and composed garbage: the
 * live repro ended on a cue line reading "ANINT. B", text that was never
 * typed. This drives that exact scripted sequence and asserts every state
 * reached while undoing is one of the recorded snapshots, in reverse order.
 */

// An outline stub whose cast offers ANNA, so typing "an" on a cue opens the
// autocomplete with a real candidate (the live repro's setup).
const OUTLINE = {
  ...EMPTY_OUTLINE,
  characters: [{ name: "ANNA", lines: 3, lastIndex: 0 }],
};

let editor: Editor | null = null;
afterEach(() => {
  editor?.destroy();
  editor = null;
});

/**
 * The shared property: undo to the bottom, asserting that every state undo
 * lands on IS one of the recorded snapshots, that they come back in strictly
 * reverse order (history may group adjacent keystrokes, so not every snapshot
 * re-appears), and that the walk terminates on the initial document.
 */
function undoWalk(ed: Editor, snapshots: string[]) {
  let lastIndex = snapshots.length - 1;
  for (let guard = 0; guard < 200 && ed.commands.undo(); guard++) {
    const cur = JSON.stringify(ed.getJSON());
    const at = snapshots.lastIndexOf(cur, lastIndex - 1);
    expect(at, `undo landed on a state that never existed: ${cur}`).toBeGreaterThanOrEqual(0);
    expect(at).toBeLessThan(lastIndex);
    lastIndex = at;
  }
  expect(JSON.stringify(ed.getJSON())).toBe(snapshots[0]);
}

/** Deterministic PRNG (mulberry32) so the 20 randomized runs are seeded. */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("undo inverse-consistency (B1)", () => {
  it("the scripted sequence undoes through recorded states only, no phantom text", () => {
    const ed = (editor = makeEditor(docOf(line("character", "")), OUTLINE));
    ed.commands.setTextSelection(1);

    const snapshots: string[] = [];
    const snap = () => snapshots.push(JSON.stringify(ed.getJSON()));
    const noPhantom = () => {
      for (const l of linesOf(ed)) expect(l.text).not.toContain("ANINT");
    };
    snap();

    // Type "an" on the cue (AutoCaps uppercases each keystroke).
    for (const ch of "an") {
      typeText(ed, ch);
      noPhantom();
      snap();
    }

    // The autocomplete is open and offers ANNA; accept with the Enter path
    // (one dispatched transaction: accept + split + dialogue line).
    const st = autocompleteKey.getState(ed.state);
    expect(st?.open).toBe(true);
    const idx = st!.items.findIndex((i) => i.text === "ANNA");
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(acceptAutocomplete(ed.view, idx, { enterFlow: true })).toBe(true);
    noPhantom();
    snap();
    expect(linesOf(ed)).toEqual([
      { element: "character", text: "ANNA", dual: false, note: "" },
      { element: "dialogue", text: "", dual: false, note: "" },
    ]);

    // Enter on the empty dialogue converts it in place to action (B3), then
    // Enter on the empty action splits a fresh action line.
    runEnterFlow(ed);
    noPhantom();
    snap();
    runEnterFlow(ed);
    noPhantom();
    snap();

    // Type "int. b": AutoElement converts the line to a scene heading at
    // "int." and AutoCaps uppercases it.
    for (const ch of "int. b") {
      typeText(ed, ch);
      noPhantom();
      snap();
    }
    expect(linesOf(ed)).toEqual([
      { element: "character", text: "ANNA", dual: false, note: "" },
      { element: "action", text: "", dual: false, note: "" },
      { element: "scene_heading", text: "INT. B", dual: false, note: "" },
    ]);

    // Undo to the bottom (see undoWalk for the property), checking for the
    // live repro's phantom text at every step on the way down.
    let lastIndex = snapshots.length - 1;
    for (let guard = 0; guard < 50 && ed.commands.undo(); guard++) {
      noPhantom();
      const cur = JSON.stringify(ed.getJSON());
      const at = snapshots.lastIndexOf(cur, lastIndex - 1);
      expect(at, `undo landed on a state that never existed: ${cur}`).toBeGreaterThanOrEqual(0);
      expect(at).toBeLessThan(lastIndex);
      lastIndex = at;
    }
    expect(JSON.stringify(ed.getJSON())).toBe(snapshots[0]);
  });

  it("undoing an accepted transition on an action line restores the typed text in one step", () => {
    // The other single-transaction accept path: a transition typed in caps on
    // an action line retypes the line when accepted. One undo must restore
    // both the text and the element together.
    const ed = (editor = makeEditor(docOf(line("action", "")), OUTLINE));
    ed.commands.setTextSelection(1);
    typeText(ed, "CUT");
    // Close the current undo group so the accept records as its own event
    // (in the app, typing and accepting are separated by real time).
    ed.view.dispatch(closeHistory(ed.state.tr));
    const st = autocompleteKey.getState(ed.state);
    expect(st?.open).toBe(true);
    const idx = st!.items.findIndex((i) => i.text === "CUT TO:");
    expect(idx).toBeGreaterThanOrEqual(0);
    acceptAutocomplete(ed.view, idx);
    expect(linesOf(ed)).toEqual([
      { element: "transition", text: "CUT TO:", dual: false, note: "" },
    ]);
    expect(ed.commands.undo()).toBe(true);
    const l = linesOf(ed)[0];
    expect(l.element).toBe("action");
    expect(l.text).toBe("CUT");
  });
});

/**
 * The second half of the Part 3.1 B1 test: the same property over 20
 * randomized short sequences, seeded so every run is reproducible. The action
 * pool deliberately mixes the triggers of every auto-behavior: characters
 * that form slug openers ("int.", "ext.") and cast prefixes ("an" opens the
 * ANNA autocomplete on a cue), the Enter flow (empty-line conversion and
 * splits), autocomplete accepts through both dispatch paths, and setElement
 * retypes. Whatever interleaving a seed produces, undo must only ever visit
 * document states that actually existed.
 */
describe("undo inverse-consistency (B1), randomized", () => {
  const CHARS = "aninte. xcu";
  const ELEMENTS = [
    "action",
    "character",
    "dialogue",
    "parenthetical",
    "scene_heading",
    "transition",
  ] as const;

  for (let seed = 1; seed <= 20; seed++) {
    it(`seeded sequence ${seed} undoes through recorded states only`, () => {
      const rng = mulberry32(seed * 0x9e3779b9);
      const ed = (editor = makeEditor(docOf(line("action", "")), OUTLINE));
      ed.commands.setTextSelection(1);
      const snapshots = [JSON.stringify(ed.getJSON())];
      const steps = 8 + Math.floor(rng() * 8);
      for (let s = 0; s < steps; s++) {
        const roll = rng();
        if (roll < 0.55) {
          typeText(ed, CHARS[Math.floor(rng() * CHARS.length)]);
        } else if (roll < 0.7) {
          runEnterFlow(ed);
        } else if (roll < 0.85) {
          const st = autocompleteKey.getState(ed.state);
          if (st?.open && st.items.length > 0) {
            acceptAutocomplete(ed.view, Math.floor(rng() * st.items.length), {
              enterFlow: rng() < 0.5,
            });
          } else {
            runEnterFlow(ed);
          }
        } else {
          ed.commands.setElement(
            ELEMENTS[Math.floor(rng() * ELEMENTS.length)]
          );
        }
        snapshots.push(JSON.stringify(ed.getJSON()));
      }
      undoWalk(ed, snapshots);
    });
  }
});
