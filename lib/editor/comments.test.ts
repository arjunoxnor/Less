// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { Editor } from "@tiptap/core";
import { buildPlainExtensions } from "./buildPlainExtensions";
import { listComments } from "./comments";

let editor: Editor | null = null;
afterEach(() => {
  editor?.destroy();
  editor = null;
});
const setup = () =>
  (editor = new Editor({
    element: document.createElement("div"),
    extensions: buildPlainExtensions(),
    content: {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "One two three four." }] }],
    },
  }));

describe("comments", () => {
  it("attach to what is selected, and need a selection and words", () => {
    const ed = setup();
    expect(ed.commands.addComment("Nothing selected")).toBe(false);
    ed.commands.setTextSelection({ from: 5, to: 8 });
    expect(ed.commands.addComment("   ")).toBe(false);
    expect(ed.commands.addComment("Why two?", "a")).toBe(true);
    expect(listComments(ed.state.doc)).toEqual([{ id: "a", text: "Why two?", quote: "two", from: 5, to: 8 }]);
  });

  it("stay one comment when formatting cuts the words apart, and can overlap", () => {
    const ed = setup();
    ed.commands.setTextSelection({ from: 1, to: 14 });
    ed.commands.addComment("Long", "a");
    ed.commands.setTextSelection({ from: 5, to: 8 });
    ed.commands.toggleBold();
    ed.commands.addComment("Short", "b");
    const all = listComments(ed.state.doc);
    expect(all.map((c) => [c.id, c.quote])).toEqual([
      ["a", "One two three"],
      ["b", "two"],
    ]);
  });

  it("do not grow as you type at their edge, and move with the text", () => {
    const ed = setup();
    ed.commands.setTextSelection({ from: 5, to: 8 });
    ed.commands.addComment("Note", "a");
    ed.commands.insertContentAt(8, "X");
    ed.commands.insertContentAt(1, "Zero ");
    const [c] = listComments(ed.state.doc);
    expect(c.quote).toBe("two");
    expect(c.from).toBe(10);
  });

  it("can be changed and removed, the text staying; undo brings them back", () => {
    const ed = setup();
    ed.commands.setTextSelection({ from: 5, to: 8 });
    ed.commands.addComment("Note", "a");
    ed.commands.updateComment("a", "Better note");
    expect(listComments(ed.state.doc)[0].text).toBe("Better note");
    ed.commands.removeComment("a");
    expect(listComments(ed.state.doc)).toEqual([]);
    expect(ed.getText()).toBe("One two three four.");
    ed.commands.undo();
    expect(listComments(ed.state.doc)).toHaveLength(1);
  });

  it("survive the document's JSON, and a paste never brings one", () => {
    const ed = setup();
    ed.commands.setTextSelection({ from: 5, to: 8 });
    ed.commands.addComment("Note", "a");
    const again = new Editor({ element: document.createElement("div"), extensions: buildPlainExtensions(), content: ed.getJSON() });
    expect(listComments(again.state.doc)).toHaveLength(1);
    again.destroy();
    expect(ed.getHTML()).toContain('data-comment-id="a"');
    ed.commands.setTextSelection(1);
    ed.commands.insertContent(ed.getHTML());
    expect(listComments(ed.state.doc).filter((c) => c.id === "a")).toHaveLength(1);
    expect(listComments(ed.state.doc)[0].from).toBeGreaterThan(5);
  });
});
