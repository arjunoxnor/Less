import { Schema } from "@tiptap/pm/model";
import { describe, expect, it } from "vitest";
import { yXmlFragmentToProsemirrorJSON } from "y-prosemirror";
import * as Y from "yjs";
import {
  generateShareToken,
  seedSharedDocumentOnce,
  type SeedGuard,
} from "./duet";

const schema = new Schema({
  nodes: {
    doc: { content: "screenplayLine+" },
    text: { group: "inline" },
    screenplayLine: {
      content: "inline*",
      group: "block",
      attrs: { element: { default: "action" } },
    },
  },
});

const localDoc = (text: string) => ({
  type: "doc",
  content: [
    {
      type: "screenplayLine",
      attrs: { element: "action" },
      content: [{ type: "text", text }],
    },
  ],
});

function textIn(doc: Y.Doc): string {
  const json = yXmlFragmentToProsemirrorJSON(doc.getXmlFragment("default"));
  return ((json.content?.[0] as { content?: { text?: string }[] })?.content?.[0]?.text ?? "");
}

describe("Duet initial seeding", () => {
  it("seeds an owner's genuinely empty room from the local document", () => {
    const doc = new Y.Doc();
    const guard: SeedGuard = { checked: false };
    const result = seedSharedDocumentOnce({
      doc,
      schema,
      content: localDoc("Owner draft"),
      title: "The Script",
      owner: true,
      guard,
    });

    expect(result).toBe("seeded");
    expect(textIn(doc)).toBe("Owner draft");
    expect(doc.getMap("duet-meta").get("title")).toBe("The Script");
  });

  it("does not seed over a room that already contains text", () => {
    const doc = new Y.Doc();
    const firstGuard: SeedGuard = { checked: false };
    seedSharedDocumentOnce({
      doc,
      schema,
      content: localDoc("Shared version"),
      title: "Shared",
      owner: true,
      guard: firstGuard,
    });

    const result = seedSharedDocumentOnce({
      doc,
      schema,
      content: localDoc("Stale local version"),
      title: "Local",
      owner: true,
      guard: { checked: false },
    });

    expect(result).toBe("room-not-empty");
    expect(textIn(doc)).toBe("Shared version");
  });

  it("never seeds twice from the same client", () => {
    const doc = new Y.Doc();
    const guard: SeedGuard = { checked: false };
    seedSharedDocumentOnce({
      doc,
      schema,
      content: localDoc("First"),
      title: "First",
      owner: true,
      guard,
    });
    const result = seedSharedDocumentOnce({
      doc,
      schema,
      content: localDoc("Second"),
      title: "Second",
      owner: true,
      guard,
    });

    expect(result).toBe("already-checked");
    expect(textIn(doc)).toBe("First");
  });

  it("does not resurrect local text into a room whose shared text was cleared", () => {
    const doc = new Y.Doc();
    seedSharedDocumentOnce({
      doc,
      schema,
      content: localDoc("Intentionally removed"),
      title: "Shared",
      owner: true,
      guard: { checked: false },
    });
    doc.getXmlFragment("default").delete(0, 1);

    const result = seedSharedDocumentOnce({
      doc,
      schema,
      content: localDoc("Stale local mirror"),
      title: "Local",
      owner: true,
      guard: { checked: false },
    });

    expect(result).toBe("room-not-empty");
    expect(doc.getXmlFragment("default").length).toBe(0);
  });
});

describe("Duet share tokens", () => {
  it("generates long random URL-safe tokens", () => {
    const tokens = new Set(Array.from({ length: 64 }, () => generateShareToken()));
    expect(tokens.size).toBe(64);
    for (const token of tokens) {
      expect(token).toHaveLength(43);
      expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    }
  });
});
