import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import type { Node as PMNode } from "@tiptap/pm/model";
import type { NSpell } from "nspell";
import { addUserWord } from "./userDictionary";
import type { Outline } from "@/types/screenplay";

/**
 * Screenplay-aware spell check, built as a ProseMirror plugin in the same spirit
 * as the find plugin: all state (the decoration set of underlines) lives in
 * plugin state, and React only renders the suggestion popover when the writer
 * clicks an underline.
 *
 * What makes it screenplay-aware:
 *  - it scans ONLY prose lines (action, dialogue, parenthetical), never scene
 *    headings, character cues, or transitions;
 *  - it never flags character names or locations drawn from the live outline;
 *  - it skips a small allowlist of screenplay terms and the writer's personal
 *    dictionary, and treats all-caps words leniently (FBI, SWAT, emphasis).
 *
 * The dictionary loads lazily on idle, so the editor is fully usable with no
 * underlines until it resolves. Scans are debounced and capped for long scripts.
 */

export interface SpellState {
  open: boolean;
  word: string;
  from: number;
  to: number;
  coords: { left: number; top: number; bottom: number };
  suggestions: string[];
}

interface SpellPluginState {
  deco: DecorationSet;
}

export const spellKey = new PluginKey<SpellPluginState>("screenplaySpell");

/** Words a marketed checker would flag that are correct in a screenplay. */
const SCREENPLAY_TERMS = new Set<string>([
  "intercut",
  "voiceover",
  "offscreen",
  "sotto",
  "beat",
  "prelap",
  "supered",
  "foley",
  "matte",
  "dolly",
  "steadicam",
  "montage",
  "smash",
  "subtitled",
  "reframe",
  "whip",
  "establishing",
]);

