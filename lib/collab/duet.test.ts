import { Schema } from "@tiptap/pm/model";
import { afterEach, describe, expect, it, vi } from "vitest";
import { yXmlFragmentToProsemirrorJSON } from "y-prosemirror";
import * as Y from "yjs";
import {
  createSeedUpdate,
  deriveRoomToken,
  duetAllowsLocalCloudSync,
  duetCloudSyncProjectId,
  generateSharePair,
  generateShareToken,
  isDerivedShare,
  renameSharedOrLocalTitle,
  revokeDuetRoom,
} from "./duet";
import { deriveRoomToken as workerDeriveRoomToken } from "../../duet/src/security";

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

describe("Duet initial seed updates", () => {
  it("encodes the owner's local document without mutating the live room", () => {
    const doc = new Y.Doc();
    const update = createSeedUpdate({
      schema,
      content: localDoc("Owner draft"),
      title: "The Script",
    });

    expect(doc.getXmlFragment("default").length).toBe(0);
    Y.applyUpdate(doc, update);
    expect(textIn(doc)).toBe("Owner draft");
    expect(doc.getMap("duet-meta").get("title")).toBe("The Script");
  });

  it("gives competing owner tabs independent updates for server arbitration", () => {
    const first = createSeedUpdate({
      schema,
      content: localDoc("First owner tab"),
      title: "First",
    });
    const second = createSeedUpdate({
      schema,
      content: localDoc("Second owner tab"),
      title: "Second",
    });
    expect(first).not.toEqual(second);
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

  it("mints a token the Worker will accept as proof it made the pair", async () => {
    const pair = await generateSharePair();

    expect(pair.ownerKey).toHaveLength(43);
    expect(pair.token).toBe(await deriveRoomToken(pair.ownerKey));
    expect(pair.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(pair.token).not.toBe(pair.ownerKey);
  });

  it("derives tokens exactly the way the Worker recomputes them", async () => {
    // The two implementations are separate bundles. If they ever drift, every
    // new share link stops working, so pin them together here.
    for (const ownerKey of [generateShareToken(), generateShareToken(), "a".repeat(43)]) {
      expect(await deriveRoomToken(ownerKey)).toBe(await workerDeriveRoomToken(ownerKey));
    }
  });
});

describe("Stopping a link the Worker will never issue", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("lets an owner clear a pre-derivation link the Worker refuses", async () => {
    const legacy = { token: "t".repeat(43), ownerKey: "o".repeat(43) };
    expect(await isDerivedShare(legacy)).toBe(false);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 403 }))
    );

    await expect(revokeDuetRoom(legacy)).resolves.toBeUndefined();
  });

  it("still refuses to pretend a derived link was stopped", async () => {
    const pair = await generateSharePair();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 403 }))
    );

    await expect(revokeDuetRoom(pair)).rejects.toThrow(/permission/);
  });
});

describe("Duet cloud isolation", () => {
  it("keeps local LWW sync and rename callbacks inert while a session is active", () => {
    const setTitle = vi.fn();
    const renameLocal = vi.fn();
    const session = { setTitle };

    expect(duetAllowsLocalCloudSync(session)).toBe(false);
    renameSharedOrLocalTitle(session, renameLocal, "Shared title");

    expect(setTitle).toHaveBeenCalledWith("Shared title");
    expect(renameLocal).not.toHaveBeenCalled();
    expect(duetAllowsLocalCloudSync(null, true)).toBe(false);
    expect(duetCloudSyncProjectId("project-1", true)).toBe(
      "duet-pending:project-1"
    );
    expect(duetAllowsLocalCloudSync(null)).toBe(true);
  });
});
