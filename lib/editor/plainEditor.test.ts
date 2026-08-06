import { afterEach, describe, expect, it } from "vitest";
import { Editor, type JSONContent } from "@tiptap/core";
import { closeHistory } from "@tiptap/pm/history";
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
  it("does not install the screenplay pagination extension", () => {
    const ed = setup({ type: "doc", content: [{ type: "paragraph" }] });
    expect(ed.extensionManager.extensions.map((extension) => extension.name)).not.toContain(
      "pagination"
    );
  });

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

  it("capitalizes the first letter after a hard break", () => {
    const ed = setup({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "First" },
            { type: "hardBreak" },
          ],
        },
      ],
    });
    ed.commands.setTextSelection(7);
    typeWithInputRules(ed, "next");
    expect(ed.getText({ blockSeparator: "\n" })).toBe("First\nNext");
  });

  it("lets Enter split a block after a lowercase standalone pronoun", () => {
    const ed = setup({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Maybe i" }],
        },
      ],
    });
    ed.commands.setTextSelection(8);
    expect(ed.commands.keyboardShortcut("Enter")).toBe(true);
    const blocks = (ed.getJSON() as JSONContent).content ?? [];
    expect(blocks.map((node) => node.type)).toEqual(["paragraph", "paragraph"]);
    expect(blocks[0].content?.[0].text).toBe("Maybe i");
  });

  it("recognizes a sentence boundary followed by a curly quote", () => {
    const ed = setup({ type: "doc", content: [{ type: "paragraph" }] });
    ed.commands.setTextSelection(1);
    typeWithInputRules(ed, "done.\u201d next");
    expect(ed.getText()).toBe("Done.\u201d Next");
  });

  it("replaces a range when Smart Caps handles the typed character", () => {
    const first = setup({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "old" }] }],
    });
    first.commands.setTextSelection({ from: 1, to: 4 });
    typeWithInputRules(first, "a");
    expect(first.getText()).toBe("A");
    first.destroy();

    const sentence = setup({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Done. old" }] },
      ],
    });
    sentence.commands.setTextSelection({ from: 7, to: 10 });
    typeWithInputRules(sentence, "n");
    expect(sentence.getText()).toBe("Done. N");
  });

  it("replaces a selected suffix when capitalizing a standalone pronoun", () => {
    const ed = setup({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Maybe iold" }] },
      ],
    });
    ed.commands.setTextSelection({ from: 8, to: 11 });
    typeWithInputRules(ed, " ");
    expect(ed.getText()).toBe("Maybe I ");
  });

  it("normalizes Windows line endings on plain-text paste and undoes once", () => {
    const ed = setup({ type: "doc", content: [{ type: "paragraph" }] });
    ed.commands.setTextSelection(1);
    ed.view.dispatch(closeHistory(ed.state.tr));
    expect(
      ed.view.pasteText("One\r\nTwo\r\n\r\nThree", new Event("paste") as ClipboardEvent)
    ).toBe(true);
    const blocks = (ed.getJSON() as JSONContent).content ?? [];
    expect(blocks.map((node) => node.content?.[0]?.text)).toEqual([
      "One",
      "Two",
      "Three",
    ]);
    expect(ed.commands.undo()).toBe(true);
    expect(ed.getText()).toBe("");
  });

  it("keeps supported structure and marks from rich-text paste", () => {
    const ed = setup({ type: "doc", content: [{ type: "paragraph" }] });
    ed.commands.setTextSelection(1);
    expect(
      ed.view.pasteHTML(
        '<h1 style="font-size:72px">Heading</h1>' +
          '<p class="MsoNormal"><strong>Bold</strong> <a href="https://example.com/long">link</a></p>' +
          "<ul><li>Item</li></ul>",
        new Event("paste") as ClipboardEvent
      )
    ).toBe(true);
    const blocks = (ed.getJSON() as JSONContent).content ?? [];
    expect(blocks.slice(0, 3).map((node) => node.type)).toEqual([
      "heading",
      "paragraph",
      "bulletList",
    ]);
    expect(blocks[3]).toMatchObject({ type: "paragraph" });
    expect(ed.getText({ blockSeparator: "\n" }).replace(/\n+/g, "\n")).toBe(
      "Heading\nBold link\nItem\n"
    );
    expect(blocks[1].content?.[0].marks?.[0].type).toBe("bold");
    expect(blocks[1].content?.[2].marks?.[0]).toMatchObject({
      type: "link",
      attrs: { href: "https://example.com/long" },
    });
  });

  it("edits and undoes at the end of a 500-block document", () => {
    const ed = setup({
      type: "doc",
      content: Array.from({ length: 500 }, (_, index) => ({
        type: "paragraph",
        content: [{ type: "text", text: `Block ${index}` }],
      })),
    });
    ed.commands.setTextSelection(ed.state.doc.content.size - 1);
    ed.view.dispatch(closeHistory(ed.state.tr));
    typeWithInputRules(ed, "x");
    expect(ed.getText().endsWith("Block 499x")).toBe(true);
    expect(ed.commands.undo()).toBe(true);
    expect(ed.getText().endsWith("Block 499")).toBe(true);
    expect((ed.getJSON() as JSONContent).content).toHaveLength(500);
  });
});
