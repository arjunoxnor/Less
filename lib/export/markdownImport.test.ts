import { describe, expect, it } from "vitest";
import type { JSONContent } from "@tiptap/core";
import { markdownToPlainDoc, textToPlainDoc } from "./markdownImport";
import { plainToMarkdown } from "./plainExport";
import { parseFountain } from "./fountain";

const t = (text: string, ...marks: JSONContent["marks"][]) =>
  marks.length && marks[0] ? { type: "text", text, marks: marks[0] } : { type: "text", text };
const p = (...content: JSONContent[]) => ({ type: "paragraph", content });

const treatment: JSONContent = {
  type: "doc",
  content: [
    { type: "heading", attrs: { level: 1 }, content: [t("Gods of Our Ancestors")] },
    p(t("A "), t("bold", [{ type: "bold" }]), t(" and "), t("quiet", [{ type: "italic" }]), t(" story.")),
    { type: "heading", attrs: { level: 2 }, content: [t("Act One")] },
    {
      type: "bulletList",
      content: [
        { type: "listItem", content: [p(t("The temple burns"))] },
        {
          type: "listItem",
          content: [p(t("She runs")), { type: "bulletList", content: [{ type: "listItem", content: [p(t("Into the rain"))] }] }],
        },
      ],
    },
    { type: "orderedList", content: [{ type: "listItem", content: [p(t("First"))] }, { type: "listItem", content: [p(t("Second"))] }] },
    {
      type: "taskList",
      content: [
        { type: "taskItem", attrs: { checked: true }, content: [p(t("Outline"))] },
        { type: "taskItem", attrs: { checked: false }, content: [p(t("Draft"))] },
      ],
    },
    { type: "blockquote", content: [p(t("Every god was a person once."))] },
    p(t("See "), t("the notes", [{ type: "link", attrs: { href: "https://example.com/a(b)" } }]), t(", cut "), t("this", [{ type: "strike" }]), t(", run "), t("npm test", [{ type: "code" }])),
    { type: "horizontalRule" },
    p(t("Literal *stars* and snake_case_names stay.")),
  ],
};

describe("Markdown back into a document", () => {
  it("brings an exported treatment back as it left", () => {
    expect(markdownToPlainDoc(plainToMarkdown(treatment))).toEqual(treatment);
  });

  it("reads headings, lists and emphasis written by hand", () => {
    const doc = markdownToPlainDoc("# Title\n\nSome *soft* and __strong__ words\nthat wrap.\n\n- one\n- two\n");
    expect(doc.content![0]).toEqual({ type: "heading", attrs: { level: 1 }, content: [t("Title")] });
    expect(doc.content![1]).toEqual(
      p(t("Some "), t("soft", [{ type: "italic" }]), t(" and "), t("strong", [{ type: "bold" }]), t(" words that wrap."))
    );
    expect(doc.content![2].type).toBe("bulletList");
  });

  it("keeps plain text exactly, line by line", () => {
    expect(textToPlainDoc("A *line*\n\nfoo_bar")).toEqual({ type: "doc", content: [p(t("A *line*")), p(t("foo_bar"))] });
  });
});

describe("Fountain text kept as written", () => {
  it("only reads paired markers as emphasis, and takes the scene number off a heading", () => {
    const { lines } = parseFountain(
      "INT. HOUSE - DAY #12A#\n\nMail me at jo_smith@site.com, 5 * 3 is *fifteen* and **loud**, sign here: ____\n"
    );
    expect(lines[0]).toEqual({ element: "scene_heading", text: "INT. HOUSE - DAY" });
    expect(lines[1].text).toBe("Mail me at jo_smith@site.com, 5 * 3 is fifteen and loud, sign here: ____");
  });
});
