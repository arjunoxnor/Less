// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Editor } from "@tiptap/react";
import type { JSONContent } from "@tiptap/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCloudSync, type CloudSyncOpts } from "./useCloudSync";
import {
  createProject,
  getLastSavedAt,
  isDirty,
  isTitleDirty,
  isTitlePageDirty,
  loadProjectTitlePage,
  markCloudCreated,
  saveProjectDoc,
  saveProjectTitlePage,
  setDirty,
  setLastSavedAt,
  setTitleDirty,
  setTitlePageDirty,
} from "./projects";

const cloud = vi.hoisted(() => ({
  createScript: vi.fn(),
  createSnapshot: vi.fn(),
  fetchScript: vi.fn(),
  listVersions: vi.fn(),
  saveScript: vi.fn(),
  setScriptTitle: vi.fn(),
}));

vi.mock("@/lib/cloud/client", () => ({ isSessionExpired: () => false }));
vi.mock("@/lib/cloud/scripts", () => ({
  createScript: cloud.createScript,
  createSnapshot: cloud.createSnapshot,
  fetchScript: cloud.fetchScript,
  listVersions: cloud.listVersions,
  saveScript: cloud.saveScript,
  setScriptTitle: cloud.setScriptTitle,
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const user = { id: "writer", email: "writer@example.com", name: "Writer" };
const body = (text: string): JSONContent => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});

class FakeEditor {
  json: JSONContent;
  listeners = new Set<() => void>();
  setContent = vi.fn((content: JSONContent) => {
    this.json = content;
    return true;
  });
  commands = { setContent: this.setContent };

  constructor(content: JSONContent) {
    this.json = content;
  }

  getJSON() {
    return this.json;
  }

  on(event: string, handler: () => void) {
    if (event === "update") this.listeners.add(handler);
  }

  off(event: string, handler: () => void) {
    if (event === "update") this.listeners.delete(handler);
  }

  type(content: JSONContent) {
    this.json = content;
    for (const listener of this.listeners) listener();
  }
}

let root: Root | null;
let host: HTMLDivElement | null;
let syncApi: ReturnType<typeof useCloudSync> | null;
let projectId: string;
let editor: FakeEditor;

function installStorage() {
  const store = new Map<string, string>();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      get length() { return store.size; },
      key: (index: number) => [...store.keys()][index] ?? null,
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, String(value)),
      removeItem: (key: string) => void store.delete(key),
      clear: () => store.clear(),
    },
  });
}

function opts(): CloudSyncOpts {
  return {
    projectId,
    type: "plain",
    status: "writing",
    deriveTitle: () => "Draft",
    getTitle: () => "Draft",
    saveLocalDoc: (content) => saveProjectDoc(projectId, content),
    loadLocalTitlePage: () => loadProjectTitlePage(projectId),
    saveLocalTitlePage: (tp) => saveProjectTitlePage(projectId, tp),
    isDirty: () => isDirty(projectId),
    setDirty: (dirty) => { setDirty(projectId, dirty); },
    isTitlePageDirty: () => isTitlePageDirty(projectId),
    setTitlePageDirty: (dirty) => { setTitlePageDirty(projectId, dirty); },
    isTitleDirty: () => isTitleDirty(projectId),
    setTitleDirty: (dirty) => { setTitleDirty(projectId, dirty); },
    getLastSavedAt: () => getLastSavedAt(projectId),
    setLastSavedAt: (at) => { setLastSavedAt(projectId, at); },
  };
}

function Harness() {
  syncApi = useCloudSync(editor as unknown as Editor, user, opts());
  return null;
}

async function mount() {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(<Harness />);
    await Promise.resolve();
  });
}

beforeEach(() => {
  installStorage();
  vi.clearAllMocks();
  root = null;
  host = null;
  syncApi = null;
  const project = createProject("plain", { title: "Draft", content: body("start") });
  projectId = project.id;
  markCloudCreated(projectId);
  setLastSavedAt(projectId, "2026-08-05T00:00:00.000Z");
  editor = new FakeEditor(body("start"));
  cloud.fetchScript.mockResolvedValue({
    id: projectId,
    title: "Draft",
    content: body("start"),
    type: "plain",
    status: "writing",
    created_at: "2026-08-05T00:00:00.000Z",
    updated_at: "2026-08-05T00:00:00.000Z",
  });
  cloud.createSnapshot.mockResolvedValue(undefined);
  cloud.listVersions.mockResolvedValue([]);
  cloud.setScriptTitle.mockResolvedValue("2026-08-05T00:00:01.000Z");
});

afterEach(() => {
  if (root) act(() => root?.unmount());
  root = null;
  host?.remove();
  host = null;
});

