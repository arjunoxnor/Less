// @vitest-environment jsdom

import { act } from "react";
import type { ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_PREFS } from "@/lib/storage/localStore";
import type { Folder } from "@/lib/storage/folders";
import type { ProjectMeta } from "@/lib/storage/projects";
import { ProjectsHome } from "./ProjectsHome";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const storage = new Map<string, string>();
Object.defineProperty(window, "localStorage", {
  configurable: true,
  value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  },
});

const folder: Folder = {
  id: "top",
  name: "Top",
  color: "#3F7D5C",
  stage: "idea",
  order: 0,
  createdAt: "2026-07-01T00:00:00.000Z",
  updatedAt: "2026-07-01T00:00:00.000Z",
};
const project: ProjectMeta = {
  id: "draft",
  title: "Draft",
  type: "screenplay",
  status: "writing",
  folderId: "card",
  createdAt: "2026-07-01T00:00:00.000Z",
  updatedAt: "2026-07-02T00:00:00.000Z",
  cloudCreated: true,
};

let root: Root | null = null;
let host: HTMLDivElement | null = null;

function renderHome(
  folders: Folder[],
  overrides: Partial<ComponentProps<typeof ProjectsHome>> = {}
) {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  const props: ComponentProps<typeof ProjectsHome> = {
    projects: [],
    folders,
    user: null,
    cloudConfigured: false,
    prefs: DEFAULT_PREFS,
    onPrefsChange: () => {},
    onOpen: () => {},
    onCreate: () => {
      throw new Error("not used");
    },
    onDelete: () => {},
    onRename: () => {},
    onSetFolder: () => {},
    onReorder: () => {},
    onReorderFolders: () => {},
    onCreateFolder: () => {
      throw new Error("not used");
    },
    onUpdateFolder: () => {},
    onDeleteFolder: () => {},
    onImportScreenplays: async () => ({ imported: 0, failed: [] }),
    onSyncNow: async () => true,
    onSignIn: () => {},
    onSignOut: () => {},
    ...overrides,
  };
  act(() => root?.render(<ProjectsHome {...props} />));
}

function dragStart(target: Element) {
  const transfer = { effectAllowed: "", setData: vi.fn() };
  const event = new Event("dragstart", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", { value: transfer });
  target.dispatchEvent(event);
}

afterEach(() => {
  if (root) {
    act(() => root?.unmount());
  }
  root = null;
  host?.remove();
  host = null;
  storage.clear();
});

describe("ProjectsHome drag lifecycle", () => {
  it("does not erase saved folds before folders finish hydrating", () => {
    window.localStorage.setItem("less:home:folds:v1", JSON.stringify({ top: false }));
    renderHome([]);
    expect(window.localStorage.getItem("less:home:folds:v1")).toBe(
      JSON.stringify({ top: false })
    );
  });

  it("clears an active drag before creating inside a folder", () => {
    const child = { ...folder, id: "child", name: "New folder", parentId: "top" };
    const createFolder = vi.fn(() => child);
    renderHome([folder], { onCreateFolder: createFolder });

    const band = host!.querySelector<HTMLElement>(".band")!;
    act(() => dragStart(band));
    expect(band?.classList.contains("dragging")).toBe(true);

    const create = host!.querySelector<HTMLButtonElement>(".pcard-new");
    act(() => create?.click());
    expect(createFolder).toHaveBeenCalledWith("top");
    expect(host!.querySelector(".dragging")).toBeNull();
  });

  it("dropping a folder back on itself ignores a stale reorder target", () => {
    const second = { ...folder, id: "second", name: "Second", order: 1 };
    const reorder = vi.fn();
    renderHome([folder, second], { onReorderFolders: reorder });
    const bands = host!.querySelectorAll<HTMLElement>(".band");

    act(() => dragStart(bands[0]));
    const overSecond = new Event("dragover", { bubbles: true, cancelable: true });
    Object.defineProperty(overSecond, "clientY", { value: 1 });
    act(() => bands[1].dispatchEvent(overSecond));
    const dropSelf = new Event("drop", { bubbles: true, cancelable: true });
    act(() => bands[0].dispatchEvent(dropSelf));

    expect(reorder).not.toHaveBeenCalled();
    expect(host!.querySelector(".dragging")).toBeNull();
  });

  it("dropping a project onto its current folder does not stamp placement", () => {
    const card = { ...folder, id: "card", name: "Card", parentId: "top" };
    const setFolder = vi.fn();
    renderHome([folder, card], { projects: [project], onSetFolder: setFolder });
    const row = host!.querySelector<HTMLElement>(".fh-item")!;
    const cardNode = host!.querySelector<HTMLElement>(".pcard")!;

    act(() => dragStart(row));
    const drop = new Event("drop", { bubbles: true, cancelable: true });
    act(() => cardNode.dispatchEvent(drop));

    expect(setFolder).not.toHaveBeenCalled();
    expect(host!.querySelector(".dragging")).toBeNull();
  });
});