const TOKEN = /[A-Za-z][A-Za-z'’-]*/g;
const MAX_MARKS = 2000;

/** Words ignored for this session only (the "Ignore" action). Lowercased. */
const sessionIgnore = new Set<string>();
/** The resolved checker, shared across helpers once the engine loads. */
let speller: NSpell | null = null;
/** Per-view immediate rescan triggers, so the helpers can refresh underlines. */
const viewScanners = new WeakMap<EditorView, () => void>();

/** Lowercased set of every word in the outline's names, so they never flag. */
function buildNameSet(outline: Outline): Set<string> {
  const set = new Set<string>();
  const add = (name: string) => {
    for (const w of name.split(/[^A-Za-z'’]+/)) {
      const lw = w.toLowerCase();
      if (lw.length > 1) set.add(lw);
    }
  };
  for (const c of outline.characters) add(c.name);
  for (const l of outline.locations) add(l.name);
  return set;
}

/** Is this token acceptable, allowing for caps and simple possessives? */
function isAcceptable(sp: NSpell, raw: string): boolean {
  if (sp.correct(raw)) return true;
  const lower = raw.toLowerCase();
  // ALLCAPS or Capitalized words: accept on the lowercased form (FBI, emphasis).
  if (lower !== raw && sp.correct(lower)) return true;
  // Possessive / trailing apostrophe: check the base ("John's" -> "John").
  const base = raw.replace(/['’][A-Za-z]*$/, "");
  if (base && base !== raw && (sp.correct(base) || sp.correct(base.toLowerCase()))) {
    return true;
  }
  return false;
}

/** Build the underline decorations for the whole document. */
function computeDeco(doc: PMNode, sp: NSpell, names: Set<string>): DecorationSet {
  const decos: Decoration[] = [];
  doc.forEach((node, offset) => {
    if (decos.length >= MAX_MARKS) return;
    if (node.type.name !== "screenplayLine") return;
    const el = node.attrs.element as string;
    if (el !== "action" && el !== "dialogue" && el !== "parenthetical") return;
    const text = node.textContent;
    TOKEN.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = TOKEN.exec(text)) !== null && decos.length < MAX_MARKS) {
      const raw = m[0];
      if (raw.length < 2) continue;
      const lw = raw.toLowerCase();
      if (names.has(lw) || SCREENPLAY_TERMS.has(lw) || sessionIgnore.has(lw)) continue;
      if (isAcceptable(sp, raw)) continue;
      const from = offset + 1 + m.index;
      decos.push(Decoration.inline(from, from + raw.length, { class: "spell-mark" }));
    }
  });
  return DecorationSet.create(doc, decos);
}

/**
 * Build the spellcheck extension.
 *  - getOutline: source of character/location names to never flag.
 *  - getSpellerFn: lazy engine loader (resolves the shared NSpell).
 *  - isEnabled: live read of the user's Spelling toggle.
 *  - onSpellState: pushes the popover state to React on click.
 */
export function buildSpellcheck(
  getOutline: () => Outline,
  getSpellerFn: () => Promise<NSpell>,
  isEnabled: () => boolean,
  onSpellState?: (s: SpellState | null) => void
): Extension {
  return Extension.create({
    name: "screenplaySpell",
    addProseMirrorPlugins() {
      let nameSet = new Set<string>();
      let nameSetFor: Outline | null = null;
      const ensureNames = () => {
        const o = getOutline();
        if (o !== nameSetFor) {
          nameSet = buildNameSet(o);
          nameSetFor = o;
        }
        return nameSet;
      };

      const openMenuFor = (view: EditorView, from: number, to: number) => {
        if (!speller) return;
        const word = view.state.doc.textBetween(from, to);
        if (!word) return;
        let coords;
        try {
          const c = view.coordsAtPos(from);
          coords = { left: c.left, top: c.top, bottom: c.bottom };
        } catch {
          return;
        }
        const suggestions = speller.suggest(word).slice(0, 6);
        onSpellState?.({ open: true, word, from, to, coords, suggestions });
      };

      return [
        new Plugin<SpellPluginState>({
          key: spellKey,
          state: {
            init: () => ({ deco: DecorationSet.empty }),
            apply(tr, prev) {
              const meta = tr.getMeta(spellKey) as { deco?: DecorationSet } | undefined;
              if (meta && meta.deco !== undefined) return { deco: meta.deco };
              if (tr.docChanged) return { deco: prev.deco.map(tr.mapping, tr.doc) };
              return prev;
            },
          },
          props: {
            decorations(state) {
              return spellKey.getState(state)?.deco ?? DecorationSet.empty;
            },
            handleClick(view, pos) {
              if (!isEnabled() || !speller) return false;
              const st = spellKey.getState(view.state);
              const hits = st?.deco.find(pos, pos) ?? [];
              if (!hits.length) return false;
              openMenuFor(view, hits[0].from, hits[0].to);
              return false;
            },
            handleDOMEvents: {
              contextmenu(view, event) {
                if (!isEnabled() || !speller) return false;
                const at = view.posAtCoords({ left: event.clientX, top: event.clientY });
                if (!at) return false;
                const st = spellKey.getState(view.state);
                const hits = st?.deco.find(at.pos, at.pos) ?? [];
                if (!hits.length) return false;
                event.preventDefault();
                openMenuFor(view, hits[0].from, hits[0].to);
                return true;
              },
            },
          },
          view(view) {
            let timer: ReturnType<typeof setTimeout> | null = null;

            const scanNow = () => {
              if (!isEnabled()) {
                const cur = spellKey.getState(view.state)?.deco ?? DecorationSet.empty;
                if (cur.find().length) {
                  view.dispatch(
                    view.state.tr
                      .setMeta(spellKey, { deco: DecorationSet.empty })
                      .setMeta("addToHistory", false)
                  );
                }
                return;
              }
              if (!speller) {
                getSpellerFn()
                  .then((s) => {
                    speller = s;
                    if (isEnabled()) scanNow();
                  })
                  .catch(() => {
                    /* leave the editor usable; native fallback stays available */
                  });
                return;
              }
              const deco = computeDeco(view.state.doc, speller, ensureNames());
              view.dispatch(
                view.state.tr.setMeta(spellKey, { deco }).setMeta("addToHistory", false)
              );
            };

            const schedule = () => {
              if (timer) clearTimeout(timer);
              timer = setTimeout(scanNow, 400);
            };

            viewScanners.set(view, scanNow);
            scanNow(); // kicks the lazy engine load when enabled

            return {
              update(_v, prevState) {
                if (view.state.doc !== prevState.doc) schedule();
              },
              destroy() {
                if (timer) clearTimeout(timer);
                viewScanners.delete(view);
              },
            };
          },
        }),
      ];
    },
  });
}

/* --- Imperative helpers, called from the popover ------------------------- */

/** Replace the flagged word with a suggestion, in one undo step. */
export function acceptSpellFix(
  view: EditorView,
  from: number,
  to: number,
  suggestion: string
): void {
  view.dispatch(view.state.tr.insertText(suggestion, from, to));
  viewScanners.get(view)?.();
  view.focus();
}

/** Ignore a word for the rest of this session (clears its underlines now). */
export function ignoreWord(view: EditorView, word: string): void {
  sessionIgnore.add(word.toLowerCase());
  viewScanners.get(view)?.();
  view.focus();
}

/** Add a word to the personal dictionary permanently (clears underlines now). */
export function addWord(view: EditorView, word: string): void {
  addUserWord(word);
  if (speller) speller.add(word);
  viewScanners.get(view)?.();
  view.focus();
}

/** Force an immediate rescan, e.g. when the Spelling toggle flips. */
export function rescanSpelling(view: EditorView): void {
  viewScanners.get(view)?.();
}
