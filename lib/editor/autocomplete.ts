import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, type EditorState, TextSelection } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { lineAt } from "./keymap";
import { cueBaseName, parseLocation, TIME_OF_DAY } from "./outline";
import type { ElementType } from "./elements";
import type { Outline } from "@/types/screenplay";

/**
 * Inline autocomplete for sluglines and character cues, built as a custom
 * ProseMirror plugin (not the Mention node, because the schema is strict and
 * stores plain text). The plugin owns the open-state and the candidate list;
 * the caret coordinates and that list are pushed to React through onState so a
 * styled dropdown can render next to the caret.
 *
 * It suggests previously-used LOCATIONS while you type a scene heading's
 * location, standard TIMES of day after the dash, and previously-used CHARACTER
 * names while you type a cue. Accepting replaces only the relevant text segment.
 */

export interface AcItem {
  text: string;
  hint: string;
}

/** Internal plugin state (coords are added by the React-facing snapshot). */
interface AcPluginState {
  open: boolean;
  items: AcItem[];
  active: number;
  replaceFrom: number;
  replaceTo: number;
}

/** What React needs to render the menu. */
export interface AcState {
  open: boolean;
  items: AcItem[];
  active: number;
  coords: { left: number; top: number; bottom: number } | null;
  replaceFrom: number;
  replaceTo: number;
}

export const autocompleteKey = new PluginKey<AcPluginState>("screenplayAutocomplete");

const CLOSED: AcPluginState = {
  open: false,
  items: [],
  active: 0,
  replaceFrom: 0,
  replaceTo: 0,
};

const MAX_ITEMS = 8;

const SLUG_PREFIX = /^\s*(INT\.?\/EXT\.?|EXT\.?\/INT\.?|I\/E\.?|INT\.?|EXT\.?|EST\.?)\b[.\s-]*/i;
const TIME_SEP = /\s+-{1,2}\s+/g;

/** Build the open/closed plugin state from the current selection and outline. */
function compute(state: EditorState, getOutline: () => Outline): AcPluginState {
  const sel = state.selection;
  if (!sel.empty) return CLOSED;

  const line = lineAt(sel.$from);
  if (!line) return CLOSED;

  const element = line.node.attrs.element as ElementType;
  if (element !== "scene_heading" && element !== "character") return CLOSED;

  const lineStart = line.pos + 1; // first text position inside the line
  const caretOffset = sel.$from.parentOffset; // char index within the line
  const fullText = line.node.textContent;
  const outline = getOutline();

  if (element === "character") {
    const upToCaret = fullText.slice(0, caretOffset);
    const query = cueBaseName(upToCaret);
    if (!query) return CLOSED;
    const qUpper = query.toUpperCase();
    const ownName = cueBaseName(fullText).toUpperCase();
    const items = outline.characters
      .filter((c) => {
        const u = c.name.toUpperCase();
        return u.startsWith(qUpper) && u !== qUpper && u !== ownName;
      })
      .slice(0, MAX_ITEMS)
      .map((c) => ({ text: c.name, hint: c.lines === 1 ? "1 line" : `${c.lines} lines` }));
    if (items.length === 0) return CLOSED;

    const lead = upToCaret.length - upToCaret.trimStart().length;
    return {
      open: true,
      items,
      active: 0,
      replaceFrom: lineStart + lead,
      replaceTo: lineStart + caretOffset,
    };
  }

  // scene_heading: figure out whether the caret is in the location or time part.
  const pm = SLUG_PREFIX.exec(fullText);
  if (!pm) return CLOSED;
  const prefixEnd = pm[0].length;
  if (caretOffset <= prefixEnd) return CLOSED;

  // Find the last separator after the prefix; its trailing segment may be a time.
  let sepIdx = -1;
  let sepLen = 0;
  TIME_SEP.lastIndex = 0;
  let sep: RegExpExecArray | null;
  while ((sep = TIME_SEP.exec(fullText)) !== null) {
    if (sep.index >= prefixEnd) {
      sepIdx = sep.index;
      sepLen = sep[0].length;
    }
  }

  // The trailing segment counts as the time slot if it reads as a time of day,
  // or if the caret is in it (the writer is typing the time). This mirrors
  // parseLocation, so the location slot is exactly the same span the outline
  // keyed on, and a sub-location like "HOUSE - GARAGE" is never half-replaced.
  const caretInTrailing = sepIdx >= 0 && caretOffset >= sepIdx + sepLen;
  const trailingUpper =
    sepIdx >= 0 ? fullText.slice(sepIdx + sepLen).trim().toUpperCase() : "";
  const trailingIsTime = TIME_OF_DAY.some(
    (t) => trailingUpper === t || trailingUpper.startsWith(t + " ") || t.startsWith(trailingUpper)
  );
  const hasTime = sepIdx >= 0 && (trailingIsTime || caretInTrailing);

  if (caretInTrailing) {
    // Time-of-day segment. query and replace span both run to the caret.
    const timeStart = sepIdx + sepLen;
    const query = fullText.slice(timeStart, caretOffset).trim().toUpperCase();
    const items = TIME_OF_DAY.filter((t) => t.startsWith(query) && t !== query)
      .slice(0, MAX_ITEMS)
      .map((t) => ({ text: t, hint: "" }));
    if (items.length === 0) return CLOSED;
    return {
      open: true,
      items,
      active: 0,
      replaceFrom: lineStart + timeStart,
      replaceTo: lineStart + caretOffset,
    };
  }

  // Location segment: prefix end to the time separator (or end of line). The
  // query is the WHOLE segment (not just up to the caret) so query and replace
  // range share the same boundary and nothing after the caret is clobbered.
  const locEnd = hasTime ? sepIdx : fullText.length;
  const query = fullText.slice(prefixEnd, locEnd).trim().toUpperCase();
  if (!query) return CLOSED;
  const items = outline.locations
    .filter((l) => {
      const u = l.name.toUpperCase();
      return u.startsWith(query) && u !== query;
    })
    .slice(0, MAX_ITEMS)
    .map((l) => ({ text: l.name, hint: l.scenes === 1 ? "1 scene" : `${l.scenes} scenes` }));
  if (items.length === 0) return CLOSED;
  return {
    open: true,
    items,
    active: 0,
    replaceFrom: lineStart + prefixEnd,
    replaceTo: lineStart + locEnd,
  };
}

