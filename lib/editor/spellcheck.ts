import { Extension, getChangedRanges } from "@tiptap/core";
import { Plugin, PluginKey, type Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import type { Node as PMNode } from "@tiptap/pm/model";
import type { NSpell } from "nspell";
import { addUserWord } from "./userDictionary";
import type { Outline } from "@/types/screenplay";
import { changedTopLevelNodes } from "./changedRanges";

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
  /** null requests a full pass; otherwise ranges use current-document positions. */
  dirty: [number, number][] | null;
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
const viewScanners = new WeakMap<EditorView, (full?: boolean, namesOnly?: boolean) => void>();

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

function decorationsForLine(
  node: PMNode,
  offset: number,
  sp: NSpell,
  names: Set<string>,
  acceptable: Map<string, boolean>,
  limit: number
): Decoration[] {
  if (limit <= 0 || node.type.name !== "screenplayLine") return [];
  const element = node.attrs.element as string;
  if (element !== "action" && element !== "dialogue" && element !== "parenthetical") {
    return [];
  }

  const decos: Decoration[] = [];
  const text = node.textContent;
  TOKEN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TOKEN.exec(text)) !== null && decos.length < limit) {
    const raw = match[0];
    if (raw.length < 2) continue;
    const lower = raw.toLowerCase();
    if (names.has(lower) || SCREENPLAY_TERMS.has(lower) || sessionIgnore.has(lower)) continue;
    let correct = acceptable.get(raw);
    if (correct === undefined) {
      correct = isAcceptable(sp, raw);
      acceptable.set(raw, correct);
    }
    if (correct) continue;
    const from = offset + 1 + match.index;
    decos.push(Decoration.inline(from, from + raw.length, { class: "spell-mark" }));
  }
  return decos;
}

/** Build the underline decorations for the whole document. */
function computeDeco(doc: PMNode, sp: NSpell, names: Set<string>): DecorationSet {
  const decos: Decoration[] = [];
  // Feature scripts repeat a small working vocabulary tens of thousands of
  // times. Hunspell lookup is substantially dearer than tokenization, so keep
  // one scan-local result per exact spelling/casing. The map is released when
  // the pass ends and can never retain a document or grow across projects.
  const acceptable = new Map<string, boolean>();
  doc.forEach((node, offset) => {
    if (decos.length >= MAX_MARKS) return;
    decos.push(
      ...decorationsForLine(
        node,
        offset,
        sp,
        names,
        acceptable,
        MAX_MARKS - decos.length
      )
    );
  });
  return DecorationSet.create(doc, decos);
}

function mergeRanges(ranges: [number, number][]): [number, number][] {
  ranges.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const merged: [number, number][] = [];
  for (const range of ranges) {
    const previous = merged[merged.length - 1];
    if (previous && range[0] <= previous[1] + 1) {
      previous[1] = Math.max(previous[1], range[1]);
    } else {
      merged.push([...range]);
    }
  }
  return merged;
}

function dirtyAfterTransaction(
  dirty: [number, number][] | null,
  tr: Transaction
): [number, number][] | null {
  if (dirty === null) return null;
  const mapped = dirty.map(
    ([from, to]) => [tr.mapping.map(from, -1), tr.mapping.map(to, 1)] as [number, number]
  );
  for (const change of getChangedRanges(tr)) {
    mapped.push([change.newRange.from, change.newRange.to]);
  }
  return mergeRanges(mapped);
}

