import { Extension } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { ElementType } from "./elements";

export const PARENTHETICAL_PLACEHOLDER = "how they say it";
export const parentheticalEditingKey = new PluginKey<ReadonlySet<number>>(
  "parentheticalEditing"
);
export interface ParentheticalEditingMeta {
  add?: number[];
  remove?: number[];
}

/** The automatic bracket pair carries no writer-authored content. */
export function isEmptyParentheticalText(text: string): boolean {
  return text.trim() === "()";
}

/** Empty-line behavior treats the automatic pair like a genuinely empty node. */
export function isScreenplayLineEmpty(element: ElementType, text: string): boolean {
  return text.trim() === "" || (element === "parenthetical" && isEmptyParentheticalText(text));
}

/** Add the parenthetical scaffold while preserving any text the writer supplied. */
export function wrapParentheticalText(text: string): string {
  if (text.startsWith("(") && text.endsWith(")")) return text;
  if (text.trim() === "") return "()";
  return `(${text})`;
}

function lineAround(doc: PMNode, pos: number) {
  const $pos = doc.resolve(pos);
  for (let depth = $pos.depth; depth > 0; depth--) {
    const node = $pos.node(depth);
    if (node.type.name === "screenplayLine") {
      return { node, pos: $pos.before(depth) };
    }
  }
  return null;
}

/**
 * Keeps the caret inside the bracket scaffold. The brackets remain ordinary
 * text, so documents stay compatible with every existing importer and store.
 */
export const ParentheticalEditing = Extension.create({
  name: "parentheticalEditing",
  priority: 250,

  addKeyboardShortcuts() {
    const bracketedLine = () => {
      const { state } = this.editor;
      if (!state.selection.empty) return null;
      const line = lineAround(state.doc, state.selection.head);
      if (
        !line ||
        line.node.attrs.element !== "parenthetical" ||
        !line.node.textContent.startsWith("(") ||
        !line.node.textContent.endsWith(")")
      ) {
        return null;
      }
      return { ...line, beforeClose: line.pos + line.node.content.size };
    };

    return {
      End: () => {
        const { state, view } = this.editor;
        const line = bracketedLine();
        if (!line) return false;
        view.dispatch(
          state.tr.setSelection(TextSelection.create(state.doc, line.beforeClose))
        );
        return true;
      },
      Backspace: () => {
        const { state, view } = this.editor;
        const line = bracketedLine();
        if (!line) return false;

        // An empty pair holds no writer text, so Backspace clears the whole
        // scaffold rather than doing nothing. This has to cover the caret
        // ANYWHERE in the pair, because the editor parks it between the
        // brackets: guarding only the after-the-close case left a writer who
        // pressed Mod+5 by accident stuck with brackets that the most
        // instinctive key would not remove. Clearing hands the next Backspace
        // back to the ordinary empty-line path.
        if (line.beforeClose <= line.pos + 2) {
          const head = state.selection.head;
          if (head < line.pos + 1 || head > line.beforeClose + 1) return false;
          const tr = state.tr.delete(line.pos + 1, line.pos + 1 + line.node.content.size);
          tr.setSelection(TextSelection.create(tr.doc, line.pos + 1));
          view.dispatch(tr);
          return true;
        }

        // With writer text present, Backspace from the visual end edits the
        // last character inside the scaffold instead of eating the bracket.
        if (state.selection.head !== line.beforeClose + 1) return false;
        const tr = state.tr.delete(line.beforeClose - 1, line.beforeClose);
        tr.setSelection(TextSelection.create(tr.doc, line.beforeClose - 1));
        view.dispatch(tr);
        return true;
      },
      Delete: () => {
        const line = bracketedLine();
        return !!line && this.editor.state.selection.head === line.beforeClose;
      },
    };
  },

  addProseMirrorPlugins() {
    return [
      new Plugin<ReadonlySet<number>>({
        key: parentheticalEditingKey,
        state: {
          init: () => new Set<number>(),
          apply(tr, previous, _oldState, newState) {
            const next = new Set<number>();
            for (const pos of previous) {
              const mapped = tr.mapping.map(pos, -1);
              const node = newState.doc.nodeAt(mapped);
              if (
                node?.type.name === "screenplayLine" &&
                node.attrs.element === "parenthetical" &&
                node.textContent.startsWith("(") &&
                node.textContent.endsWith(")")
              ) {
                next.add(mapped);
              }
            }

            const meta = tr.getMeta(parentheticalEditingKey) as
              | ParentheticalEditingMeta
              | undefined;
            for (const pos of meta?.remove ?? []) next.delete(pos);
            for (const pos of meta?.add ?? []) next.add(pos);
            return next;
          },
        },
        props: {
          handleTextInput(view, from, to, text) {
            const line = lineAround(view.state.doc, from);
            if (
              !line ||
              line.node.attrs.element !== "parenthetical" ||
              !line.node.textContent.endsWith(")")
            ) {
              return false;
            }

            const beforeClose = line.pos + line.node.content.size;
            // Typing the bracket already supplied by the editor is an overtype,
            // not a second closing bracket.
            if (text === ")" && from >= beforeClose && from === to) {
              if (from > beforeClose) {
                view.dispatch(
                  view.state.tr.setSelection(
                    TextSelection.create(view.state.doc, beforeClose)
                  )
                );
              }
              return true;
            }

            // A click may place the browser caret after the closing bracket.
            // Redirect ordinary typing to the last editable position inside it.
            if (from > beforeClose && from === to) {
              const tr = view.state.tr.insertText(text, beforeClose);
              tr.setSelection(TextSelection.create(tr.doc, beforeClose + text.length));
              view.dispatch(tr);
              return true;
            }
            return false;
          },

          decorations(state) {
            const line = lineAround(state.doc, state.selection.anchor);
            if (
              !line ||
              line.node.attrs.element !== "parenthetical" ||
              !isEmptyParentheticalText(line.node.textContent)
            ) {
              return null;
            }

            const nodeDecoration = Decoration.node(
              line.pos,
              line.pos + line.node.nodeSize,
              { class: "is-empty" }
            );
            const hint = Decoration.widget(
              line.pos + 2,
              () => {
                const span = document.createElement("span");
                span.className = "parenthetical-placeholder";
                span.textContent = PARENTHETICAL_PLACEHOLDER;
                return span;
              },
              { side: -1 }
            );
            return DecorationSet.create(state.doc, [nodeDecoration, hint]);
          },
        },
      }),
    ];
  },
});

