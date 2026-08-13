// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearProjectShare,
  clearDuetDocumentCache,
  createProjectShare,
  deriveRoomToken,
  persistDuetDocumentCache,
  restoreDuetDocumentCache,
  subscribeProjectShare,
} from "./duet";
import * as Y from "yjs";

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => {
      values.delete(key);
    },
    setItem: (key, value) => {
      values.set(key, String(value));
    },
  };
}

describe("Duet share changes across open tabs", () => {
  beforeEach(() => {
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: memoryStorage(),
    });
  });

  it("notifies the current tab when sharing starts and stops", async () => {
    const seen: Array<string | null> = [];
    const unsubscribe = subscribeProjectShare("project-1", (record) => {
      seen.push(record?.token ?? null);
    });

    const record = await createProjectShare("project-1");
    clearProjectShare("project-1");
    unsubscribe();

    expect(seen).toEqual([null, record.token, null]);
  });

  it("stores a share whose token is derived from its owner key", async () => {
    const record = await createProjectShare("project-derived");

    expect(record.token).toBe(await deriveRoomToken(record.ownerKey));
    expect(JSON.parse(window.localStorage.getItem("less:duet:share:project-derived")!)).toEqual(
      record
    );
    // The record shape is unchanged, so an existing share still loads.
    expect(await createProjectShare("project-derived")).toEqual(record);
  });

  it("reacts to another tab's storage event", async () => {
    const listener = vi.fn();
    const unsubscribe = subscribeProjectShare("project-2", listener);
    const record = await createProjectShare("project-2");
    listener.mockClear();

    window.dispatchEvent(
      new StorageEvent("storage", {
        key: "less:duet:share:project-2",
        newValue: JSON.stringify(record),
      })
    );

    expect(listener).toHaveBeenCalledWith(record);
    unsubscribe();
  });

  it("does not silently retain a revoked sharing record when removal fails", async () => {
    await createProjectShare("project-3");
    const storage = window.localStorage;
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        ...storage,
        getItem: storage.getItem.bind(storage),
        removeItem: () => {
          throw new Error("blocked");
        },
      },
    });

    expect(() => clearProjectShare("project-3")).toThrow(/could not clear/);
  });

  it("merges unsent snapshots from offline tabs after a reload", () => {
    const token = "z".repeat(43);
    const base = new Y.Doc();
    base.getText("script").insert(0, "Base ");
    const first = new Y.Doc();
    const second = new Y.Doc();
    const initial = Y.encodeStateAsUpdate(base);
    Y.applyUpdate(first, initial);
    Y.applyUpdate(second, initial);
    first.getText("script").insert(5, "first ");
    second.getText("script").insert(5, "second ");

    expect(persistDuetDocumentCache(token, "a".repeat(22), first)).toBe(true);
    expect(persistDuetDocumentCache(token, "b".repeat(22), second)).toBe(true);
    const restored = new Y.Doc();
    restoreDuetDocumentCache(token, restored);

    const text = restored.getText("script").toString();
    expect(text.match(/first /g)).toHaveLength(1);
    expect(text.match(/second /g)).toHaveLength(1);
    clearDuetDocumentCache(token);
    const cleared = new Y.Doc();
    restoreDuetDocumentCache(token, cleared);
    expect(cleared.getText("script").toString()).toBe("");
  });
});
