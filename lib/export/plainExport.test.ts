import { describe, expect, it } from "vitest";
import { plainToMarkdown, plainToText } from "./plainExport";

describe("plain-document export", () => {
  it("preserves hard breaks and link destinations", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "First" },
            { type: "hardBreak" },
            {
              type: "text",
              text: "site",
              marks: [{ type: "link", attrs: { href: "https://example.com/a_(b)" } }],
            },
          ],
        },
      ],
    };
    expect(plainToMarkdown(doc)).toBe(
      "First  \n[site](https://example.com/a_\\(b\\))\n"
    );
    expect(plainToText(doc)).toBe("First\nsite\n");
  });

  it("preserves code blocks, task state, nested lists, and ordered-list starts", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "taskList",
          content: [
            {
              type: "taskItem",
              attrs: { checked: true },
              content: [
                { type: "paragraph", content: [{ type: "text", text: "Done" }] },
                {
                  type: "bulletList",
                  content: [
                    {
                      type: "listItem",
                      content: [
                        { type: "paragraph", content: [{ type: "text", text: "Nested" }] },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
        {
          type: "orderedList",
          attrs: { start: 3 },
          content: [
            {
              type: "listItem",
              content: [{ type: "paragraph", content: [{ type: "text", text: "Third" }] }],
            },
          ],
        },
        { type: "codeBlock", content: [{ type: "text", text: "const value = `x`;" }] },
      ],
    };
    expect(plainToMarkdown(doc)).toBe(
      "- [x] Done\n  - Nested\n\n3. Third\n\n```\nconst value = `x`;\n```\n"
    );
    expect(plainToText(doc)).toBe(
      "[x] Done\n  - Nested\n\n3. Third\n\nconst value = `x`;\n"
    );
  });

  it("keeps separate paragraphs inside a blockquote", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "blockquote",
          content: [
            { type: "paragraph", content: [{ type: "text", text: "One" }] },
            { type: "paragraph", content: [{ type: "text", text: "Two" }] },
          ],
        },
      ],
    };
    expect(plainToMarkdown(doc)).toBe("> One\n>\n> Two\n");
    expect(plainToText(doc)).toBe("One\n\nTwo\n");
  });

  it("keeps literal Markdown-looking paragraphs and a code block's final newline", () => {
    const doc = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "# Literal heading" }] },
        { type: "paragraph", content: [{ type: "text", text: "1. Literal item" }] },
        { type: "paragraph", content: [{ type: "text", text: "---" }] },
        { type: "paragraph", content: [{ type: "text", text: "> Literal quote" }] },
        { type: "codeBlock", content: [{ type: "text", text: "line\n" }] },
      ],
    };
    expect(plainToMarkdown(doc)).toBe(
      "\\# Literal heading\n\n1\\. Literal item\n\n\\---\n\n\\> Literal quote\n\n```\nline\n```\n"
    );
    expect(plainToText(doc)).toBe(
      "# Literal heading\n\n1. Literal item\n\n---\n\n> Literal quote\n\nline\n"
    );
  });
});
