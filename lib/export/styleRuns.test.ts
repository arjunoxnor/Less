// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import type { Editor } from "@tiptap/core";
import type { ScriptLine } from "@/types/screenplay";
import { docToLines, linesToDoc } from "./flatten";
import { parseFountain, toFountain } from "./fountain";
import { parseFdx, toFdx } from "./fdx";
import { paginate } from "./paginate";
import { exportPdf } from "./pdf";
import { makeRowStyler } from "./pdfStyle";
import { sanitizeLoose } from "./layout";
import { docOf, line, makeEditor } from "@/lib/editor/testKit";

let editor: Editor | null = null;
afterEach(() => {
  editor?.destroy();
  editor = null;
});

const bold = { type: "bold" };
const italic = { type: "italic" };
const underline = { type: "underline" };
const hl = (color: string) => ({ type: "highlight", attrs: { color } });

describe("formatting in a script, through the export bridge", () => {
  it("carries bold, italic, underline and highlight as stretches of the printed text", () => {
    const lines = docToLines(
      docOf(
        {
          type: "screenplayLine",
          attrs: { element: "action" },
          content: [
            { type: "text", text: "She " },
            { type: "text", text: "never", marks: [bold, underline] },
            { type: "text", text: " looks " },
            { type: "text", text: "back", marks: [italic, hl("#fff1a8")] },
            { type: "text", text: "." },
          ],
        },
        {
          type: "screenplayLine",
          attrs: { element: "parenthetical" },
          content: [{ type: "text", text: " softly", marks: [italic] }],
        },
        line("character", "anna")
      )
    );
    expect(lines[0].text).toBe("She never looks back.");
    expect(lines[0].marks).toEqual([
      { from: 4, to: 9, bold: true, underline: true },
      { from: 16, to: 20, italic: true, highlight: "#fff1a8" },
    ]);
    // The supplied bracket moves the stretch one along, the trimmed space one back.
    expect(lines[1].text).toBe("(softly)");
    expect(lines[1].marks).toEqual([{ from: 1, to: 7, italic: true }]);
    expect(lines[2].marks).toBeUndefined();
  });

  it("rebuilds the same formatted text nodes", () => {
    const lines: ScriptLine[] = [
      { element: "action", text: "One two three.", marks: [{ from: 4, to: 7, bold: true }] },
      { element: "dialogue", text: "Plain." },
    ];
    const doc = linesToDoc(lines);
    expect(doc.content?.[0].content).toEqual([
      { type: "text", text: "One " },
      { type: "text", text: "two", marks: [bold] },
      { type: "text", text: " three." },
    ]);
    expect(docToLines(doc)).toEqual(lines);
  });

  it("Ctrl+B in the editor makes it bold, and asterisks typed stay as typed", () => {
    editor = makeEditor(docOf(line("action", "A quiet room.")));
    editor.commands.setTextSelection({ from: 3, to: 8 });
    editor.commands.toggleBold();
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    editor.commands.insertContent(" *beat*");
    const [l] = docToLines(editor.getJSON());
    expect(l.text).toBe("A quiet room. *beat*");
    expect(l.marks).toEqual([{ from: 2, to: 7, bold: true }]);
  });
});

describe("Fountain", () => {
  const lines: ScriptLine[] = [
    { element: "scene_heading", text: "INT. HOUSE - NIGHT" },
    {
      element: "action",
      text: "She never looks back at the house.",
      marks: [
        { from: 4, to: 9, bold: true },
        { from: 10, to: 15, italic: true },
        { from: 16, to: 20, underline: true },
        { from: 28, to: 33, bold: true, italic: true },
      ],
    },
    { element: "character", text: "ANNA" },
    { element: "dialogue", text: "I said no.", marks: [{ from: 7, to: 9, underline: true, italic: true }] },
  ];

  it("writes formatting as emphasis and reads it back", () => {
    const out = toFountain(lines);
    expect(out).toContain("She **never** *looks* _back_ at the ***house***.");
    expect(out).toContain("I said _*no*_.");
    const back = parseFountain(out).lines;
    expect(back).toEqual(lines);
  });

  it("keeps spaces outside the markers, and a literal asterisk is still text", () => {
    const out = toFountain([
      { element: "action", text: "Rate: 5 * 3 stars now", marks: [{ from: 12, to: 17, bold: true }] },
    ]);
    expect(out).toContain("Rate: 5 \\* 3 **stars** now");
    expect(parseFountain(out).lines[0]).toEqual({
      element: "action",
      text: "Rate: 5 * 3 stars now",
      marks: [{ from: 12, to: 17, bold: true }],
    });
  });

  it("reads emphasis in an imported file as formatting, not as text", () => {
    const [l] = parseFountain("This is *very* important.\n").lines;
    expect(l).toEqual({ element: "action", text: "This is very important.", marks: [{ from: 8, to: 12, italic: true }] });
  });
});

