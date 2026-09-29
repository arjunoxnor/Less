import { describe, expect, it } from "vitest";
import type { JSONContent } from "@tiptap/core";
import { blocksFromText, deliverNote, pendingNotes, rawTranscript } from "./deliver";

const A = "0123456789abcdef0123456789abcdef";
const B = "fedcba9876543210fedcba9876543210";

const para = (text: string): JSONContent => ({ type: "paragraph", content: [{ type: "text", text }] });
const card = (id: string, extra: Record<string, unknown> = {}): JSONContent => ({
  type: "voicePending",
  attrs: {
    id,
    mime: "audio/webm;codecs=opus",
    duration: 83000,
    recordedAt: "2026-09-28T16:12:00.000Z",
    peaks: "abc",
    state: "saved",
    ...extra,
  },
});

describe("the original transcript", () => {
  it("joins whisper's segments, starting a paragraph at each long pause", () => {
    const raw = rawTranscript([
      { from: 0, to: 2000, text: " So um the opening" },
      { from: 2100, to: 4000, text: " is at the diner." },
      { from: 7000, to: 9000, text: " Then uh she leaves." },
    ]);
    expect(raw).toBe("So um the opening is at the diner.\n\nThen uh she leaves.");
  });

  it("drops whisper's markers for silence", () => {
    expect(
      rawTranscript([
        { from: 0, to: 1000, text: "[BLANK_AUDIO]" },
        { from: 1000, to: 2000, text: " Hello." },
        { from: 2000, to: 3000, text: " (silence) " },
      ])
    ).toBe("Hello.");
  });
});

describe("the cleaned text as blocks", () => {
  it("makes a paragraph of each block and joins the lines inside one", () => {
    expect(blocksFromText("First thought,\ncontinued.\n\n\nSecond thought.")).toEqual([
      para("First thought, continued."),
      para("Second thought."),
    ]);
  });

  it("keeps a dictated list as a list", () => {
    const [list] = blocksFromText("- the diner\n- the motel");
    expect(list.type).toBe("bulletList");
    expect(list.content?.map((item) => item.content?.[0])).toEqual([para("the diner"), para("the motel")]);
  });
});

describe("delivering a note", () => {
  const doc: JSONContent = {
    type: "doc",
    content: [para("Before."), card(A), para("After."), card(B)],
  };

  it("finds the cards waiting in a document", () => {
    expect(pendingNotes(doc).map((n) => n.id)).toEqual([A, B]);
    expect(pendingNotes({ type: "doc", content: [card("not-an-id")] })).toEqual([]);
  });

  it("swaps exactly one card for the transcribed note and leaves the rest alone", () => {
    const next = deliverNote(doc, A, "So um, the diner.", "So, the diner.\n\nShe leaves.");
    expect(next).not.toBeNull();
    const content = next!.content!;
    expect(content[0]).toEqual(para("Before."));
    expect(content[1]).toEqual({
      type: "voiceNote",
      attrs: {
        id: A,
        mime: "audio/webm;codecs=opus",
        duration: 83000,
        recordedAt: "2026-09-28T16:12:00.000Z",
        peaks: "abc",
        raw: "So um, the diner.",
      },
      content: [para("So, the diner."), para("She leaves.")],
    });
    expect(content[2]).toEqual(para("After."));
    expect(content[3]).toEqual(card(B));
    // The input is not modified.
    expect(doc.content![1]).toEqual(card(A));
  });

  it("finds a card nested inside another block", () => {
    const nested: JSONContent = { type: "doc", content: [{ type: "blockquote", content: [card(A)] }] };
    const next = deliverNote(nested, A, "raw", "clean")!;
    expect(next.content![0].content![0].type).toBe("voiceNote");
  });

  it("uses the measured length for a note that was cut off before it had one", () => {
    const cut: JSONContent = { type: "doc", content: [card(A, { duration: 0, state: "recording" }), para("x")] };
    const next = deliverNote(cut, A, "raw", "clean", { durationMs: 61000 })!;
    expect(next.content![0].attrs!.duration).toBe(61000);
  });

  it("leaves a line to keep writing on below a note that ends the document", () => {
    const next = deliverNote({ type: "doc", content: [card(A)] }, A, "raw", "clean")!;
    expect(next.content!.map((n) => n.type)).toEqual(["voiceNote", "paragraph"]);
  });

  it("refuses when the card is not there", () => {
    expect(deliverNote(doc, "ffffffffffffffffffffffffffffffff", "raw", "clean")).toBeNull();
    expect(deliverNote(doc, "../scripts", "raw", "clean")).toBeNull();
  });
});
