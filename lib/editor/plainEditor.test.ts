import { afterEach, describe, expect, it } from "vitest";
import { Editor, type JSONContent } from "@tiptap/core";
import { buildPlainExtensions } from "./buildPlainExtensions";

let editor: Editor | null = null;

function setup(content: JSONContent): Editor {
  editor = new Editor({
    element: document.createElement("div"),
    extensions: buildPlainExtensions(),
    content,
  });
  return editor;
}

function typeWithInputRules(ed: Editor, text: string) {
  for (const char of text) {
    const { from, to } = ed.state.selection;
    let handled = false;
    ed.view.someProp("handleTextInput", (handler) => {
      if (handler(ed.view, from, to, char, () => ed.state.tr.insertText(char, from, to))) {
        handled = true;
        return true;
      }
      return false;
    });
    if (!handled) ed.view.dispatch(ed.state.tr.insertText(char, from, to));
  }
}

afterEach(() => {
  editor?.destroy();
  editor = null;
});

describe("plain-document paragraph rhythm", () => {
  it("Shift+Enter between top-level notes creates a paragraph boundary", () => {
    const ed = setup({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "First" }] }],
    });
    ed.commands.setTextSelection(6);
    expect(ed.commands.keyboardShortcut("Shift-Enter")).toBe(true);
    const blocks = (ed.getJSON() as JSONContent).content ?? [];
    expect(blocks.map((node) => node.type)).toEqual(["paragraph", "paragraph"]);
    expect(blocks.map((node) => node.content?.[0]?.text ?? "")).toEqual(["First", ""]);
  });

  it("keeps a soft break inside a list item", () => {
    const ed = setup({
      type: "doc",
      content: [
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [
                { type: "paragraph", content: [{ type: "text", text: "First" }] },
              ],
            },
          ],
        },
      ],
    });
    ed.commands.setTextSelection(8);
    expect(ed.commands.keyboardShortcut("Shift-Enter")).toBe(true);
    const json = ed.getJSON() as JSONContent;
    const paragraph = json.content?.[0].content?.[0].content?.[0];
    expect(paragraph?.content?.map((node) => node.type)).toEqual(["text", "hardBreak"]);
  });
});

describe("plain-document editing boundaries", () => {
  it("formatting commands apply to a range without replacing its text", () => {
    const ed = setup({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Selected words" }],
        },
      ],
    });
    ed.commands.setTextSelection({ from: 1, to: 9 });
    expect(ed.chain().toggleBold().setColor("#d83a3a").run()).toBe(true);
    expect(ed.getText()).toBe("Selected words");
    const first = (ed.getJSON() as JSONContent).content?.[0].content?.[0];
    expect(first?.marks?.map((mark) => mark.type).sort()).toEqual(["bold", "textStyle"]);
  });

  it("formatting an empty paragraph becomes the stored mark for typed text", () => {
    const ed = setup({ type: "doc", content: [{ type: "paragraph" }] });
    ed.commands.setTextSelection(1);
    expect(ed.commands.toggleBold()).toBe(true);
    expect(ed.commands.insertContent("Word")).toBe(true);
    expect((ed.getJSON() as JSONContent).content?.[0].content?.[0].marks?.[0].type).toBe(
      "bold"
    );
  });

  it("Markdown input rules do not escape a code block", () => {
    const ed = setup({ type: "doc", content: [{ type: "codeBlock" }] });
    ed.commands.setTextSelection(1);
    typeWithInputRules(ed, "# heading");
    const json = ed.getJSON() as JSONContent;
    expect(json.content?.[0].type).toBe("codeBlock");
    expect(json.content?.[0].content?.[0].text).toBe("# heading");
  });

  it("Backspace at the start of an empty list item exits the list cleanly", () => {
    const ed = setup({
      type: "doc",
      content: [
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [{ type: "paragraph" }],
            },
          ],
        },
      ],
    });
    ed.commands.setTextSelection(3);
    expect(ed.commands.keyboardShortcut("Backspace")).toBe(true);
    expect((ed.getJSON() as JSONContent).content?.map((node) => node.type)).not.toContain(
      "bulletList"
    );
  });
});
