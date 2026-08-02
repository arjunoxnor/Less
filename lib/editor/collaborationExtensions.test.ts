import { describe, expect, it } from "vitest";
import { Awareness } from "y-protocols/awareness";
import type { WebsocketProvider } from "y-websocket";
import * as Y from "yjs";
import { buildExtensions } from "./buildExtensions";

describe("collaborative screenplay extensions", () => {
  it("uses Yjs history and carets without installing local UndoRedo", () => {
    const doc = new Y.Doc();
    const awareness = new Awareness(doc);
    const provider = { awareness } as WebsocketProvider;
    const names = buildExtensions({
      collaboration: {
        doc,
        provider,
        user: { name: "You", color: "#2563eb" },
      },
    }).map((extension) => extension.name);

    expect(names).toContain("collaboration");
    expect(names).toContain("collaborationCaret");
    expect(names).not.toContain("undoRedo");

    awareness.destroy();
    doc.destroy();
  });
});
