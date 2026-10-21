import { Extension } from "@tiptap/core";
import { Slice } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { linesToDoc } from "@/lib/export/flatten";
import { parseFountain } from "@/lib/export/fountain";

/**
 * Pasting a scene into a script. Text copied from Final Draft, a Fountain
 * file, a PDF or an email arrives as plain lines; without this every one of
 * them became Action. When the pasted text reads like a screenplay (it has a
 * scene heading, or a character cue with dialogue), it is read the way a
 * Fountain file is, so headings, cues, parentheticals, dialogue and
 * transitions land as themselves. A single line, prose, or anything copied
 * inside LESS (which carries its own elements) pastes as before.
 */
export function screenplayLinesFromPaste(text: string) {
  if (text.split(/\r?\n/).filter((l) => l.trim() !== "").length < 2) return null;
  const { lines } = parseFountain(text);
  if (!lines.some((l) => l.element !== "action")) return null;
  // Dual dialogue needs both halves; a paste may carry only one.
  return lines.map(({ element, text: t }) => ({ element, text: t }));
}

export const ScreenplayPaste = Extension.create({
  name: "screenplayPaste",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("screenplayPaste"),
        props: {
          handlePaste: (view, event) => {
            const data = event.clipboardData;
            if (!data || data.getData("text/html").includes("data-pm-slice")) return false;
            const lines = screenplayLinesFromPaste(data.getData("text/plain"));
            if (!lines) return false;
            let doc;
            try {
              doc = view.state.schema.nodeFromJSON(linesToDoc(lines));
            } catch {
              return false;
            }
            // Open at both ends, so the first and last pasted lines join the
            // line the caret is in, as an ordinary paste does.
            view.dispatch(view.state.tr.replaceSelection(new Slice(doc.content, 1, 1)).scrollIntoView());
            return true;
          },
        },
      }),
    ];
  },
});
