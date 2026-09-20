// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { Editor, type JSONContent } from "@tiptap/core";
import { buildPlainExtensions } from "./buildPlainExtensions";
import {
  cleanSwatches,
  currentBoard,
  insertImages,
  putPalette,
  safeHex,
  safeImageSrc,
  setBoardColumns,
  swatchesFromText,
  swatchesToText,
} from "./boardNodes";
import { plainToMarkdown, plainToText } from "@/lib/export/plainExport";

const A = "/api/assets/0123456789abcdef0123456789abcdef";
const B = "/api/assets/fedcba9876543210fedcba9876543210";

const figure = (src: string, caption = ""): JSONContent => ({
  type: "figure",
  attrs: src ? { src, alt: "", width: 1600, height: 900 } : { src: "", alt: "", width: null, height: null },
  ...(caption ? { content: [{ type: "text", text: caption }] } : {}),
});
const para = (text: string): JSONContent => ({
  type: "paragraph",
  attrs: { textAlign: null },
  content: [{ type: "text", text }],
});

/** Top-level blocks, without the empty paragraph the editor keeps at the end. */
function blocks(editor: Editor): JSONContent[] {
  const all = ((editor.getJSON() as JSONContent).content ?? []).slice();
  const last = all[all.length - 1];
  if (last?.type === "paragraph" && !last.content?.length) all.pop();
  return all;
}

function boardEditor(content: JSONContent[]): Editor {
  return new Editor({
    element: document.createElement("div"),
    extensions: buildPlainExtensions({ board: true }),
    content: { type: "doc", content },
  });
}

describe("safeImageSrc", () => {
  it("allows an upload path and an https URL, and nothing else", () => {
    expect(safeImageSrc(A)).toBe(A);
    expect(safeImageSrc("https://example.com/a.png")).toBe("https://example.com/a.png");
    for (const bad of [
      "javascript:alert(1)",
      "data:image/svg+xml;base64,PHN2Zz4=",
      "http://example.com/a.png",
      "//example.com/a.png",
      "/api/assets/../scripts",
      "/api/assets/0123",
      "/api/scripts/0123456789abcdef0123456789abcdef",
      "",
      null,
      42,
    ]) {
      expect(safeImageSrc(bad)).toBe("");
    }
  });
});

describe("palette text", () => {
  it("reads one color per line and writes the same shape back", () => {
    const colors = swatchesFromText("#E8B04A Steppe gold\n#1f3a5f  Night sky\n\nnot a color\n#fff");
    expect(colors).toEqual([
      { hex: "#e8b04a", name: "Steppe gold" },
      { hex: "#1f3a5f", name: "Night sky" },
      { hex: "#ffffff", name: "" },
    ]);
    expect(swatchesToText(colors)).toBe("#e8b04a Steppe gold\n#1f3a5f Night sky\n#ffffff");
  });

  it("refuses anything that is not a plain hex color, and caps the strip at twelve", () => {
    expect(safeHex("red")).toBeNull();
    expect(safeHex("#12345g")).toBeNull();
    expect(safeHex("#123456;background:url(x)")).toBeNull();
    const many = Array.from({ length: 30 }, () => ({ hex: "#112233", name: "x" }));
    expect(cleanSwatches(many)).toHaveLength(12);
    expect(cleanSwatches("nope")).toEqual([]);
  });
});