const bracketsKey = new PluginKey<DecorationSet>("parentheticalBrackets");

function bracketSpan(text: string): () => HTMLElement {
  return () => {
    const span = document.createElement("span");
    span.className = "sp-paren-supplied";
    span.setAttribute("contenteditable", "false");
    span.textContent = text;
    return span;
  };
}

function suppliedBrackets(doc: PMNode): DecorationSet {
  const decos: Decoration[] = [];
  doc.forEach((node, pos) => {
    if (node.attrs.element !== "parenthetical") return;
    const text = node.textContent;
    if (text.trim() === "") return;
    const from = pos + 1;
    const to = pos + 1 + node.content.size;
    if (!text.trimStart().startsWith("(")) {
      decos.push(Decoration.widget(from, bracketSpan("("), { side: -1, key: "paren-open", marks: [] }));
    }
    if (!text.trimEnd().endsWith(")")) {
      decos.push(Decoration.widget(to, bracketSpan(")"), { side: 1, key: "paren-close", marks: [] }));
    }
  });
  return decos.length ? DecorationSet.create(doc, decos) : DecorationSet.empty;
}

/**
 * A parenthetical from an older document or an import may have no brackets
 * of its own. The printed page adds them (ensureParentheticalParens), so the
 * page on screen shows them too, as marks the writer cannot type into: the
 * script reads as it will print, and the line wraps where the PDF wraps it.
 */
export const ParentheticalBrackets = Extension.create({
  name: "parentheticalBrackets",
  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key: bracketsKey,
        state: {
          init: (_config, state) => suppliedBrackets(state.doc),
          apply: (tr, old, _oldState, newState) =>
            tr.docChanged ? suppliedBrackets(newState.doc) : old,
        },
        props: {
          decorations(state) {
            return bracketsKey.getState(state);
          },
        },
      }),
    ];
  },
});
