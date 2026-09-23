import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, type EditorState } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

/**
 * A small element-type icon at the active line, the way Arc Studio shows its
 * little glyph: a location pin for a scene heading, an eye for action, a person
 * for a character, a speech bubble for dialogue, parentheses for a parenthetical,
 * and a fast-forward for a transition. Rendered as a widget decoration on the
 * line the cursor is in, so it is never cluttered. SVG icons (no emoji).
 */

const svg = (inner: string) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;

const ICONS: Record<string, string> = {
  scene_heading: svg(
    '<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>'
  ),
  action: svg('<path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3"/>'),
  character: svg(
    '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>'
  ),
  dialogue: svg('<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>'),
  parenthetical: svg('<path d="M9 4a8 10 0 0 0 0 16"/><path d="M15 4a8 10 0 0 1 0 16"/>'),
  transition: svg('<polygon points="13 19 22 12 13 5 13 19"/><polygon points="2 19 11 12 2 5 2 19"/>'),
};

const LABELS: Record<string, string> = {
  scene_heading: "Scene heading",
  action: "Action",
  character: "Character",
  dialogue: "Dialogue",
  parenthetical: "Parenthetical",
  transition: "Transition",
};

const elementIconsKey = new PluginKey<DecorationSet>("screenplayElementIcons");

function buildDeco(state: EditorState): DecorationSet {
  const sel = state.selection;
  if (!sel.empty) return DecorationSet.empty;
  const $from = sel.$from;
  if ($from.depth < 1) return DecorationSet.empty;
  const linePos = $from.before(1);
  const node = state.doc.nodeAt(linePos);
  if (!node || node.type.name !== "screenplayLine") return DecorationSet.empty;
  const element = (node.attrs.element as string) ?? "action";
  const icon = ICONS[element] ?? ICONS.action;

  const widget = Decoration.widget(
    linePos + 1,
    () => {
      const span = document.createElement("span");
      span.className = "sp-elem-icon";
      span.setAttribute("contenteditable", "false");
      span.title = LABELS[element] ?? element;
      span.innerHTML = icon;
      return span;
    },
    { side: -1, key: `eicon-${element}` }
  );
  return DecorationSet.create(state.doc, [widget]);
}

export const ElementIcons = Extension.create({
  name: "screenplayElementIcons",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: elementIconsKey,
        state: {
          init: (_config, state) => buildDeco(state),
          apply: (tr, old, _oldState, newState) =>
            tr.selectionSet || tr.docChanged ? buildDeco(newState) : old,
        },
        props: {
          decorations(state) {
            return elementIconsKey.getState(state);
          },
        },
      }),
    ];
  },
});