describe("board blocks in the real editor", () => {
  it("round-trips images with captions, grids, and palettes through the schema and through HTML", () => {
    const content: JSONContent[] = [
      { type: "heading", attrs: { textAlign: null, level: 2 }, content: [{ type: "text", text: "Line" }] },
      figure(A, "Clean, distinct lines"),
      { type: "board", attrs: { columns: 4 }, content: [figure(A, "Wide"), figure(B), figure("", "Empty panel")] },
      { type: "palette", attrs: { colors: [{ hex: "#e8b04a", name: "Steppe gold" }] } },
    ];
    const editor = boardEditor(content);
    const json = blocks(editor);
    expect(json.map((n) => n.type)).toEqual(["heading", "figure", "board", "palette"]);
    expect(json[2].attrs?.columns).toBe(4);
    expect(json[2].content).toHaveLength(3);
    expect(json[3].attrs?.colors).toEqual([{ hex: "#e8b04a", name: "Steppe gold" }]);

    // Copy and paste goes through HTML, so the parse rules must read it back.
    const again = new Editor({
      element: document.createElement("div"),
      extensions: buildPlainExtensions({ board: true }),
      content: editor.getHTML(),
    });
    expect(blocks(again)).toEqual(json);
    editor.destroy();
    again.destroy();
  });

  it("never lets a hostile image link reach the page", () => {
    const editor = boardEditor([figure("javascript:alert(1)", "bad"), figure("data:text/html,<script>1</script>")]);
    const html = editor.getHTML();
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("data:text");
    expect(html).not.toContain("<img");
    expect(html).toContain("Drop an image here");
    editor.destroy();
  });

  it("places one image as a figure after the block the caret is in, never inside it", () => {
    const editor = boardEditor([para("References for the look."), para("After.")]);
    editor.commands.setTextSelection(5); // inside the first paragraph
    expect(insertImages(editor, [{ src: A, width: 800, height: 600 }])).toBe(true);
    expect(blocks(editor).map((n) => n.type)).toEqual(["paragraph", "figure", "paragraph"]);
    editor.destroy();
  });

  it("turns several images into one grid", () => {
    const editor = boardEditor([para("Wall")]);
    insertImages(editor, [{ src: A }, { src: B }, { src: A }]);
    const [, grid] = blocks(editor);
    expect(grid.type).toBe("board");
    expect(grid.attrs?.columns).toBe(3);
    expect(grid.content).toHaveLength(3);
    editor.destroy();
  });

  it("adds images dropped into a grid to that grid, after the panel they landed on", () => {
    const editor = boardEditor([
      { type: "board", attrs: { columns: 3 }, content: [figure(A, "Shot 1"), figure(B, "Shot 3")] },
    ]);
    // Caret inside the first panel's caption.
    let captionPos = 0;
    editor.state.doc.descendants((node, pos) => {
      if (!captionPos && node.isText && node.text === "Shot 1") captionPos = pos + 1;
    });
    insertImages(editor, [{ src: A, caption: "Shot 2" }], captionPos);
    const [grid, ...rest] = blocks(editor);
    expect(rest).toEqual([]); // no second grid, no nesting
    expect(grid.content?.map((f) => f.content?.[0]?.text)).toEqual(["Shot 1", "Shot 2", "Shot 3"]);
    editor.destroy();
  });

  it("skips images whose link is not allowed instead of inserting an empty frame", () => {
    const editor = boardEditor([para("x")]);
    expect(insertImages(editor, [{ src: "http://insecure.example/a.png" }])).toBe(false);
    expect(blocks(editor)).toHaveLength(1);
    editor.destroy();
  });

  it("changes the columns of the grid under the caret, within 2 to 6", () => {
    const editor = boardEditor([{ type: "board", attrs: { columns: 3 }, content: [figure(A, "x")] }]);
    editor.commands.setTextSelection(3);
    expect(currentBoard(editor)?.columns).toBe(3);
    setBoardColumns(editor, 9);
    expect(currentBoard(editor)?.columns).toBe(6);
    setBoardColumns(editor, 0);
    expect(currentBoard(editor)?.columns).toBe(2);
    editor.destroy();
  });

  it("adds a palette, then edits the selected one in place", () => {
    const editor = boardEditor([para("Color")]);
    putPalette(editor, [{ hex: "#e8b04a", name: "Gold" }]);
    expect(blocks(editor).map((n) => n.type)).toEqual(["paragraph", "palette"]);
    let palettePos = -1;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === "palette") palettePos = pos;
    });
    editor.commands.setNodeSelection(palettePos);
    putPalette(editor, [{ hex: "#1f3a5f", name: "Night" }, { hex: "#ffffff", name: "Snow" }]);
    const nodes = blocks(editor);
    expect(nodes.map((n) => n.type)).toEqual(["paragraph", "palette"]); // edited, not duplicated
    expect(nodes[1].attrs?.colors).toHaveLength(2);
    editor.destroy();
  });
});

describe("exporting a board", () => {
  const doc: JSONContent = {
    type: "doc",
    content: [
      figure(A, "Clean lines"),
      { type: "board", attrs: { columns: 2 }, content: [figure("https://example.com/b.png", "Wide"), figure("", "Empty")] },
      { type: "palette", attrs: { colors: [{ hex: "#e8b04a", name: "Steppe gold" }] } },
    ],
  };

  it("writes images as links and palettes as lists in Markdown", () => {
    const md = plainToMarkdown(doc);
    expect(md).toContain(`![Clean lines](${window.location.origin}${A})`);
    expect(md).toContain("![Wide](https://example.com/b.png)");
    expect(md).toContain("Empty");
    expect(md).toContain("- #e8b04a Steppe gold");
  });

  it("keeps captions and colors in plain text", () => {
    const text = plainToText(doc);
    expect(text).toContain("Clean lines");
    expect(text).toContain("[image: https://example.com/b.png]");
    expect(text).toContain("#e8b04a Steppe gold");
  });
});
