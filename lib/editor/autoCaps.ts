import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { UPPERCASE_ELEMENTS, type ElementType } from "./elements";
import { parentheticalEditingKey } from "./parenthetical";

/**
 * Auto-uppercase plugin.
 *
 * Scene headings, character cues, and transitions are written in uppercase by
 * screenplay convention. We could fake it with CSS (`text-transform`), but then
 * the stored text would be mixed-case and the cast list, autocomplete, and
 * Fountain/FDX exporters would all have to re-normalize. Instead we uppercase
 * the actual text as it's typed, so the document's source of truth is correct.
 *
 * Uppercasing is usually length-preserving, so cursor positions do not shift.
 * The rare exceptions (the German eszett, ligatures) grow when uppercased and
 * would corrupt positions, so those text runs are left alone: the stored text
 * keeps its typed form and the element's CSS displays it uppercased anyway.
 */

const autoCapsKey = new PluginKey("screenplayAutoCaps");

export const AutoCaps = Extension.create({
  name: "screenplayAutoCaps",

  addProseMirrorPlugins() {
    const editor = this.editor;
    return [
      new Plugin({
        key: autoCapsKey,

        // appendTransaction runs after the user's change is applied. We inspect
        // the new document, and if any uppercase-element line contains lowercase
        // characters, we append a follow-up transaction that fixes them.
        appendTransaction: (transactions, oldState, newState) => {
          if (!transactions.some((t) => t.docChanged)) return null;
          // Adding or removing the parenthetical scaffold is part of an
          // element-format change, not newly typed prose.
          if (transactions.some((t) => t.getMeta(parentheticalEditingKey))) return null;
          // Changing only a line's element type must not rewrite its content.
          // Otherwise one full Tab cycle through Character permanently turns
          // an action sentence into uppercase even though it ends as Action.
          if (oldState.doc.textContent === newState.doc.textContent) return null;
          // Never rewrite the text while an IME composition is in flight:
          // replacing the composing text node cancels composition and eats
          // CJK / accented input. AutoCaps re-runs on compositionend anyway.
          if (editor?.view?.composing) return null;

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
              // Skip any run whose uppercase form changes length (eszett,
              // ligatures): rewriting it would shift every later position in
              // the document. The CSS uppercase display covers those on screen.
              if (upper.length !== child.text.length) return;
              if (upper !== child.text) {
                // +1 steps inside the line node to its content.
                const start = pos + 1 + offset;
                tr.insertText(upper, start, start + child.text.length);
                modified = true;
              }
            });
          });

          // Left visible to history on purpose: ProseMirror composes an
          // appendTransaction result into the same undo event as the keystroke
          // that triggered it, so one Ctrl/Cmd+Z undoes both cleanly. Hiding it
          // (addToHistory false) made undo produce states that never existed.
          if (modified) return tr;
          return null;
        },
      }),
    ];
  },
});
