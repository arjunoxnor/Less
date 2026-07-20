import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

/**
 * The onboarding ghost line for a brand-new empty screenplay (Superaudit 2,
 * 2D.3): one muted Courier line under the regular placeholder, "Press Tab to
 * change the line type". It is a widget decoration, never document content,
 * and it disappears at the first keystroke (any doc-changing transaction) for
 * good, so it cannot reappear when the writer later deletes everything.
 */

const key = new PluginKey("ghostHint");

export function buildGhostHint(enabled: boolean) {
  return Extension.create({
    name: "ghostHint",

    addProseMirrorPlugins() {
      if (!enabled) return [];
      let typed = false;
      return [
        new Plugin({
          key,
          state: {
            init: () => null,
            apply(tr) {
              if (tr.docChanged) typed = true;
              return null;
            },
          },
          props: {
            decorations(state) {
              if (typed) return null;
              const doc = state.doc;
              if (doc.childCount !== 1 || doc.firstChild!.textContent !== "") {
                return null;
              }
              const deco = Decoration.widget(
                doc.content.size,
                () => {
                  const d = document.createElement("div");
                  d.className = "sp-ghost-hint";
                  d.textContent = "Press Tab to change the line type";
                  d.setAttribute("contenteditable", "false");
                  d.setAttribute("aria-hidden", "true");
                  return d;
                },
                { side: 1, ignoreSelection: true, key: "ghost-hint" }
              );
              return DecorationSet.create(doc, [deco]);
            },
          },
        }),
      ];
    },
  });
}
