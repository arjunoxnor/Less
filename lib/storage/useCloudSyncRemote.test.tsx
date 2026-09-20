// @vitest-environment jsdom

// A body written somewhere else (another device, or a tool writing straight to
// the database) meeting an open or reopening document. Before syncBaseline.ts
// the local copy won whenever its dirty flag was set, and the flag is set by
// updates that change nothing, so a stale or blank tab replaced newer work.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Editor } from "@tiptap/react";
import type { JSONContent } from "@tiptap/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCloudSync, type CloudSyncOpts } from "./useCloudSync";
import { syncFingerprint } from "./syncBaseline";
import {
  createProject,
  getLastSavedAt,
  getSyncedPrint,
  isDirty,
  isTitleDirty,
  isTitlePageDirty,
  listLocalVersions,
  loadProjectTitlePage,
  markCloudCreated,
  saveProjectDoc,
  saveProjectTitlePage,
  setDirty,
  setLastSavedAt,
  setSyncedPrint,
  setTitleDirty,
  setTitlePageDirty,
} from "./projects";

const cloud = vi.hoisted(() => ({
  createScript: vi.fn(),
  createSnapshot: vi.fn(),
  fetchScript: vi.fn(),
  listScripts: vi.fn(),
  listVersions: vi.fn(),
  saveScript: vi.fn(),
  setScriptTitle: vi.fn(),
}));

