import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, type EditorState } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import { cueBaseName } from "./outline";

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
  for (let i = 0; i < lines.length; i++) {
    const el = lines[i].element;
    if (el === "scene_heading" || el === "transition") {
      prevSpeaker = null;
      continue;
    }
    if (el === "character") {
      const base = cueBaseName(lines[i].text).toUpperCase();
      if (base) {
        if (base === prevSpeaker && !HAS_CONTD.test(lines[i].text)) flags[i] = true;
        prevSpeaker = base;
      } else {
        // An empty or extension-only cue ("(V.O.)" with no name) is still a new
        // cue, so it breaks the run: the next same-name cue is not a CONT'D.
        prevSpeaker = null;
      }
    }
    // action / parenthetical / dialogue keep the current speaker.
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
              tr.docChanged || tr.getMeta(contdKey) === "refresh"
                ? buildDeco(newState, enabled)
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
