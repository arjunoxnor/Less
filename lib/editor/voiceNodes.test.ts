// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { Editor, type JSONContent } from "@tiptap/core";
import { buildPlainExtensions } from "./buildPlainExtensions";
import {
  ensureVoicePending,
  findVoiceNode,
  insertVoicePending,
  pendingStatus,
  removeVoicePending,
  updateVoicePending,
  type OriginalTranscript,
} from "./voiceNodes";
import { plainToMarkdown, plainToText } from "@/lib/export/plainExport";

const A = "0123456789abcdef0123456789abcdef";
const B = "fedcba9876543210fedcba9876543210";

const para = (text: string): JSONContent => ({
  type: "paragraph",
  attrs: { textAlign: null },
  ...(text ? { content: [{ type: "text", text }] } : {}),
});
const card = (id: string, extra: Record<string, unknown> = {}): JSONContent => ({
  type: "voicePending",
  attrs: {
    id,
    mime: "audio/webm;codecs=opus",
    duration: 83000,
    recordedAt: "2026-09-28T16:12:00.000Z",
    peaks: "0az",
    state: "saved",
    ...extra,
  },
});
const note = (id: string, texts: string[], raw = "So um the diner."): JSONContent => ({
  type: "voiceNote",
  attrs: {
    id,
    mime: "audio/webm;codecs=opus",
    duration: 83000,
    recordedAt: "2026-09-28T16:12:00.000Z",
    peaks: "0az",
    raw,
  },
  content: texts.map(para),
});

let editor: Editor | null = null;

function setup(content: JSONContent[], onOriginal?: (n: OriginalTranscript) => void): Editor {
  const element = document.createElement("div");
  document.body.appendChild(element);
  editor = new Editor({
    element,
    extensions: buildPlainExtensions({ onOriginalTranscript: onOriginal }),
    content: { type: "doc", content },
  });
  return editor;
}

afterEach(() => {
  editor?.destroy();
  editor = null;
  document.body.innerHTML = "";
});

/** A real key press through the editor's handlers. (TipTap's keyboardShortcut
 *  command replays a handler's steps through its own mapping, which garbles a
 *  handler that deletes and then inserts.) */
function press(ed: Editor, key: string, shiftKey = false) {
  const event = new KeyboardEvent("keydown", { key, shiftKey, bubbles: true, cancelable: true });
  ed.view.someProp("handleKeyDown", (handle) => handle(ed.view, event));
}

/** Top-level node types, without the empty line kept at the end. */
function shape(ed: Editor): string[] {
  const all = (ed.getJSON().content ?? []).map((n) => n.type ?? "");
  if (all[all.length - 1] === "paragraph" && !ed.state.doc.lastChild?.content.size) all.pop();
  return all;
}

describe("voice notes in a document", () => {
  it("load and save back exactly, pending or transcribed", () => {
    const content = [para("Before."), card(A), note(B, ["So, the diner.", "She leaves."]), para("After.")];
    const ed = setup(content);
    expect(ed.getJSON().content).toEqual(content);
  });

  it("survive a copy and paste as HTML", () => {
    const ed = setup([card(A), note(B, ["So, the diner."]), para("")]);
    const html = ed.getHTML();
    ed.commands.setContent("<p></p>");
    ed.commands.setContent(html);
    const types = shape(ed);
    expect(types).toEqual(["voicePending", "voiceNote"]);
    expect(findVoiceNode(ed, A)?.node.attrs.duration).toBe(83000);
    expect(findVoiceNode(ed, B)?.node.attrs.raw).toBe("So um the diner.");
    expect(findVoiceNode(ed, B)?.node.textContent).toBe("So, the diner.");
  });

  it("refuse attributes that are not what they claim", () => {
    const ed = setup([]);
    ed.commands.setContent(
      '<div data-voice-pending data-id="../../x" data-duration="-5" data-mime="text/html" data-peaks="<b>"></div>'
    );
    const node = ed.state.doc.firstChild!;
    expect(node.type.name).toBe("voicePending");
    expect(node.attrs.id).toBe("");
    expect(node.attrs.duration).toBe(0);
    expect(node.attrs.mime).toBe("");
    expect(node.attrs.peaks).toBe("b");
  });
});

