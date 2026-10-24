import { describe, it, expect, afterEach } from "vitest";
import { Editor } from "@tiptap/core";
import { runEnterFlow } from "./keymap";
import { buildPlainExtensions } from "./buildPlainExtensions";
import { bookmarksOf, listBookmarks, sanitizeBookmark } from "./bookmarks";
import { docOf, line, lineStartPos, makeEditor, setCaretAtLineEnd } from "./testKit";

let editor: Editor | null = null;
afterEach(() => {
  editor?.destroy();
  editor = null;
});
const script = (...lines: Parameters<typeof docOf>) => (editor = makeEditor(docOf(...lines)));
const marked = (ed: Editor) =>
  bookmarksOf(ed.state).map((e) => ({ text: e.text, color: e.bookmark.color, name: e.bookmark.name }));

describe("bookmarks on script lines", () => {
  it("marks the caret's line, renames, recolours and removes it", () => {
    const ed = script(line("action", "One."), line("action", "Two."));
    setCaretAtLineEnd(ed, 1);
    expect(ed.commands.setBookmark({ color: "blue" })).toBe(true);
    expect(marked(ed)).toEqual([{ text: "Two.", color: "blue", name: "" }]);
    const id = bookmarksOf(ed.state)[0].bookmark.id;
    ed.commands.setBookmark({ name: "Fix the ending" });
    ed.commands.setBookmark({ color: "green" });
    expect(marked(ed)).toEqual([{ text: "Two.", color: "green", name: "Fix the ending" }]);
    expect(bookmarksOf(ed.state)[0].bookmark.id).toBe(id);
    expect(ed.commands.toggleBookmark()).toBe(true);
    expect(marked(ed)).toEqual([]);
  });

  it("starts a new bookmark in the last colour used", () => {
    const ed = script(line("action", "One."), line("action", "Two."));
    setCaretAtLineEnd(ed, 0);
    ed.commands.setBookmark({ color: "purple" });
    setCaretAtLineEnd(ed, 1);
    ed.commands.toggleBookmark();
    expect(marked(ed).map((m) => m.color)).toEqual(["purple", "purple"]);
  });

  it("Enter at the end of a bookmarked line leaves the new line unmarked", () => {
    const ed = script(line("character", "ANNA"));
    setCaretAtLineEnd(ed, 0);
    ed.commands.setBookmark({ color: "red" });
    runEnterFlow(ed);
    expect(ed.state.doc.childCount).toBe(2);
    expect(marked(ed)).toEqual([{ text: "ANNA", color: "red", name: "" }]);
    expect(ed.state.doc.child(1).attrs.bookmark).toBeNull();
  });

  it("a split in the middle keeps one bookmark, on the first half", () => {
    const ed = script(line("action", "Before after."));
    setCaretAtLineEnd(ed, 0);
    ed.commands.setBookmark({ color: "red" });
    ed.commands.setTextSelection(1 + "Before".length);
    runEnterFlow(ed);
    expect(ed.state.doc.childCount).toBe(2);
    expect(marked(ed)).toEqual([{ text: "Before", color: "red", name: "" }]);
  });

  it("a split at the very start keeps the bookmark with the text", () => {
    const ed = script(line("action", "The line."));
    setCaretAtLineEnd(ed, 0);
    ed.commands.setBookmark({ color: "red" });
    ed.commands.setTextSelection(1);
    runEnterFlow(ed);
    expect(ed.state.doc.childCount).toBe(2);
    expect(marked(ed)).toEqual([{ text: "The line.", color: "red", name: "" }]);
  });

  it("two neighbouring bookmarks of one colour are both kept", () => {
    const ed = script(line("action", "One."), line("action", "Two."));
    setCaretAtLineEnd(ed, 0);
    ed.commands.setBookmark({ color: "red" });
    setCaretAtLineEnd(ed, 1);
    ed.commands.setBookmark({ color: "red" });
    expect(marked(ed)).toHaveLength(2);
  });

  it("is one undo step and never stars the line as revised", () => {
    const ed = script(line("action", "One."));
    setCaretAtLineEnd(ed, 0);
    ed.commands.setBookmark({ color: "red" });
    expect(ed.state.doc.child(0).attrs.revised).toBe(false);
    ed.commands.undo();
    expect(marked(ed)).toEqual([]);
  });

  it("survives the document's JSON, and a paste never brings one in", () => {
    const ed = script(line("action", "Keep me."), line("action", ""));
    setCaretAtLineEnd(ed, 0);
    ed.commands.setBookmark({ color: "yellow", name: "Here" });
    const json = ed.getJSON();
    const again = makeEditor(json);
    expect(marked(again)).toEqual([{ text: "Keep me.", color: "yellow", name: "Here" }]);
    again.destroy();
    // The page's own HTML (what a copy puts on the clipboard) carries the
    // colour, but reading HTML back drops it.
    expect(ed.getHTML()).toContain('data-bookmark="yellow"');
    ed.commands.setTextSelection(lineStartPos(ed, 1) + 1);
    ed.commands.insertContent('<p data-element="action" data-bookmark="red">Pasted.</p>');
    expect(marked(ed)).toEqual([{ text: "Keep me.", color: "yellow", name: "Here" }]);
  });
});

