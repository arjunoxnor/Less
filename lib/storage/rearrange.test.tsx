// @vitest-environment jsdom

// Rearranging is not editing. Dragging a document to a new spot, or into
// another folder, used to stamp its updatedAt: the "edited" time the home
// shows and orders Recent by, so every row a drag touched read "just now".
// Placement has its own clock (placedAt here, placed_at in the cloud), so a
// move now stamps only that. These tests pin the rule, and pin that sync stays
// right without the extra stamp: the server still bumps the row's updated_at
// for the placement PATCH, and the next reconcile must neither pull nor
// overwrite anything because of it.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { JSONContent } from "@tiptap/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createProject,
  getProjectMeta,
  isDirty,
  listProjects,
  loadProjectDoc,
  markCloudCreated,
  patchProjectMeta,
} from "./projects";
import { createFolder } from "./folders";
import { useProjects } from "./useProjects";
import { relativeTime } from "@/components/home/homeParts";

const cloud = vi.hoisted(() => ({
  createScript: vi.fn(),
  deleteScript: vi.fn(),
  listScripts: vi.fn(),
  setScriptStatus: vi.fn(),
  setScriptTitle: vi.fn(),
  setScriptFolder: vi.fn(),
  setScriptOrg: vi.fn(),
  listCloudFolders: vi.fn(),
  listCloudFolderTombstones: vi.fn(),
  upsertCloudFolder: vi.fn(),
  deleteCloudFolder: vi.fn(),
  setCloudFolderDesk: vi.fn(),
}));

vi.mock("@/lib/cloud/scripts", () => ({
  createScript: cloud.createScript,
  deleteScript: cloud.deleteScript,
  listScripts: cloud.listScripts,
  setScriptStatus: cloud.setScriptStatus,
  setScriptTitle: cloud.setScriptTitle,
  setScriptFolder: cloud.setScriptFolder,
  setScriptOrg: cloud.setScriptOrg,
}));
vi.mock("@/lib/cloud/folders", () => ({
  listCloudFolders: cloud.listCloudFolders,
  listCloudFolderTombstones: cloud.listCloudFolderTombstones,
  upsertCloudFolder: cloud.upsertCloudFolder,
  deleteCloudFolder: cloud.deleteCloudFolder,
  setCloudFolderDesk: cloud.setCloudFolderDesk,
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const user = { id: "user-1", email: "writer@example.com", name: "Writer" };
let root: Root | null = null;
let host: HTMLDivElement | null = null;
let api: ReturnType<typeof useProjects> | null = null;

function Harness() {
  api = useProjects(user);
  return null;
}

function freshStorage() {
  const values = new Map<string, string>();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      get length() {
        return values.size;
      },
      key: (index: number) => [...values.keys()][index] ?? null,
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => void values.set(key, String(value)),
      removeItem: (key: string) => void values.delete(key),
      clear: () => values.clear(),
    },
  });
}

async function mount() {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root?.render(<Harness />);
    await Promise.resolve();
  });
}

/** Let the sign-in reconcile that mounting starts run to the end. */
async function settle() {
  await act(async () => {
    await api!.syncNow();
  });
}

async function reconcile(): Promise<boolean> {
  let ok = false;
  await act(async () => {
    ok = await api!.syncNow();
  });
  return ok;
}

const body = (text: string): JSONContent => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});
const hoursAgo = (n: number) => new Date(Date.now() - n * 3_600_000).toISOString();
const daysAgo = (n: number) => hoursAgo(n * 24);

/** What a row shows after "edited" (the home renders exactly this). */
const shown = (id: string) => relativeTime(getProjectMeta(id)!.updatedAt);
/** The order Recent reads: newest edit first. */
const recentOrder = () => listProjects().map((p) => p.id);

/**
 * Three drafts filed in one project, written here days ago and already in the
 * cloud, plus a note written an hour ago that nobody moves.
 */
function aDeskOfDrafts() {
  const folder = createFolder("Pilot");
  const drafts = [3, 2, 1].map((age, i) => {
    const p = createProject("plain", {
      title: `Pilot draft ${i + 1}`,
      content: body(`draft ${i + 1}`),
      folderId: folder.id,
    });
    markCloudCreated(p.id);
    patchProjectMeta(p.id, {
      order: i,
      createdAt: daysAgo(10),
      updatedAt: daysAgo(age),
      placedAt: daysAgo(age),
    });
    return p.id;
  });
  const note = createProject("plain", { title: "Notes", content: body("notes") });
  markCloudCreated(note.id);
  patchProjectMeta(note.id, { createdAt: daysAgo(10), updatedAt: hoursAgo(1) });
  return { folderId: folder.id, drafts, note: note.id };
}