describe("starting a recording", () => {
  it("takes the place of an empty line and leaves the caret below it", () => {
    const ed = setup([para("Notes."), para("")]);
    ed.commands.setTextSelection(ed.state.doc.content.size - 1);
    insertVoicePending(ed, { id: A, recordedAt: "2026-09-28T16:12:00.000Z" });
    expect(shape(ed)).toEqual(["paragraph", "voicePending"]);
    const { $from } = ed.state.selection;
    expect($from.parent.type.name).toBe("paragraph");
    expect($from.before(1)).toBeGreaterThan(findVoiceNode(ed, A)!.pos);
    expect(findVoiceNode(ed, A)!.node.attrs.state).toBe("recording");
  });

  it("goes below the paragraph being written, never splitting it", () => {
    const ed = setup([para("Half a thought"), para("Next.")]);
    ed.commands.setTextSelection(5);
    insertVoicePending(ed, { id: A });
    expect(shape(ed)).toEqual(["paragraph", "voicePending", "paragraph"]);
    expect(ed.state.doc.firstChild!.textContent).toBe("Half a thought");
    expect(ed.state.selection.from).toBe(5);
  });

  it("goes below a note the caret is inside", () => {
    const ed = setup([note(B, ["One.", "Two."]), para("")]);
    ed.commands.setTextSelection(4);
    insertVoicePending(ed, { id: A });
    expect(shape(ed)).toEqual(["voiceNote", "voicePending"]);
  });
});

describe("finishing a recording", () => {
  it("fills in the card without making an undo step of it", () => {
    const ed = setup([para("Notes.")]);
    ed.commands.setTextSelection(3);
    insertVoicePending(ed, { id: A });
    updateVoicePending(ed, A, { state: "saved", duration: 5000, peaks: "zz" });
    expect(findVoiceNode(ed, A)!.node.attrs).toMatchObject({ state: "saved", duration: 5000 });
    ed.commands.undo();
    // Undo takes the card away; it never turns it back into a live recording.
    const left = findVoiceNode(ed, A);
    expect(left === null || left.node.attrs.state === "saved").toBe(true);
  });

  it("puts back a card that was deleted while recording", () => {
    const ed = setup([para("Notes.")]);
    ed.commands.setTextSelection(3);
    insertVoicePending(ed, { id: A, recordedAt: "2026-09-28T16:12:00.000Z" });
    const hit = findVoiceNode(ed, A)!;
    ed.view.dispatch(ed.state.tr.delete(hit.pos, hit.pos + hit.node.nodeSize));
    expect(findVoiceNode(ed, A)).toBeNull();
    ensureVoicePending(ed, { id: A, state: "saved", duration: 4000, recordedAt: "2026-09-28T16:12:00.000Z" });
    expect(findVoiceNode(ed, A)!.node.attrs.duration).toBe(4000);
  });

  it("discarding takes the card away", () => {
    const ed = setup([para("Notes.")]);
    ed.commands.setTextSelection(3);
    insertVoicePending(ed, { id: A });
    expect(removeVoicePending(ed, A)).toBe(true);
    expect(shape(ed)).toEqual(["paragraph"]);
  });
});