describe("bookmarks in documents", () => {
  const doc = (content: object) =>
    (editor = new Editor({ element: document.createElement("div"), extensions: buildPlainExtensions(), content }));

  it("marks paragraphs and headings, and a split keeps one", () => {
    const ed = doc({
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Act one" }] },
        { type: "paragraph", content: [{ type: "text", text: "Some words here." }] },
      ],
    });
    ed.commands.setTextSelection(3);
    ed.commands.setBookmark({ color: "blue" });
    const para = 2 + "Act one".length + 1;
    ed.commands.setTextSelection(para + 5);
    ed.commands.setBookmark({ color: "green" });
    expect(marked(ed).map((m) => m.text)).toEqual(["Act one", "Some words here."]);
    ed.commands.splitBlock();
    expect(marked(ed).map((m) => m.text)).toEqual(["Act one", "Some "]);
  });

  it("Ctrl+Shift+B is the bookmark key, ahead of block quote", () => {
    const ed = doc({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Hi." }] }] });
    ed.commands.setTextSelection(2);
    // What a browser sends: key "B" (shifted) with the B key's code.
    const event = new KeyboardEvent("keydown", { key: "B", ctrlKey: true, shiftKey: true });
    Object.defineProperty(event, "keyCode", { value: 66 });
    const handled = ed.view.someProp("handleKeyDown", (f) => f(ed.view, event));
    expect(handled).toBe(true);
    expect(marked(ed)).toHaveLength(1);
    expect(ed.state.doc.child(0).type.name).toBe("paragraph");
  });
});

describe("sanitizeBookmark", () => {
  it("accepts only a known colour and an id, and caps the name", () => {
    expect(sanitizeBookmark({ id: "abc", color: "red", name: "x".repeat(99) })?.name).toHaveLength(60);
    expect(sanitizeBookmark({ id: "abc", color: "pink" })).toBeNull();
    expect(sanitizeBookmark({ color: "red" })).toBeNull();
    expect(sanitizeBookmark("red")).toBeNull();
    expect(sanitizeBookmark({ id: "a<b>c", color: "blue", name: "a\nb" })).toEqual({ id: "abc", color: "blue", name: "a b" });
  });

  it("lists nothing in a document without bookmarks", () => {
    const ed = script(line("action", "One."));
    expect(listBookmarks(ed.state.doc)).toEqual([]);
  });
});

describe("bookmarks in a document's JSON (the home's list)", () => {
  it("finds each one at the position the editor has it", async () => {
    const { bookmarksInJson } = await import("./bookmarkCore");
    const { digestOf, readDigest } = await import("@/lib/cover/digest");
    const ed = script(line("action", "One."), line("action", ""), line("character", "ANNA"), line("dialogue", "Hi."));
    setCaretAtLineEnd(ed, 1);
    ed.commands.setBookmark({ color: "red" });
    setCaretAtLineEnd(ed, 3);
    ed.commands.setBookmark({ color: "blue", name: "Her line" });
    const fromJson = bookmarksInJson(ed.getJSON());
    expect(fromJson.map((b) => [b.pos, b.color, b.name, b.text])).toEqual(
      bookmarksOf(ed.state).map((e) => [e.pos, e.bookmark.color, e.bookmark.name, e.text])
    );
    const digest = digestOf(ed.getJSON());
    expect(digest.bookmarks).toHaveLength(2);
    expect(readDigest(JSON.stringify(digest))).toEqual(digest);
  });

  it("counts nested lists, empty lines and breaks the way the editor does", async () => {
    const { bookmarksInJson } = await import("./bookmarkCore");
    const ed = (editor = new Editor({
      element: document.createElement("div"),
      extensions: buildPlainExtensions(),
      content: {
        type: "doc",
        content: [
          { type: "paragraph" },
          { type: "paragraph", content: [{ type: "text", text: "a" }, { type: "hardBreak" }, { type: "text", text: "b" }] },
          { type: "horizontalRule" },
          {
            type: "bulletList",
            content: [
              { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Item one" }] }] },
              { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Item two" }] }] },
            ],
          },
          { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "After" }] },
        ],
      },
    }));
    ed.state.doc.descendants((node, pos) => {
      if (node.isTextblock && /Item two|After|^$/.test(node.textContent)) {
        ed.commands.setBookmark({ color: "green" }, pos);
      }
      return !node.isTextblock;
    });
    const want = bookmarksOf(ed.state).map((e) => e.pos);
    expect(want).toHaveLength(3);
    expect(bookmarksInJson(ed.getJSON()).map((b) => b.pos)).toEqual(want);
  });
});
