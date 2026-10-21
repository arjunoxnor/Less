import { afterEach, describe, expect, it } from "vitest";
import { Editor, type JSONContent } from "@tiptap/core";
import { buildPlainExtensions } from "./buildPlainExtensions";
import { cleanPastedHTML, DOC_FONTS, docFontOf, sizeOf, styleAt, wordAround } from "./docFonts";

let editor: Editor | null = null;

function setup(content: JSONContent): Editor {
  editor = new Editor({ element: document.createElement("div"), extensions: buildPlainExtensions(), content });
  return editor;
}

const twoLines: JSONContent = {
  type: "doc",
  content: [
    { type: "paragraph", content: [{ type: "text", text: "The first line" }] },
    { type: "paragraph", content: [{ type: "text", text: "The second line" }] },
    { type: "paragraph", content: [{ type: "text", text: "The third line" }] },
  ],
};

/** Each paragraph's runs as [text, fontFamily or null]. */
const runs = (ed: Editor) =>
  ((ed.getJSON() as JSONContent).content ?? []).map((block) =>
    (block.content ?? []).map((t) => [
      t.text,
      (t.marks?.find((m) => m.type === "textStyle")?.attrs?.fontFamily as string | undefined) ?? null,
    ])
  );

afterEach(() => {
  editor?.destroy();
  editor = null;
});

const georgia = DOC_FONTS.find((f) => f.key === "georgia")!;

describe("a font for a line or two", () => {
  it("changes only the selected lines", () => {
    const ed = setup(twoLines);
    // The second line, start to end.
    ed.chain().setTextSelection({ from: 17, to: 32 }).setFontFamily(georgia.stack).run();
    expect(runs(ed)).toEqual([
      [["The first line", null]],
      [["The second line", georgia.stack]],
      [["The third line", null]],
    ]);
  });

  it("reads the font back from the selection, and says when it is mixed", () => {
    const ed = setup(twoLines);
    ed.chain().setTextSelection({ from: 17, to: 32 }).setFontFamily(georgia.stack).run();
    expect(styleAt(ed.state, "fontFamily")).toEqual({ value: georgia.stack, mixed: false });
    ed.commands.setTextSelection({ from: 2, to: 32 });
    expect(styleAt(ed.state, "fontFamily").mixed).toBe(true);
    ed.commands.setTextSelection(4);
    expect(styleAt(ed.state, "fontFamily")).toEqual({ value: null, mixed: false });
  });

  it("finds the word the caret is inside, and nothing at the edge of one", () => {
    const ed = setup(twoLines);
    // "The first line": the caret between "fi" and "rst".
    ed.commands.setTextSelection(7);
    expect(wordAround(ed.state)).toEqual({ from: 5, to: 10 });
    // Right after "first": at its edge, the font is for what is typed next.
    ed.commands.setTextSelection(10);
    expect(wordAround(ed.state)).toBeNull();
  });

  it("sets a size on a stretch of text the same way", () => {
    const ed = setup(twoLines);
    ed.chain().setTextSelection({ from: 1, to: 4 }).setFontSize("24px").run();
    const first = (ed.getJSON() as JSONContent).content![0].content!;
    expect(first[0]).toMatchObject({ text: "The", marks: [{ type: "textStyle", attrs: { fontSize: "24px" } }] });
    expect(first[1].text).toBe(" first line");
    expect(first[1].marks).toBeUndefined();
  });
});

describe("reading fonts and sizes", () => {
  it("knows our fonts by their stack, and pasted ones by the font they name", () => {
    expect(docFontOf(georgia.stack)?.key).toBe("georgia");
    expect(docFontOf('"Times New Roman", serif')?.key).toBe("times");
    expect(docFontOf("Arial")?.key).toBe("arial");
    expect(docFontOf("Comic Sans MS")).toBeNull();
  });

  it("reads sizes in px or pt", () => {
    expect(sizeOf("18px")).toBe(18);
    expect(sizeOf("12pt")).toBe(16);
    expect(sizeOf("big")).toBeNull();
  });
});

describe("pasting from other apps", () => {
  it("drops another app's font, size and plain black, and keeps the rest", () => {
    const html =
      '<p><span style="font-family: Arial; font-size: 11pt; color: #000000; font-weight: 700">Bold</span>' +
      '<span style="color: rgb(216, 58, 58); font-family: Arial">red</span></p>';
    const out = cleanPastedHTML(html);
    expect(out).not.toMatch(/font-family|font-size|#000000/);
    expect(out).toContain("font-weight: 700");
    expect(out).toContain("color: rgb(216, 58, 58)");
  });

  it("leaves text copied inside LESS exactly as it was", () => {
    const html = '<p data-pm-slice="1 1 []"><span style="font-family: Georgia">kept</span></p>';
    expect(cleanPastedHTML(html)).toBe(html);
  });
});