/** A draft's row as the server holds it: same words, title, status and place. */
function cloudRow(id: string, clocks: { updated: string; placed: string }) {
  const m = getProjectMeta(id)!;
  return {
    id,
    title: m.title,
    type: m.type,
    status: m.status,
    created_at: m.createdAt,
    updated_at: clocks.updated,
    placed_at: clocks.placed,
    title_at: m.createdAt,
    status_at: m.createdAt,
    folder_id: m.folderId ?? null,
    position: m.order ?? null,
    kind: null,
    stack_id: null,
    stack_top: null,
    org_at: null,
    digest: m.digest ?? null,
    tp_author: null,
  };
}

/** The cloud before anything is moved: each row last written when it was edited here. */
function cloudInStep(ids: string[]) {
  return ids.map((id) => {
    const m = getProjectMeta(id)!;
    return cloudRow(id, { updated: m.updatedAt, placed: m.placedAt! });
  });
}

beforeEach(() => {
  freshStorage();
  api = null;
  vi.clearAllMocks();
  cloud.createScript.mockResolvedValue(null);
  cloud.deleteScript.mockResolvedValue(true);
  cloud.listScripts.mockResolvedValue([]);
  cloud.setScriptStatus.mockResolvedValue("2026-08-05T00:00:00.000Z");
  cloud.setScriptTitle.mockResolvedValue("2026-08-05T00:00:00.000Z");
  cloud.setScriptFolder.mockResolvedValue(true);
  cloud.setScriptOrg.mockResolvedValue("2026-08-05T00:00:00.000Z");
  cloud.listCloudFolders.mockResolvedValue([]);
  cloud.listCloudFolderTombstones.mockResolvedValue([]);
  cloud.upsertCloudFolder.mockResolvedValue(true);
  cloud.deleteCloudFolder.mockResolvedValue(true);
  cloud.setCloudFolderDesk.mockResolvedValue("2026-08-05T00:00:00.000Z");
});

afterEach(() => {
  if (root) act(() => root?.unmount());
  root = null;
  host?.remove();
  host = null;
});

