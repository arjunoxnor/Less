import { describe, expect, it } from "vitest";
import { derivePlainTitle, isMeaningfulPlainDoc } from "./plainDocUtils";

describe("plain-document text derivation", () => {
  it("does not invent spaces where adjacent marks split one word", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Note" },
            { type: "text", text: "book", marks: [{ type: "bold" }] },
          ],
        },
      ],
    };
    expect(derivePlainTitle(doc)).toBe("Notebook");
    expect(isMeaningfulPlainDoc(doc)).toBe(true);
  });

  it("keeps structural boundaries between list items", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [{ type: "paragraph", content: [{ type: "text", text: "One" }] }],
            },
            {
              type: "listItem",
              content: [{ type: "paragraph", content: [{ type: "text", text: "Two" }] }],
            },
          ],
        },
      ],
    };
    expect(derivePlainTitle(doc)).toBe("One Two");
  });

  it("truncates by complete Unicode characters", () => {
    const astralLetter = "\u{10437}";
    const text = "a".repeat(79) + astralLetter + "tail";
    const title = derivePlainTitle({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text }] }],
    });
    expect(Array.from(title.slice(0, -1))).toHaveLength(80);
    expect(title).toContain(astralLetter);
    expect(title.endsWith("\u2026")).toBe(true);
  });
});