describe("writing in a transcribed note", () => {
  it("Enter on an empty last line steps out below the note", () => {
    const ed = setup([note(B, ["One."]), para("After.")]);
    // End of "One.", then Enter twice.
    ed.commands.setTextSelection(1 + 1 + 4);
    press(ed, "Enter");
    expect(findVoiceNode(ed, B)!.node.childCount).toBe(2);
    press(ed, "Enter");
    const noteNode = findVoiceNode(ed, B)!.node;
    expect(noteNode.childCount).toBe(1);
    const { $from } = ed.state.selection;
    expect($from.depth).toBe(1);
    expect($from.parent.type.name).toBe("paragraph");
    expect(shape(ed)).toEqual(["voiceNote", "paragraph", "paragraph"]);
  });

  it("Shift+Enter starts a new paragraph inside the note, like on the page", () => {
    const ed = setup([note(B, ["One two."]), para("")]);
    ed.commands.setTextSelection(1 + 1 + 3);
    press(ed, "Enter", true);
    const noteNode = findVoiceNode(ed, B)!.node;
    expect(noteNode.childCount).toBe(2);
    expect(noteNode.child(0).textContent).toBe("One");
  });

  it("the header's x removes the marker and keeps the text", () => {
    const ed = setup([para("Before."), note(B, ["One.", "Two."]), para("After.")]);
    const x = ed.view.dom.querySelector<HTMLButtonElement>(".vn-head-x")!;
    x.click();
    expect(shape(ed)).toEqual(["paragraph", "paragraph", "paragraph", "paragraph"]);
    expect(ed.getText({ blockSeparator: "\n" })).toBe("Before.\nOne.\nTwo.\nAfter.");
  });

  it("Original shows the transcript word for word", () => {
    const onOriginal = vi.fn();
    const ed = setup([note(B, ["So, the diner."], "So um, the the diner.")], onOriginal);
    ed.view.dom.querySelector<HTMLButtonElement>(".vn-head-btn")!.click();
    expect(onOriginal).toHaveBeenCalledWith(
      expect.objectContaining({ id: B, raw: "So um, the the diner.", duration: 83000 })
    );
  });

  it("draws a margin line and a header that the page breaks skip", () => {
    const ed = setup([note(B, ["One."])]);
    const section = ed.view.dom.querySelector(".vn-note")!;
    expect(section.querySelector(".vn-rail")).not.toBeNull();
    expect(section.querySelector(".vn-head")!.hasAttribute("data-page-skip")).toBe(true);
    expect(section.querySelector(".vn-head")!.getAttribute("contenteditable")).toBe("false");
  });
});

describe("a pending card", () => {
  it("says where the recording is", () => {
    expect(pendingStatus({ recordingHere: true, state: "recording", local: null, upload: null })).toBe("Recording");
    expect(
      pendingStatus({ recordingHere: false, state: "saved", local: true, upload: null })
    ).toMatch(/Saved on this device/);
    expect(
      pendingStatus({ recordingHere: false, state: "saved", local: true, upload: { state: "uploading" } })
    ).toBe("Uploading");
    expect(
      pendingStatus({
        recordingHere: false,
        state: "saved",
        local: true,
        upload: { state: "waiting", reason: "Sign in with Google to have it transcribed." },
      })
    ).toBe("Sign in with Google to have it transcribed.");
    expect(
      pendingStatus({ recordingHere: false, state: "saved", local: true, upload: { state: "done" } })
    ).toBe("Waiting to be transcribed");
    expect(pendingStatus({ recordingHere: false, state: "saved", local: false, upload: null })).toBe(
      "Waiting to be transcribed"
    );
    expect(pendingStatus({ recordingHere: false, state: "recording", local: false, upload: null })).toMatch(
      /Unfinished recording/
    );
  });

  it("renders as a card with its length", () => {
    const ed = setup([card(A)]);
    const el = ed.view.dom.querySelector(".vn-card")!;
    expect(el.textContent).toContain("Voice note");
    expect(el.textContent).toContain("1:23");
    expect(el.querySelectorAll(".vn-bar")).toHaveLength(48);
  });
});

describe("exporting", () => {
  it("writes a transcribed note as its text, and a pending one as a line saying so", () => {
    const doc: JSONContent = {
      type: "doc",
      content: [para("Before."), note(B, ["So, the diner.", "She leaves."]), card(A)],
    };
    const text = plainToText(doc);
    expect(text).toContain("Before.\n\nSo, the diner.\n\nShe leaves.");
    expect(text).toContain("[Voice note, not transcribed yet (1:23)");
    expect(text).toContain(`/api/assets/${A}`);
    const md = plainToMarkdown(doc);
    expect(md).toContain("So, the diner.\n\nShe leaves.");
    expect(md).toContain("*\\[Voice note, not transcribed yet (1:23)");
  });
});