/** Recheck only dirty top-level lines; the state already mapped all other marks. */
function updateDeco(
  doc: PMNode,
  previous: DecorationSet,
  dirty: [number, number][],
  sp: NSpell,
  names: Set<string>
): DecorationSet {
  let next = previous;
  let count = next.find().length;
  const wasCapped = count >= MAX_MARKS;
  const acceptable = new Map<string, boolean>();
  for (const { node, pos } of changedTopLevelNodes(doc, dirty)) {
    const remove = next.find(pos, pos + node.nodeSize);
    if (remove.length) {
      next = next.remove(remove);
      count -= remove.length;
    }
    const additions = decorationsForLine(
      node,
      pos,
      sp,
      names,
      acceptable,
      Math.max(0, MAX_MARKS - count)
    );
    if (additions.length) {
      next = next.add(doc, additions);
      count += additions.length;
    }
  }
  // If fixing a visible mark opened a slot at the cap, refill from the rest of
  // the script so later misspellings do not remain hidden forever.
  if (wasCapped && count < MAX_MARKS) return computeDeco(doc, sp, names);
  return next;
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
        let changed = false;
        if (o !== nameSetFor) {
          const next = buildNameSet(o);
          changed =
            next.size !== nameSet.size ||
            [...next].some((name) => !nameSet.has(name));
          nameSet = next;
          nameSetFor = o;
        }
        return { names: nameSet, changed };
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
            init: () => ({ deco: DecorationSet.empty, dirty: null }),
            apply(tr, prev) {
              const meta = tr.getMeta(spellKey) as
                | { deco?: DecorationSet; dirty?: [number, number][] | null }
                | undefined;
              if (meta && meta.deco !== undefined) {
                return { deco: meta.deco, dirty: meta.dirty ?? [] };
              }
              if (tr.docChanged) {
                return {
                  deco: prev.deco.map(tr.mapping, tr.doc),
                  dirty: dirtyAfterTransaction(prev.dirty, tr),
                };
              }
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
            let destroyed = false;

            const scanNow = (forceFull = false, namesOnly = false) => {
              if (destroyed) return;
              if (!isEnabled()) {
                const current = spellKey.getState(view.state);
                const cur = current?.deco ?? DecorationSet.empty;
                if (cur.find().length || current?.dirty === null) {
                  view.dispatch(
                    view.state.tr
                      .setMeta(spellKey, { deco: DecorationSet.empty, dirty: [] })
                      .setMeta("addToHistory", false)
                  );
                }
                return;
              }
              if (!speller) {
                getSpellerFn()
                  .then((s) => {
                    if (destroyed) return;
                    speller = s;
                    if (isEnabled()) scanNow(true);
                  })
                  .catch(() => {
                    /* leave the editor usable; native fallback stays available */
                  });
                return;
              }
              const current = spellKey.getState(view.state);
              const outlineNames = ensureNames();
              // Only catching up with the cast: nothing to do unless a name
              // came or went. Lines being typed wait for the usual pause.
              if (namesOnly && !outlineNames.changed) return;
              const full = forceFull || current?.dirty === null || outlineNames.changed;
              const dirty = current?.dirty ?? [];
              if (!full && dirty.length === 0) return;
              const deco = full
                ? computeDeco(view.state.doc, speller, outlineNames.names)
                : updateDeco(
                    view.state.doc,
                    current?.deco ?? DecorationSet.empty,
                    dirty,
                    speller,
                    outlineNames.names
                  );
              view.dispatch(
                view.state.tr
                  .setMeta(spellKey, { deco, dirty: [] })
                  .setMeta("addToHistory", false)
              );
            };

            const schedule = () => {
              if (destroyed) return;
              if (timer) clearTimeout(timer);
              timer = setTimeout(() => scanNow(false), 400);
            };

            viewScanners.set(view, scanNow);
            scanNow(); // kicks the lazy engine load when enabled

            return {
              update(_v, prevState) {
                if (view.state.doc !== prevState.doc) schedule();
              },
              destroy() {
                destroyed = true;
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
  viewScanners.get(view)?.(true);
  view.focus();
}

/** Add a word to the personal dictionary permanently (clears underlines now). */
export function addWord(view: EditorView, word: string): void {
  addUserWord(word);
  if (speller) speller.add(word);
  viewScanners.get(view)?.(true);
  view.focus();
}

/** Force an immediate rescan, e.g. when the Spelling toggle flips. */
export function rescanSpelling(view: EditorView): void {
  viewScanners.get(view)?.(true);
}

/**
 * The cast changed without an edit: rescan if a character or location name
 * came or went, so names never flag. The outline arrives a render after a new
 * editor's first scan, and with the dictionary already loaded (the second
 * script opened in a session) that scan ran without any names, flagging every
 * one of them until the writer typed something.
 */
export function refreshSpellingNames(view: EditorView): void {
  viewScanners.get(view)?.(false, true);
}

/** Flush pending changed-line work for the feature-length benchmark. */
export function benchmarkIncrementalSpellScan(view: EditorView): number {
  const started = performance.now();
  viewScanners.get(view)?.(false);
  return performance.now() - started;
}