describe("late cloud responses", () => {
  it("keeps the document dirty when a mid-flight 401 returns no save timestamp", async () => {
    cloud.saveScript.mockResolvedValue(null);
    await mount();
    await vi.waitFor(() => expect(syncApi?.status).toBe("synced"));
    act(() => editor.type(body("locally safe after 401")));

    await act(async () => {
      await syncApi!.flush();
    });
    expect(isDirty(projectId)).toBe(true);
    expect(getLastSavedAt(projectId)).toBe("2026-08-05T00:00:00.000Z");
    expect(syncApi?.status).toBe("error");
  });

  it("keeps the document dirty when a mid-flight 500 rejects the save", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    cloud.saveScript.mockRejectedValue(new Error("server 500"));
    await mount();
    await vi.waitFor(() => expect(syncApi?.status).toBe("synced"));
    act(() => editor.type(body("locally safe after 500")));

    await act(async () => {
      await syncApi!.flush();
    });
    expect(isDirty(projectId)).toBe(true);
    expect(getLastSavedAt(projectId)).toBe("2026-08-05T00:00:00.000Z");
    expect(syncApi?.status).toBe("error");
    error.mockRestore();
  });

  it("serializes two saves so the newer body is the final request even when the first is late", async () => {
    cloud.saveScript.mockReset();
    let finishFirst: ((at: string) => void) | null = null;
    let finishSecond: ((at: string) => void) | null = null;
    cloud.saveScript
      .mockImplementationOnce(
        () => new Promise<string>((resolve) => { finishFirst = resolve; })
      )
      .mockImplementationOnce(
        () => new Promise<string>((resolve) => { finishSecond = resolve; })
      );
    await mount();
    await vi.waitFor(() => expect(syncApi?.status).toBe("synced"));

    act(() => editor.type(body("first in-flight edit")));
    let firstFlush!: Promise<void>;
    act(() => { firstFlush = syncApi!.flush(); });
    await vi.waitFor(() => expect(cloud.saveScript).toHaveBeenCalledTimes(1));

    act(() => editor.type(body("newest edit")));
    let secondFlush!: Promise<void>;
    act(() => { secondFlush = syncApi!.flush(); });
    await Promise.resolve();
    expect(cloud.saveScript).toHaveBeenCalledTimes(1);

    await act(async () => {
      finishFirst?.("2026-08-05T00:00:01.000Z");
      await Promise.resolve();
    });
    await vi.waitFor(() => expect(cloud.saveScript).toHaveBeenCalledTimes(2));
    expect(cloud.saveScript.mock.calls[0][1]).toEqual(body("first in-flight edit"));
    expect(cloud.saveScript.mock.calls[1][1]).toEqual(body("newest edit"));

    await act(async () => {
      finishSecond?.("2026-08-05T00:00:02.000Z");
      await Promise.all([firstFlush, secondFlush]);
    });
    expect(isDirty(projectId)).toBe(false);
  });

  it("ignores a fetch response that arrives after the editor unmounted", async () => {
    let finishFetch: ((row: unknown) => void) | null = null;
    cloud.fetchScript.mockImplementation(
      () => new Promise((resolve) => { finishFetch = resolve; })
    );
    await mount();
    await vi.waitFor(() => expect(cloud.fetchScript).toHaveBeenCalled());
    act(() => root?.unmount());
    root = null;

    await act(async () => {
      finishFetch?.({
        id: projectId,
        title: "Draft",
        content: body("late cloud body"),
        type: "plain",
        status: "writing",
        created_at: "2026-08-05T00:00:00.000Z",
        updated_at: "2026-08-06T00:00:00.000Z",
      });
      await Promise.resolve();
    });
    expect(editor.setContent).not.toHaveBeenCalled();
  });

  it("does not clear dirty state when a save response arrives after unmount", async () => {
    cloud.saveScript.mockReset();
    let finishSave: ((at: string) => void) | null = null;
    cloud.saveScript.mockImplementation(
      () => new Promise<string>((resolve) => { finishSave = resolve; })
    );
    await mount();
    await vi.waitFor(() => expect(syncApi?.status).toBe("synced"));
    act(() => editor.type(body("must remain dirty")));
    let flush!: Promise<void>;
    act(() => { flush = syncApi!.flush(); });
    await vi.waitFor(() => expect(cloud.saveScript).toHaveBeenCalled());
    act(() => root?.unmount());
    root = null;

    (finishSave as ((at: string) => void) | null)?.("2026-08-05T00:00:03.000Z");
    await flush;
    expect(isDirty(projectId)).toBe(true);
    expect(getLastSavedAt(projectId)).toBe("2026-08-05T00:00:00.000Z");
  });
});
