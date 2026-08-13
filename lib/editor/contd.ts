import { Extension, getChangedRanges } from "@tiptap/core";
import { Plugin, PluginKey, type EditorState, type Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import { cueBaseName } from "./outline";
import { changedTopLevelNodes } from "./changedRanges";

/**
 * Auto (CONT'D): when a character speaks again with no other speaker and no new
 * scene in between, the second cue reads NAME (CONT'D). Computed purely (never
 * written into the document, so the cast list and exports see the bare name),
 * mirroring how (MORE)/(CONT'D) at page breaks already work. Shared by the
 * pagination engine (the printed cue) and an on-screen widget decoration.
 */

const CONTD = " (CONT'D)";
const HAS_CONTD = /\(CONT'?D\)/i;

/**
 * Which character lines are continuations, aligned to `lines`. A cue is a
 * continuation when the previous speaker (reset by a scene heading or a
 * transition) is the same character, and the cue does not already carry a
 * (CONT'D) the writer typed.
 */
export function computeContinuations(
  lines: { element: string; text: string }[]
): boolean[] {
  const flags = new Array(lines.length).fill(false);
  let prevSpeaker: string | null = null;
  let prevSpeakerHasDialogue = false;
  for (let i = 0; i < lines.length; i++) {
    const el = lines[i].element;
    if (el === "scene_heading" || el === "transition") {
      prevSpeaker = null;
      prevSpeakerHasDialogue = false;
      continue;
    }
    if (el === "character") {
      const base = cueBaseName(lines[i].text).toUpperCase();
      if (base) {
        if (
          base === prevSpeaker &&
          prevSpeakerHasDialogue &&
          !HAS_CONTD.test(lines[i].text)
        ) {
          flags[i] = true;
        }
        prevSpeaker = base;
        prevSpeakerHasDialogue = false;
      } else {
        // An empty or extension-only cue ("(V.O.)" with no name) is still a new
        // cue, so it breaks the run: the next same-name cue is not a CONT'D.
        prevSpeaker = null;
        prevSpeakerHasDialogue = false;
      }
    } else if (el === "dialogue" && prevSpeaker) {
      prevSpeakerHasDialogue = true;
    }
    // Action and parenthetical keep the current speaker.
  }
  return flags;
}

export { CONTD };

const contdKey = new PluginKey<DecorationSet>("screenplayContd");

function buildDeco(state: EditorState, enabled: () => boolean): DecorationSet {
  if (!enabled()) return DecorationSet.empty;
  const lines: { element: string; text: string }[] = [];
  const ends: number[] = []; // doc position at the end of each line's content
  state.doc.forEach((node, offset) => {
    lines.push({
      element: (node.attrs.element as string) ?? "action",
      text: node.textContent,
    });
    ends.push(offset + node.nodeSize - 1);
  });
  const flags = computeContinuations(lines);
  const decos: Decoration[] = [];
  for (let i = 0; i < flags.length; i++) {
    if (!flags[i]) continue;
    decos.push(
      Decoration.widget(
        ends[i],
        () => {
          const span = document.createElement("span");
          span.className = "sp-contd";
          span.setAttribute("contenteditable", "false");
          span.textContent = CONTD;
          return span;
        },
        { side: 1, key: "contd" }
      )
    );
  }
  return DecorationSet.create(state.doc, decos);
}

function isReset(node: { attrs: { element?: unknown } }): boolean {
  return node.attrs.element === "scene_heading" || node.attrs.element === "transition";
}

/**
 * A continuation edit can affect later cues, but never crosses a scene heading
 * or transition. Return those semantic regions for the changed top-level lines.
 */
function affectedSpans(
  doc: EditorState["doc"],
  ranges: readonly [number, number][]
): [number, number][] {
  const spans: [number, number][] = [];
  for (const { node, pos } of changedTopLevelNodes(doc, ranges)) {
    const index = doc.resolve(pos).index(0);
    let from = pos;
    if (!isReset(node)) {
      for (let cursor = index - 1; cursor >= 0; cursor--) {
        const previous = doc.child(cursor);
        from -= previous.nodeSize;
        if (isReset(previous)) break;
      }
    }

    let to = pos + node.nodeSize;
    for (let cursor = index + 1; cursor < doc.childCount; cursor++) {
      const following = doc.child(cursor);
      if (isReset(following)) break;
      to += following.nodeSize;
    }
    spans.push([from, to]);
  }

  spans.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const span of spans) {
    const previous = merged[merged.length - 1];
    if (previous && span[0] <= previous[1]) previous[1] = Math.max(previous[1], span[1]);
    else merged.push([...span]);
  }
  return merged;
}

function decorationsInSpan(
  state: EditorState,
  from: number,
  to: number
): Decoration[] {
  const lines: { element: string; text: string }[] = [];
  const ends: number[] = [];
  let index = state.doc.resolve(from).index(0);
  let offset = from;
  while (index < state.doc.childCount && offset < to) {
    const node = state.doc.child(index);
    lines.push({
      element: (node.attrs.element as string) ?? "action",
      text: node.textContent,
    });
    ends.push(offset + node.nodeSize - 1);
    offset += node.nodeSize;
    index++;
  }
  const flags = computeContinuations(lines);
  const decos: Decoration[] = [];
  for (let cursor = 0; cursor < flags.length; cursor++) {
    if (!flags[cursor]) continue;
    decos.push(
      Decoration.widget(
        ends[cursor],
        () => {
          const span = document.createElement("span");
          span.className = "sp-contd";
          span.setAttribute("contenteditable", "false");
          span.textContent = CONTD;
          return span;
        },
        { side: 1, key: "contd" }
      )
    );
  }
  return decos;
}

function updateDeco(
  tr: Transaction,
  old: DecorationSet,
  newState: EditorState,
  enabled: () => boolean
): DecorationSet {
  if (!enabled()) return DecorationSet.empty;
  const ranges = getChangedRanges(tr).map(
    (change) => [change.newRange.from, change.newRange.to] as [number, number]
  );
  if (!ranges.length) return buildDeco(newState, enabled);

  let next = old.map(tr.mapping, tr.doc);
  for (const [from, to] of affectedSpans(newState.doc, ranges)) {
    const remove = next.find(from, to);
    if (remove.length) next = next.remove(remove);
    const additions = decorationsInSpan(newState, from, to);
    if (additions.length) next = next.add(newState.doc, additions);
  }
  return next;
}

/** Force the on-screen markers to recompute (e.g. when the toggle flips). */
export function rescanContd(view: EditorView): void {
  view.dispatch(view.state.tr.setMeta(contdKey, "refresh").setMeta("addToHistory", false));
}

/** On-screen (CONT'D) markers, gated by a live-read enabled flag. */
export function buildContdMarkers(enabled: () => boolean): Extension {
  return Extension.create({
    name: "screenplayContd",
    addProseMirrorPlugins() {
      return [
        new Plugin({
          key: contdKey,
          state: {
            init: (_c, state) => buildDeco(state, enabled),
            apply: (tr, old, _o, newState) =>
              tr.getMeta(contdKey) === "refresh"
                ? buildDeco(newState, enabled)
                : tr.docChanged
                  ? updateDeco(tr, old, newState, enabled)
                  : old,
          },
          props: {
            decorations(state) {
              return contdKey.getState(state);
            },
          },
        }),
      ];
    },
  });
}
