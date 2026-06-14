import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { UPPERCASE_ELEMENTS, type ElementType } from "./elements";

/**
 * Auto-uppercase plugin.
 *
 * Scene headings, character cues, and transitions are written in uppercase by
 * screenplay convention. We could fake it with CSS (`text-transform`), but then
 * the stored text would be mixed-case and the cast list, autocomplete, and
 * Fountain/FDX exporters would all have to re-normalize. Instead we uppercase
 * the actual text as it's typed, so the document's source of truth is correct.
 *
 * Uppercasing is length-preserving, so cursor positions never shift — the
 * caret stays exactly where the writer left it.
 */

const autoCapsKey = new PluginKey("screenplayAutoCaps");

export const AutoCaps = Extension.create({
  name: "screenplayAutoCaps",

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: autoCapsKey,

        // appendTransaction runs after the user's change is applied. We inspect
        // the new document, and if any uppercase-element line contains lowercase
        // characters, we append a follow-up transaction that fixes them.
        appendTransaction: (transactions, _oldState, newState) => {
          if (!transactions.some((t) => t.docChanged)) return null;

          const tr = newState.tr;
          let modified = false;

          newState.doc.descendants((node, pos) => {
            if (node.type.name !== "screenplayLine") return;
            const element = node.attrs.element as ElementType;
            if (!UPPERCASE_ELEMENTS.has(element)) return;

            // Walk the line's text children and uppercase any that need it.
            node.descendants((child, offset) => {
              if (!child.isText || !child.text) return;
              const upper = child.text.toUpperCase();
              if (upper !== child.text) {
                // +1 steps inside the line node to its content.
                const start = pos + 1 + offset;
                tr.insertText(upper, start, start + child.text.length);
                modified = true;
              }
            });
          });

          // Fold the casing fix into the same undo step as the keystroke that
          // triggered it, so one Ctrl/Cmd+Z undoes both cleanly.
          if (modified) {
            tr.setMeta("addToHistory", false);
            return tr;
          }
          return null;
        },
      }),
    ];
  },
});