describe("rearranging is not editing", () => {
  it("moves documents to new spots without changing what 'edited' shows", async () => {
    const { folderId, drafts, note } = aDeskOfDrafts();
    const recentBefore = recentOrder();
    expect(drafts.map(shown)).toEqual(["3 days ago", "2 days ago", "1 day ago"]);
    await mount();
    await settle();
    const movedAt = new Date().toISOString();

    // Drag the newest draft to the front of the column.
    act(() => api!.reorder([drafts[2], drafts[0], drafts[1]]));

    expect(drafts.map((id) => getProjectMeta(id)!.order)).toEqual([1, 2, 0]);
    expect(drafts.map(shown)).toEqual(["3 days ago", "2 days ago", "1 day ago"]);
    // Nothing jumped into Recent: the note written an hour ago still leads.
    expect(recentOrder()).toEqual(recentBefore);
    expect(recentOrder()[0]).toBe(note);
    // The move rode the placement clock, and only positions went to the cloud.
    for (const id of drafts) expect(getProjectMeta(id)!.placedAt! >= movedAt).toBe(true);
    expect(cloud.setScriptFolder.mock.calls).toEqual([
      [drafts[2], folderId, 0],
      [drafts[0], folderId, 1],
      [drafts[1], folderId, 2],
    ]);
    expect(cloud.createScript).not.toHaveBeenCalled();
  });

  it("files a document into another folder's column without it reading as edited", async () => {
    const { drafts } = aDeskOfDrafts();
    const oldDrafts = createFolder("Old drafts");
    const kept = createProject("plain", {
      title: "Pilot draft 0",
      content: body("draft 0"),
      folderId: oldDrafts.id,
    });
    patchProjectMeta(kept.id, { order: 0, updatedAt: daysAgo(5), placedAt: daysAgo(5) });
    const recentBefore = recentOrder();
    await mount();
    await settle();
    const movedAt = new Date().toISOString();

    // What a drop into a slot in another column does: file it, then place it.
    act(() => {
      api!.setFolder(drafts[0], oldDrafts.id);
      api!.reorder([drafts[0], kept.id]);
    });

    const moved = getProjectMeta(drafts[0])!;
    expect(moved.folderId).toBe(oldDrafts.id);
    expect(moved.placedAt! >= movedAt).toBe(true);
    expect([drafts[0], kept.id].map((id) => getProjectMeta(id)!.order)).toEqual([0, 1]);
    expect(shown(drafts[0])).toBe("3 days ago");
    expect(shown(kept.id)).toBe("5 days ago");
    expect(recentOrder()).toEqual(recentBefore);
  });

  it("a reorder followed by a reconcile neither pulls nor overwrites anything", async () => {
    const { drafts } = aDeskOfDrafts();
    const before = new Map(drafts.map((id) => [id, getProjectMeta(id)!]));
    cloud.listScripts.mockResolvedValue(cloudInStep(drafts));
    await mount();
    await settle();

    act(() => api!.reorder([drafts[2], drafts[0], drafts[1]]));
    // The server applied the placement PATCHes: the new positions, with its
    // updated_at moved along with placed_at, after this device's last edit.
    const patchedAt = new Date().toISOString();
    cloud.listScripts.mockResolvedValue(
      drafts.map((id) => cloudRow(id, { updated: patchedAt, placed: patchedAt }))
    );
    for (const fn of Object.values(cloud)) fn.mockClear();

    expect(await reconcile()).toBe(true);

    // Nothing went up: no words (createScript is the only call in this pass
    // that carries a body), no title or status, and no placement bounced back.
    expect(cloud.createScript).not.toHaveBeenCalled();
    expect(cloud.setScriptTitle).not.toHaveBeenCalled();
    expect(cloud.setScriptStatus).not.toHaveBeenCalled();
    expect(cloud.setScriptOrg).not.toHaveBeenCalled();
    expect(cloud.setScriptFolder).not.toHaveBeenCalled();
    // Nothing came down over this device's copies, and nothing reads as edited.
    drafts.forEach((id, i) => {
      const was = before.get(id)!;
      const now = getProjectMeta(id)!;
      expect(loadProjectDoc(id)).toEqual(body(`draft ${i + 1}`));
      expect(now.updatedAt).toBe(was.updatedAt);
      expect(now.title).toBe(was.title);
      expect(now.status).toBe(was.status);
      expect(now.digest).toEqual(was.digest);
      expect(isDirty(id)).toBe(false);
    });
    expect(drafts.map(shown)).toEqual(["3 days ago", "2 days ago", "1 day ago"]);
    expect(drafts.map((id) => getProjectMeta(id)!.order)).toEqual([1, 2, 0]);
  });

  it("sends a reorder that never reached the cloud on the next pass, as placement only", async () => {
    const { folderId, drafts } = aDeskOfDrafts();
    const before = new Map(drafts.map((id) => [id, getProjectMeta(id)!]));
    cloud.listScripts.mockResolvedValue(cloudInStep(drafts)); // the old order, still
    await mount();
    await settle();

    cloud.setScriptFolder.mockResolvedValue(false); // e.g. the session lapsed mid-drag
    act(() => api!.reorder([drafts[2], drafts[0], drafts[1]]));
    cloud.setScriptFolder.mockClear();
    cloud.setScriptFolder.mockResolvedValue(true);

    expect(await reconcile()).toBe(true);

    // The placement clock alone carries the move: it goes up, and the cloud's
    // older order is not pulled back over it.
    expect(cloud.setScriptFolder).toHaveBeenCalledTimes(3);
    expect(cloud.setScriptFolder).toHaveBeenCalledWith(drafts[2], folderId, 0);
    expect(cloud.setScriptFolder).toHaveBeenCalledWith(drafts[0], folderId, 1);
    expect(cloud.setScriptFolder).toHaveBeenCalledWith(drafts[1], folderId, 2);
    expect(cloud.createScript).not.toHaveBeenCalled();
    expect(drafts.map((id) => getProjectMeta(id)!.order)).toEqual([1, 2, 0]);
    drafts.forEach((id, i) => {
      expect(loadProjectDoc(id)).toEqual(body(`draft ${i + 1}`));
      expect(getProjectMeta(id)!.updatedAt).toBe(before.get(id)!.updatedAt);
    });
  });

  it("still adopts a rename and a status change made elsewhere after a reorder here", async () => {
    // This device made the draft and never renamed it or changed its status,
    // so neither has a clock of its own here, and sync stands in with "when
    // the writing last changed here". While a reorder stamped that, a reorder
    // made this device's old title look newer than a real rename on another
    // device, and the rename never arrived.
    const { drafts } = aDeskOfDrafts();
    const id = drafts[0]; // written here three days ago
    expect(getProjectMeta(id)!.titleAt).toBeUndefined();
    expect(getProjectMeta(id)!.statusAt).toBeUndefined();
    cloud.listScripts.mockResolvedValue(cloudInStep(drafts));
    await mount();
    await settle();

    // Meanwhile, on the laptop: renamed and marked done.
    const elsewhereAt = new Date().toISOString();
    // Then, here: a reorder.
    act(() => api!.reorder([drafts[2], drafts[0], drafts[1]]));
    const placedAt = new Date().toISOString();
    cloud.listScripts.mockResolvedValue(
      drafts.map((d) => ({
        ...cloudRow(d, { updated: placedAt, placed: placedAt }),
        ...(d === id
          ? { title: "Pilot, network draft", title_at: elsewhereAt, status: "done", status_at: elsewhereAt }
          : {}),
      }))
    );
    for (const fn of Object.values(cloud)) fn.mockClear();

    expect(await reconcile()).toBe(true);

    const now = getProjectMeta(id)!;
    expect(now.title).toBe("Pilot, network draft");
    expect(now.status).toBe("done");
    expect(cloud.setScriptTitle).not.toHaveBeenCalled();
    expect(cloud.setScriptStatus).not.toHaveBeenCalled();
    expect(shown(id)).toBe("3 days ago");
  });
});