/** Accept the suggestion at `index`, replacing the relevant text segment. */
export function acceptAutocomplete(view: EditorView, index: number): boolean {
  const st = autocompleteKey.getState(view.state);
  if (!st || !st.open || index < 0 || index >= st.items.length) return false;
  const item = st.items[index];
  const tr = view.state.tr.insertText(item.text, st.replaceFrom, st.replaceTo);
  const caret = st.replaceFrom + item.text.length;
  tr.setSelection(TextSelection.create(tr.doc, caret));
  tr.setMeta(autocompleteKey, { open: false, items: [] });
  view.dispatch(tr);
  view.focus();
  return true;
}

/**
 * Build the autocomplete extension. priority 200 puts its keydown handler ahead
 * of the screenplay keymap, but it only consumes keys while the menu is open,
 * so Enter / Tab / Mod-number keep their normal behavior otherwise.
 */
export function buildAutocomplete(
  getOutline: () => Outline,
  onState?: (s: AcState | null) => void
): Extension {
  return Extension.create({
    name: "screenplayAutocomplete",
    priority: 200,
    addProseMirrorPlugins() {
      return [
        new Plugin<AcPluginState>({
          key: autocompleteKey,
          state: {
            init: () => CLOSED,
            apply(tr, prev, _old, newState) {
              const meta = tr.getMeta(autocompleteKey) as Partial<AcPluginState> | undefined;
              if (meta) return { ...prev, ...meta };
              return compute(newState, getOutline);
            },
          },
          props: {
            handleKeyDown(view, event) {
              const st = autocompleteKey.getState(view.state);
              if (!st || !st.open || st.items.length === 0) return false;
              const n = st.items.length;
              // Stop the key from bubbling to the window-level Escape handlers
              // (focus mode, find panel) once the menu has consumed it.
              const consume = () => event.stopPropagation();
              switch (event.key) {
                case "ArrowDown":
                  consume();
                  view.dispatch(
                    view.state.tr
                      .setMeta(autocompleteKey, { active: (st.active + 1) % n })
                      .setMeta("addToHistory", false)
                  );
                  return true;
                case "ArrowUp":
                  consume();
                  view.dispatch(
                    view.state.tr
                      .setMeta(autocompleteKey, { active: (st.active - 1 + n) % n })
                      .setMeta("addToHistory", false)
                  );
                  return true;
                case "Tab":
                  // Shift+Tab must still cycle the element type backward.
                  if (event.shiftKey) return false;
                  consume();
                  return acceptAutocomplete(view, st.active);
                case "Enter":
                  // Let modified Enter fall through to the keymap / default.
                  if (event.shiftKey || event.metaKey || event.ctrlKey || event.altKey)
                    return false;
                  consume();
                  return acceptAutocomplete(view, st.active);
                case "Escape":
                  consume();
                  view.dispatch(
                    view.state.tr
                      .setMeta(autocompleteKey, { open: false, items: [] })
                      .setMeta("addToHistory", false)
                  );
                  return true;
                default:
                  return false;
              }
            },
          },
          view(editorView) {
            // TipTap calls plugin view updates on every React re-render, so we
            // dedupe: only notify React when the snapshot actually changed.
            // Otherwise pushing a fresh object each render would loop
            // (setState -> render -> view update -> setState) while open.
            let last = "null";
            const push = () => {
              const st = autocompleteKey.getState(editorView.state);
              let next: AcState | null = null;
              if (st && st.open && st.items.length > 0) {
                try {
                  const c = editorView.coordsAtPos(editorView.state.selection.head);
                  next = {
                    open: true,
                    items: st.items,
                    active: st.active,
                    coords: { left: c.left, top: c.top, bottom: c.bottom },
                    replaceFrom: st.replaceFrom,
                    replaceTo: st.replaceTo,
                  };
                } catch {
                  next = null;
                }
              }
              const sig = next ? JSON.stringify(next) : "null";
              if (sig === last) return;
              last = sig;
              onState?.(next);
            };
            // Re-anchor the menu when the page scrolls or the window resizes;
            // those do not dispatch a transaction, so the cached caret coords
            // would otherwise go stale and the dropdown would detach.
            const scroller =
              editorView.dom.closest(".page-scroll") ?? (window as unknown as HTMLElement);
            const reposition = () => push();
            scroller.addEventListener("scroll", reposition, { passive: true });
            window.addEventListener("resize", reposition);

            push();
            return {
              update: () => push(),
              destroy: () => {
                scroller.removeEventListener("scroll", reposition);
                window.removeEventListener("resize", reposition);
                if (last !== "null") onState?.(null);
              },
            };
          },
        }),
      ];
    },
  });
}