describe("Final Draft", () => {
  it("writes each styled stretch as its own run and reads it back", () => {
    const lines: ScriptLine[] = [
      {
        element: "action",
        text: "Lights out. Run.",
        marks: [
          { from: 0, to: 6, bold: true, underline: true },
          { from: 12, to: 15, highlight: "#c2e0ff" },
        ],
      },
    ];
    const xml = toFdx(lines);
    expect(xml).toContain('<Text Style="Bold+Underline">Lights</Text>');
    expect(xml).toContain('<Text Background="#C2C2E0E0FFFF">Run</Text>');
    expect(parseFdx(xml).lines).toEqual(lines);
  });

  it("reads Final Draft's own styles, and white as no highlight", () => {
    const xml = `<?xml version="1.0"?><FinalDraft DocumentType="Script"><Content>
      <Paragraph Type="Action"><Text Style="Italic+Bold">Wait</Text><Text Background="#FFFFFFFFFFFF">. Now.</Text></Paragraph>
    </Content></FinalDraft>`;
    expect(parseFdx(xml).lines[0]).toEqual({
      element: "action",
      text: "Wait. Now.",
      marks: [{ from: 0, to: 4, bold: true, italic: true }],
    });
  });
});

describe("PDF", () => {
  const storm =
    "The storm rolls in over the hills and every light in the valley goes out at once, " +
    "leaving only the lighthouse turning slowly against the dark.";
  const at = storm.indexOf("lighthouse");
  const long: ScriptLine = {
    element: "action",
    text: storm,
    marks: [{ from: at, to: at + "lighthouse turn".length, underline: true }],
  };

  it("styles the right words on the right rows, never moving a line or a page", () => {
    const lines: ScriptLine[] = [
      { element: "character", text: "ANNA" },
      { element: "dialogue", text: "Go now.", marks: [{ from: 0, to: 2, bold: true }] },
      long,
    ];
    const plain = paginate(lines.map(({ marks: _m, ...l }) => l));
    const tracked = paginate(lines, { trackSource: true });
    expect(tracked.pages.map((p) => p.ops.map(({ src: _s, ...op }) => op))).toEqual(plain.pages.map((p) => p.ops));

    const style = makeRowStyler(lines, sanitizeLoose);
    const ops = tracked.pages[0].ops.filter((op) => op.src != null);
    expect(style(0, ops[0].text)).toBeNull();
    const go = style(1, ops[1].text)!;
    expect(go[0]).toEqual({ text: "Go", col: 0, cols: 2, style: { bold: true } });
    // The underlined phrase starts on the action's second row, spaces and all.
    const rows = ops.filter((op) => op.src === 2);
    expect(style(2, rows[0].text)).toBeNull();
    const second = style(2, rows[1].text)!;
    const under = second.filter((p) => p.style.underline).map((p) => p.text).join("");
    expect(under).toBe("lighthouse turn");
  });

  it("exports a formatted script without trouble", async () => {
    const bytes = await exportPdf([{ element: "action", text: "Bold and bright.", marks: [{ from: 0, to: 4, bold: true }, { from: 9, to: 15, italic: true, highlight: "#fff1a8" }] }]);
    expect(bytes.length).toBeGreaterThan(500);
  });
});