vi.mock("@/lib/cloud/client", () => ({ isSessionExpired: () => false }));
vi.mock("@/lib/cloud/scripts", () => ({
  createScript: cloud.createScript,
  createSnapshot: cloud.createSnapshot,
  fetchScript: cloud.fetchScript,
  listScripts: cloud.listScripts,
  listVersions: cloud.listVersions,
  saveScript: cloud.saveScript,
  setScriptTitle: cloud.setScriptTitle,
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const T0 = "2026-08-05T00:00:00.000Z";
const T1 = "2026-08-06T00:00:00.000Z";
const LABEL = "Before update from another device";
const user = { id: "writer", email: "writer@example.com", name: "Writer" };
const body = (text: string): JSONContent => ({
  type: "doc",
  content: [{ type: "paragraph", content: text ? [{ type: "text", text }] : [] }],
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
const remote = vi.fn();

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
    getSyncedPrint: () => getSyncedPrint(projectId),
    setSyncedPrint: (print) => { setSyncedPrint(projectId, print); },
    onRemoteUpdate: remote,
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

const cloudRow = (text: string, updated_at: string) => ({
  id: projectId,
  title: "Draft",
  content: body(text),
  type: "plain",
  status: "writing",
  created_at: T0,
  updated_at,
});

/** The cloud as the list and the single-row fetch both see it. */
function cloudHolds(text: string, updated_at: string) {
  cloud.fetchScript.mockResolvedValue(cloudRow(text, updated_at));
  cloud.listScripts.mockResolvedValue([{ id: projectId, updated_at }]);
}

/** Start every test with a project this device has synced to the cloud. */
function startWith(text: string, opts?: { baseline?: boolean }) {
  const project = createProject("plain", { title: "Draft", content: body(text) });
  projectId = project.id;
  markCloudCreated(projectId);
  setLastSavedAt(projectId, T0);
  if (opts?.baseline !== false) setSyncedPrint(projectId, syncFingerprint(body(text), null));
  editor = new FakeEditor(body(text));
  cloudHolds(text, T0);
}

beforeEach(() => {
  installStorage();
  vi.clearAllMocks();
  root = null;
  host = null;
  syncApi = null;
  cloud.createSnapshot.mockResolvedValue(undefined);
  cloud.listVersions.mockResolvedValue([]);
  cloud.setScriptTitle.mockResolvedValue(T1);
  cloud.saveScript.mockResolvedValue(T1);
});

afterEach(() => {
  if (root) act(() => root?.unmount());
  root = null;
  host?.remove();
  host = null;
});

describe("opening a document the cloud has moved past", () => {
  it("adopts the cloud body when the dirty flag was set by an update that changed nothing", async () => {
    startWith("start");
    setDirty(projectId, true); // what opening an empty screenplay does
    cloudHolds("written somewhere else", T1);

    await mount();
    await vi.waitFor(() => expect(syncApi?.status).toBe("synced"));

    expect(cloud.saveScript).not.toHaveBeenCalled();
    expect(editor.json).toEqual(body("written somewhere else"));
    expect(isDirty(projectId)).toBe(false);
    expect(getLastSavedAt(projectId)).toBe(T1);
    expect(getSyncedPrint(projectId)).toBe(
      syncFingerprint(body("written somewhere else"), null)
    );
    expect(remote).not.toHaveBeenCalled(); // an ordinary open stays quiet
  });

  it("never lets a blank local page replace words, even with no baseline and a dirty flag", async () => {
    startWith("", { baseline: false });
    setDirty(projectId, true);
    cloudHolds("INT. GRASSY FIELD - DAY", T1);

    await mount();
    await vi.waitFor(() => expect(syncApi?.status).toBe("synced"));

    expect(cloud.saveScript).not.toHaveBeenCalled();
    expect(editor.json).toEqual(body("INT. GRASSY FIELD - DAY"));
  });

  it("sends the words back up when the cloud was blanked but this device still has them", async () => {
    startWith("the only copy of these words");
    cloudHolds("", T1);

    await mount();
    await vi.waitFor(() => expect(cloud.saveScript).toHaveBeenCalledTimes(1));

    expect(cloud.saveScript.mock.calls[0][1]).toEqual(body("the only copy of these words"));
    expect(editor.json).toEqual(body("the only copy of these words"));
  });

  it("keeps the older rule for a document that has no baseline yet: dirty pushes", async () => {
    startWith("typed before the upgrade", { baseline: false });
    setDirty(projectId, true);
    cloudHolds("an older cloud body", T0);

    await mount();
    await vi.waitFor(() => expect(cloud.saveScript).toHaveBeenCalledTimes(1));

    expect(cloud.saveScript.mock.calls[0][1]).toEqual(body("typed before the upgrade"));
    expect(getSyncedPrint(projectId)).toBe(
      syncFingerprint(body("typed before the upgrade"), null)
    );
  });

  it("shows the cloud body and keeps the local edits in History when both really changed", async () => {
    startWith("start");
    editor = new FakeEditor(body("offline edits on this device"));
    saveProjectDoc(projectId, body("offline edits on this device"));
    setDirty(projectId, true);
    cloudHolds("edits from the other device", T1);

    await mount();
    await vi.waitFor(() => expect(syncApi?.status).toBe("synced"));

    expect(cloud.saveScript).not.toHaveBeenCalled();
    expect(editor.json).toEqual(body("edits from the other device"));
    expect(remote).toHaveBeenCalledWith("conflict");
    expect(cloud.createSnapshot).toHaveBeenCalledWith(
      projectId,
      "writer",
      body("offline edits on this device"),
      null,
      LABEL
    );
    expect(listLocalVersions(projectId)[0]?.content).toEqual(
      body("offline edits on this device")
    );
  });
});

describe("a body written somewhere else while the document is open", () => {
  it("loads into an unchanged editor when the writer comes back to the tab", async () => {
    startWith("start");
    await mount();
    await vi.waitFor(() => expect(syncApi?.status).toBe("synced"));

    cloudHolds("cleaned up by an outside writer", T1);
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await Promise.resolve();
    });
    await vi.waitFor(() =>
      expect(editor.json).toEqual(body("cleaned up by an outside writer"))
    );

    expect(cloud.saveScript).not.toHaveBeenCalled();
    expect(remote).toHaveBeenCalledWith("pulled");
    expect(getLastSavedAt(projectId)).toBe(T1);
    // What was on screen is recoverable.
    expect(listLocalVersions(projectId)[0]?.content).toEqual(body("start"));
  });

  it("does not fetch a body when the cloud clock has not moved", async () => {
    startWith("start");
    await mount();
    await vi.waitFor(() => expect(syncApi?.status).toBe("synced"));
    cloud.fetchScript.mockClear();

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await Promise.resolve();
    });
    await vi.waitFor(() => expect(cloud.listScripts).toHaveBeenCalled());

    expect(cloud.fetchScript).not.toHaveBeenCalled();
    expect(editor.json).toEqual(body("start"));
  });

  it("stops a save that would replace it, shows it, and keeps the unsent edits in History", async () => {
    startWith("start");
    await mount();
    await vi.waitFor(() => expect(syncApi?.status).toBe("synced"));

    act(() => editor.type(body("my unsent edit")));
    cloudHolds("their edit", T1);
    await act(async () => {
      await syncApi!.flush();
    });

    expect(cloud.saveScript).not.toHaveBeenCalled();
    expect(editor.json).toEqual(body("their edit"));
    expect(isDirty(projectId)).toBe(false);
    expect(remote).toHaveBeenCalledWith("conflict");
    expect(cloud.createSnapshot).toHaveBeenCalledWith(
      projectId,
      "writer",
      body("my unsent edit"),
      null,
      LABEL
    );
  });

  it("lets a real edit through when the cloud only moved for a rename", async () => {
    startWith("start");
    await mount();
    await vi.waitFor(() => expect(syncApi?.status).toBe("synced"));

    act(() => editor.type(body("my real edit")));
    cloudHolds("start", T1); // same body, newer clock: a rename or a folder move
    await act(async () => {
      await syncApi!.flush();
    });

    expect(cloud.saveScript).toHaveBeenCalledTimes(1);
    expect(cloud.saveScript.mock.calls[0][1]).toEqual(body("my real edit"));
    expect(editor.json).toEqual(body("my real edit"));
    expect(remote).not.toHaveBeenCalled();
  });

  it("does not resend a body that is flagged dirty but did not change", async () => {
    startWith("start");
    await mount();
    await vi.waitFor(() => expect(syncApi?.status).toBe("synced"));

    act(() => editor.type(body("start"))); // an update event, same words
    expect(isDirty(projectId)).toBe(true);
    await act(async () => {
      await syncApi!.flush();
    });

    expect(cloud.saveScript).not.toHaveBeenCalled();
    expect(isDirty(projectId)).toBe(false);
    expect(syncApi?.status).toBe("synced");
  });

  it("records the pushed body as the new baseline", async () => {
    startWith("start");
    await mount();
    await vi.waitFor(() => expect(syncApi?.status).toBe("synced"));

    act(() => editor.type(body("a new line")));
    await act(async () => {
      await syncApi!.flush();
    });

    expect(cloud.saveScript).toHaveBeenCalledTimes(1);
    expect(getLastSavedAt(projectId)).toBe(T1);
    expect(getSyncedPrint(projectId)).toBe(syncFingerprint(body("a new line"), null));
  });
});
