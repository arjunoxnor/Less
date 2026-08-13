// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createProject,
  deleteProject,
  getProjectMeta,
  isTitleDirty,
  listTombstones,
  markCloudCreated,
  markDeletedTombstone,
  patchProjectMeta,
  renameProject,
  setTitleDirty,
} from "./projects";
import { createFolder, listFolderTombstones } from "./folders";
import { useProjects } from "./useProjects";

const cloud = vi.hoisted(() => ({
  createScript: vi.fn(),
  deleteScript: vi.fn(),
  listScripts: vi.fn(),
  setScriptStatus: vi.fn(),
  setScriptTitle: vi.fn(),
  setScriptFolder: vi.fn(),
  listCloudFolders: vi.fn(),
  listCloudFolderTombstones: vi.fn(),
  upsertCloudFolder: vi.fn(),
  deleteCloudFolder: vi.fn(),
}));

vi.mock("@/lib/cloud/client", () => ({ isSessionExpired: () => false }));
vi.mock("@/lib/cloud/scripts", () => ({
  createScript: cloud.createScript,
  deleteScript: cloud.deleteScript,
  listScripts: cloud.listScripts,
  setScriptStatus: cloud.setScriptStatus,
  setScriptTitle: cloud.setScriptTitle,
  setScriptFolder: cloud.setScriptFolder,
}));
vi.mock("@/lib/cloud/folders", () => ({
  listCloudFolders: cloud.listCloudFolders,
  listCloudFolderTombstones: cloud.listCloudFolderTombstones,
  upsertCloudFolder: cloud.upsertCloudFolder,
  deleteCloudFolder: cloud.deleteCloudFolder,
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const user = { id: "user-1", email: "writer@example.com", name: "Writer" };
let root: Root | null = null;
let host: HTMLDivElement | null = null;
let projectsApi: {
  remove: (id: string) => void;
  deleteFolder: (id: string) => void;
  syncNow: () => Promise<boolean>;
} | null = null;

function Harness() {
  const api = useProjects(user);
  projectsApi = {
    remove: api.remove,
    deleteFolder: api.deleteFolder,
    syncNow: api.syncNow,
  };
  return null;
}

function freshStorage() {
  const values = new Map<string, string>();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, String(value)),
      removeItem: (key: string) => values.delete(key),
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

beforeEach(() => {
  freshStorage();
  projectsApi = null;
  vi.clearAllMocks();
  cloud.createScript.mockResolvedValue(null);
  cloud.deleteScript.mockResolvedValue(true);
  cloud.listScripts.mockResolvedValue([]);
  cloud.setScriptStatus.mockResolvedValue("2026-08-05T00:00:00.000Z");
  cloud.setScriptTitle.mockResolvedValue("2026-08-05T00:00:00.000Z");
  cloud.setScriptFolder.mockResolvedValue(true);
  cloud.listCloudFolders.mockResolvedValue([]);
  cloud.listCloudFolderTombstones.mockResolvedValue([]);
  cloud.upsertCloudFolder.mockResolvedValue(true);
  cloud.deleteCloudFolder.mockResolvedValue(true);
});

afterEach(() => {
  if (root) act(() => root?.unmount());
  root = null;
  host?.remove();
  host = null;
});

describe("project deletion convergence", () => {
  it("queues a tombstone when an online delete resolves false", async () => {
    const project = createProject("screenplay");
    markCloudCreated(project.id);
    cloud.deleteScript.mockResolvedValue(false);
    await mount();

    await act(async () => {
      projectsApi?.remove(project.id);
      await Promise.resolve();
    });
    expect(listTombstones()).toContain(project.id);
  });

  it("keeps a folder tombstone when an online delete resolves false", async () => {
    const folder = createFolder();
    cloud.deleteCloudFolder.mockResolvedValue(false);
    await mount();

    await act(async () => {
      projectsApi?.deleteFolder(folder.id);
      await Promise.resolve();
    });
    expect(listFolderTombstones().map((entry) => entry.id)).toContain(folder.id);
  });

  it("does not pull a cloud row that has a pending local delete", async () => {
    const project = createProject("screenplay");
    markCloudCreated(project.id);
    markDeletedTombstone(project.id);
    deleteProject(project.id);
    cloud.deleteScript.mockResolvedValue(false);
    cloud.listScripts.mockResolvedValue([
      {
        id: project.id,
        title: "Deleted script",
        type: "screenplay",
        status: "writing",
        content: { type: "doc", content: [] },
        updated_at: "2026-08-05T00:00:00.000Z",
      },
    ]);

    await mount();
    await act(async () => {
      await projectsApi?.syncNow();
    });
    expect(getProjectMeta(project.id)).toBeNull();
    expect(listTombstones()).toContain(project.id);
  });
});

describe("project metadata save races", () => {
  it("does not pull an older cloud title just because cloud content is newer", async () => {
    const project = createProject("plain", { title: "Newest title" });
    markCloudCreated(project.id);
    patchProjectMeta(project.id, { titleAt: "2026-08-05T00:00:00.000Z" });
    setTitleDirty(project.id, false);
    cloud.listScripts.mockResolvedValue([
      {
        id: project.id,
        title: "Older title",
        type: "plain",
        status: "not_started",
        updated_at: "2026-08-10T00:00:00.000Z", // newer body
        title_at: "2026-08-01T00:00:00.000Z", // older title
        status_at: "2026-08-01T00:00:00.000Z",
      },
    ]);

    await mount();
    await act(async () => { await projectsApi!.syncNow(); });
    expect(getProjectMeta(project.id)?.title).toBe("Newest title");
    expect(cloud.setScriptTitle).not.toHaveBeenCalled();
  });

  it("pushes an unsynced rename even when a cloud clock is hours into the future", async () => {
    const project = createProject("plain", { title: "Initial" });
    markCloudCreated(project.id);
    renameProject(project.id, "Clock-safe local rename");
    cloud.listScripts.mockResolvedValue([
      {
        id: project.id,
        title: "Future-clock title",
        type: "plain",
        status: "not_started",
        updated_at: "2099-01-01T00:00:00.000Z",
        title_at: "2099-01-01T00:00:00.000Z",
        status_at: "2099-01-01T00:00:00.000Z",
      },
    ]);

    await mount();
    await vi.waitFor(() => expect(cloud.setScriptTitle).toHaveBeenCalled());
    expect(cloud.setScriptTitle).toHaveBeenCalledWith(project.id, "Clock-safe local rename");
    expect(getProjectMeta(project.id)?.title).toBe("Clock-safe local rename");
  });

  it("does not clear a newer rename when an older reconcile request finishes", async () => {
    const project = createProject("screenplay", { title: "Initial" });
    markCloudCreated(project.id);
    renameProject(project.id, "First local title");
    cloud.listScripts.mockResolvedValue([
      {
        id: project.id,
        title: "Cloud title",
        type: "screenplay",
        status: "not_started",
        content: { type: "doc", content: [] },
        updated_at: "2020-01-01T00:00:00.000Z",
        title_at: "2020-01-01T00:00:00.000Z",
        status_at: "2020-01-01T00:00:00.000Z",
      },
    ]);
    let finishTitle: ((value: string) => void) | null = null;
    cloud.setScriptTitle.mockImplementation(
      () => new Promise<string>((resolve) => { finishTitle = resolve; })
    );

    await mount();
    await vi.waitFor(() => expect(cloud.setScriptTitle).toHaveBeenCalled());
    await act(async () => {
      renameProject(project.id, "Second local title");
      finishTitle?.("2026-08-05T00:00:00.000Z");
      await Promise.resolve();
    });

    expect(getProjectMeta(project.id)?.title).toBe("Second local title");
    expect(isTitleDirty(project.id)).toBe(true);
  });

  it("shares one reconcile when the same project list is reconciled twice concurrently", async () => {
    await mount();
    await vi.waitFor(() => expect(cloud.listScripts).toHaveBeenCalled());
    await act(async () => {
      await projectsApi!.syncNow();
    });
    vi.clearAllMocks();
    cloud.listCloudFolders.mockResolvedValue([]);
    cloud.listCloudFolderTombstones.mockResolvedValue([]);
    let finishList: ((rows: never[]) => void) | null = null;
    cloud.listScripts.mockImplementation(
      () => new Promise<never[]>((resolve) => { finishList = resolve; })
    );

    let first!: Promise<boolean>;
    let second!: Promise<boolean>;
    await act(async () => {
      first = projectsApi!.syncNow();
      second = projectsApi!.syncNow();
      await Promise.resolve();
    });
    expect(cloud.listCloudFolders).toHaveBeenCalledTimes(1);
    expect(cloud.listScripts).toHaveBeenCalledTimes(1);

    await act(async () => {
      finishList?.([]);
      await Promise.all([first, second]);
    });
    await expect(first).resolves.toBe(true);
    await expect(second).resolves.toBe(true);
  });
});
