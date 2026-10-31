// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { Editor } from "@tiptap/core";
import { buildPlainExtensions } from "./buildPlainExtensions";
import { findPluginKey, replaceAll, setFindQuery } from "./findPlugin";

let editor: Editor | null = null;
afterEach(() => {
  editor?.destroy();
  editor = null;
});
const para = (...content: object[]) => ({ type: "paragraph", content });
const text = (t: string) => ({ type: "text", text: t });

function setup() {
  editor = new Editor({
    element: document.createElement("div"),
    extensions: buildPlainExtensions(),
    content: {
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 1 }, content: [text("The rain")] },
        para(text("Rain falls."), { type: "hardBreak" }, text("More rain.")),
        {
          type: "bulletList",
          content: [{ type: "listItem", content: [para(text("Rain in a list."))] }],
        },
      ],
    },
  });
  return editor;
}

describe("find in a document", () => {
  it("finds words in headings, across line breaks and inside lists, at the right places", () => {
    const ed = setup();
    setFindQuery(ed.view, { query: "rain" });
    const { matches } = findPluginKey.getState(ed.state)!;
    expect(matches.map((m) => ed.state.doc.textBetween(m.from, m.to))).toEqual(["rain", "Rain", "rain", "Rain"]);
  });

  it("keeps up with edits in a list, and replaces everything in one undo", () => {
    const ed = setup();
    setFindQuery(ed.view, { query: "rain" });
    ed.commands.setTextSelection(ed.state.doc.content.size - 3);
    ed.commands.insertContent(" rain");
    expect(findPluginKey.getState(ed.state)!.matches).toHaveLength(5);
    expect(replaceAll(ed.view, "snow")).toBe(5);
    expect(ed.getText()).not.toMatch(/rain/i);
    ed.commands.undo();
    expect(ed.getText()).toMatch(/rain/i);
  });
});
