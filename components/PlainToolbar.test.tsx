// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Editor, type JSONContent } from "@tiptap/core";
import { buildPlainExtensions } from "@/lib/editor/buildPlainExtensions";
import { DOC_FONTS } from "@/lib/editor/docFonts";
import { FontControls } from "./PlainToolbar";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;
let editor: Editor | null = null;

const doc: JSONContent = {
  type: "doc",
  content: [
    { type: "paragraph", content: [{ type: "text", text: "Opening line" }] },
    { type: "paragraph", content: [{ type: "text", text: "A different line" }] },
  ],
};

function mount(onBaseChange = vi.fn()) {
  editor = new Editor({ element: document.createElement("div"), extensions: buildPlainExtensions(), content: doc });
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(<FontControls editor={editor} baseFont="calibri" baseSize={16} onBaseChange={onBaseChange} />));
  return onBaseChange;
}

const button = (label: RegExp) =>
  [...host!.querySelectorAll<HTMLButtonElement>("button")].find((b) => label.test(b.getAttribute("aria-label") ?? b.textContent ?? ""))!;
const item = (text: string) =>
  [...host!.querySelectorAll<HTMLButtonElement>("[role=menuitemradio], [role=menuitem]")].find((b) =>
    b.textContent?.startsWith(text)
  )!;
const fontsOf = (ed: Editor) =>
  ((ed.getJSON() as JSONContent).content ?? []).map((block) =>
    (block.content ?? []).map((t) => [t.text, t.marks?.find((m) => m.type === "textStyle")?.attrs?.fontFamily ?? null])
  );

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  editor?.destroy();
  root = null;
  host = null;
  editor = null;
});

describe("the font and size controls", () => {
  const georgia = DOC_FONTS.find((f) => f.key === "georgia")!;

  it("change only the line that is selected", () => {
    mount();
    act(() => {
      editor!.commands.setTextSelection({ from: 15, to: 31 });
    });
    act(() => button(/^Font:/).click());
    act(() => item("Georgia").click());
    expect(fontsOf(editor!)).toEqual([[["Opening line", null]], [["A different line", georgia.stack]]]);
    // The control reads the font back from the selection.
    expect(button(/^Font:/).getAttribute("aria-label")).toBe("Font: Georgia");
  });

  it("with nothing selected, change the word the cursor is in", () => {
    mount();
    // Between "Ope" and "ning".
    act(() => {
      editor!.commands.setTextSelection(4);
    });
    act(() => button(/^Font:/).click());
    act(() => item("Georgia").click());
    expect(fontsOf(editor!)[0]).toEqual([
      ["Opening", georgia.stack],
      [" line", null],
    ]);
    expect(editor!.state.selection.from).toBe(4);
  });

  it("set a size on what is selected, and the default only from its own menu item", () => {
    const onBase = mount();
    act(() => {
      editor!.commands.setTextSelection({ from: 1, to: 8 });
    });
    act(() => button(/^Size:/).click());
    act(() => item("24").click());
    const first = (editor!.getJSON() as JSONContent).content![0].content!;
    expect(first[0]).toMatchObject({ text: "Opening", marks: [{ type: "textStyle", attrs: { fontSize: "24px" } }] });
    expect(onBase).not.toHaveBeenCalled();
    act(() => button(/^Size:/).click());
    act(() => item("Make 24 the default size").click());
    expect(onBase).toHaveBeenCalledWith({ docFontSize: 24 });
  });
});
