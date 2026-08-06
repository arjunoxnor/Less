// @vitest-environment jsdom

import { act } from "react";
import type { ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_PREFS } from "@/lib/storage/localStore";
import type { Folder } from "@/lib/storage/folders";
import type { ProjectMeta } from "@/lib/storage/projects";
import { HoldDelete, ProjectsHome } from "./ProjectsHome";
import { ToastHost } from "./ui/Toast";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const storage = new Map<string, string>();
Object.defineProperty(window, "localStorage", {
  configurable: true,
  value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
    clear: () => storage.clear(),
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
  return props;
}

function dragStart(target: Element) {
  const transfer = { effectAllowed: "", setData: vi.fn() };
  const event = new Event("dragstart", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", { value: transfer });
  target.dispatchEvent(event);
  return transfer;
}

function dragEnd(target: Element, transfer: object) {
  const event = new Event("dragend", { bubbles: true, cancelable: true });
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
  vi.useRealTimers();
});

describe("ProjectsHome drag lifecycle", () => {
  it("does not erase saved folds before folders finish hydrating", () => {
    window.localStorage.setItem("less:home:folds:v1", JSON.stringify({ top: false }));
    renderHome([]);
    expect(window.localStorage.getItem("less:home:folds:v1")).toBe(
      JSON.stringify({ top: false })
    );
  });

  it("adopts fold changes made in another tab", () => {
    renderHome([folder]);
    const caret = host!.querySelector<HTMLButtonElement>(".band-caret")!;
    expect(caret.getAttribute("aria-expanded")).toBe("true");

    act(() => {
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: "less:home:folds:v1",
          newValue: JSON.stringify({ top: false }),
        })
      );
    });

    expect(caret.getAttribute("aria-expanded")).toBe("false");
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
    const cardNode = host!.querySelector<HTMLElement>(".pcard-head")!;

    act(() => dragStart(row));
    const drop = new Event("drop", { bubbles: true, cancelable: true });
    act(() => cardNode.dispatchEvent(drop));

    expect(setFolder).not.toHaveBeenCalled();
    expect(host!.querySelector(".dragging")).toBeNull();
  });

  it("does not let an older dragend cancel a newer drag session", () => {
    const second = { ...folder, id: "second", name: "Second", order: 1 };
    renderHome([folder, second]);
    const bands = host!.querySelectorAll<HTMLElement>(".band");

    let firstTransfer: object;
    act(() => {
      firstTransfer = dragStart(bands[0]);
      dragStart(bands[1]);
      dragEnd(bands[0], firstTransfer);
    });

    expect(bands[1].classList.contains("dragging")).toBe(true);
  });

  it("does not start a drag while an actions menu is open", () => {
    const card = { ...folder, id: "card", name: "Card", parentId: "top" };
    renderHome([folder, card], { projects: [project] });
    const row = host!.querySelector<HTMLElement>(".fh-item")!;
    act(() => host!.querySelector<HTMLButtonElement>(".fh-item .fh-kebab")!.click());

    let event: Event;
    act(() => {
      const transfer = { effectAllowed: "", setData: vi.fn() };
      event = new Event("dragstart", { bubbles: true, cancelable: true });
      Object.defineProperty(event, "dataTransfer", { value: transfer });
      row.dispatchEvent(event);
    });

    expect(event!.defaultPrevented).toBe(true);
    expect(row.classList.contains("dragging")).toBe(false);
  });

  it("rejects a drop whose caret belongs to a different live list", () => {
    const firstCard = { ...folder, id: "card", name: "First", parentId: "top" };
    const secondCard = {
      ...folder,
      id: "card-2",
      name: "Second",
      parentId: "top",
      order: 1,
    };
    const secondProject = { ...project, id: "second-draft", folderId: "card-2" };
    storage.set(
      "less:home:folds:v1",
      JSON.stringify({ card: true, "card-2": true })
    );
    const setFolder = vi.fn();
    const reorder = vi.fn();
    renderHome([folder, firstCard, secondCard], {
      projects: [project, secondProject],
      onSetFolder: setFolder,
      onReorder: reorder,
    });
    const rows = host!.querySelectorAll<HTMLElement>(".fh-item");
    const lists = host!.querySelectorAll<HTMLElement>(".pcard-list");

    act(() => dragStart(rows[0]));
    const overSecond = new Event("dragover", { bubbles: true, cancelable: true });
    Object.defineProperty(overSecond, "clientY", { value: 0 });
    act(() => lists[1].dispatchEvent(overSecond));
    const dropOnFirst = new Event("drop", { bubbles: true, cancelable: true });
    act(() => lists[0].dispatchEvent(dropOnFirst));

    expect(setFolder).not.toHaveBeenCalled();
    expect(reorder).not.toHaveBeenCalled();
  });
});

describe("ProjectsHome layered interactions", () => {
  const card = { ...folder, id: "card", name: "Card", parentId: "top" };

  it("does not open a project when Enter is pressed on its actions button", () => {
    const open = vi.fn();
    renderHome([folder, card], { projects: [project], onOpen: open });
    const button = host!.querySelector<HTMLButtonElement>(".fh-item .fh-kebab")!;
    expect(button.getAttribute("aria-expanded")).toBe("false");

    act(() => {
      button.focus();
      button.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })
      );
    });

    expect(open).not.toHaveBeenCalled();
    act(() => button.click());
    expect(button.getAttribute("aria-expanded")).toBe("true");
  });

  it("closes a delete modal when its project disappears in another tab", async () => {
    const props = renderHome([folder, card], { projects: [project] });
    act(() => host!.querySelector<HTMLButtonElement>(".fh-item .fh-kebab")!.click());
    act(() => {
      [...document.querySelectorAll<HTMLButtonElement>(".ui-menu-item")]
        .find((button) => button.textContent?.includes("Delete"))!
        .click();
    });
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();

    act(() => root?.render(<ProjectsHome {...props} projects={[]} />));
    await act(async () => {});

    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(host!.querySelector(".home-search"));
  });

  it("updates an open delete modal after a cross-tab rename", () => {
    const props = renderHome([folder, card], { projects: [project] });
    act(() => host!.querySelector<HTMLButtonElement>(".fh-item .fh-kebab")!.click());
    act(() => {
      [...document.querySelectorAll<HTMLButtonElement>(".ui-menu-item")]
        .find((button) => button.textContent?.includes("Delete"))!
        .click();
    });

    const renamed = { ...project, title: "Renamed elsewhere" };
    act(() => root?.render(<ProjectsHome {...props} projects={[renamed]} />));

    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
      "Renamed elsewhere"
    );
  });

  it("does not write when the keyboard move dialog selects the current folder", () => {
    const setFolder = vi.fn();
    renderHome([folder, card], { projects: [project], onSetFolder: setFolder });
    act(() => host!.querySelector<HTMLButtonElement>(".fh-item .fh-kebab")!.click());
    act(() => {
      [...document.querySelectorAll<HTMLButtonElement>(".ui-menu-item")]
        .find((button) => button.textContent?.includes("Move to"))!
        .click();
    });
    const current = [...document.querySelectorAll<HTMLButtonElement>(".move-item")].find(
      (button) => button.textContent?.includes("Card")
    )!;
    expect(current.getAttribute("aria-current")).toBe("location");
    act(() => current.click());

    expect(setFolder).not.toHaveBeenCalled();
  });

  it("hides nested shelves until their parent shelf is opened", () => {
    const child = { ...folder, id: "child", name: "Child", parentId: "card" };
    const grandchild = {
      ...folder,
      id: "grandchild",
      name: "Grandchild",
      parentId: "child",
    };
    const deepProject = { ...project, folderId: "grandchild" };
    renderHome([folder, card, child, grandchild], { projects: [deepProject] });

    expect(host!.textContent).toContain("Child");
    expect(host!.textContent).not.toContain("Grandchild");
    act(() => {
      [...host!.querySelectorAll<HTMLButtonElement>(".shelf-name")]
        .find((button) => button.textContent === "Child")!
        .click();
    });
    expect(host!.textContent).toContain("Grandchild");
  });

  it("keeps empty nested folders reachable", () => {
    const child = { ...folder, id: "child", name: "Empty child", parentId: "card" };
    renderHome([folder, card, child]);
    const openCard = host!.querySelector<HTMLButtonElement>(".pcard .film-caret")!;
    act(() => openCard.click());
    expect(host!.textContent).toContain("Empty child");
  });

  it("moves cyclic folder contents to the top when deleting the folder", () => {
    vi.useFakeTimers();
    const a = { ...folder, id: "a", name: "A", parentId: "b" };
    const b = { ...folder, id: "b", name: "B", parentId: "a" };
    const inside = { ...project, folderId: "a" };
    const updateFolder = vi.fn();
    const setFolder = vi.fn();
    renderHome([a, b], {
      projects: [inside],
      onUpdateFolder: updateFolder,
      onSetFolder: setFolder,
    });
    const aBand = [...host!.querySelectorAll<HTMLElement>(".band")].find((band) =>
      band.textContent?.includes("A")
    )!;
    act(() => aBand.querySelector<HTMLButtonElement>(".fh-kebab")!.click());
    act(() => {
      [...document.querySelectorAll<HTMLButtonElement>(".ui-menu-item")]
        .find((button) => button.textContent?.includes("Delete folder"))!
        .click();
    });
    const hold = document.querySelector<HTMLButtonElement>(".hold-btn")!;
    act(() => {
      hold.dispatchEvent(new Event("pointerdown", { bubbles: true }));
      vi.advanceTimersByTime(2_000);
    });

    expect(updateFolder).toHaveBeenCalledWith("b", { parentId: null });
    expect(setFolder).toHaveBeenCalledWith("draft", null);
    expect(updateFolder).not.toHaveBeenCalledWith("b", { parentId: "b" });
  });

  it("does not show an import result after the home unmounts", async () => {
    let finish!: (value: { imported: number; failed: string[] }) => void;
    const pending = new Promise<{ imported: number; failed: string[] }>((resolve) => {
      finish = resolve;
    });
    renderHome([], { onImportScreenplays: () => pending });
    const input = host!.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(input, "files", {
      configurable: true,
      value: [new File(["text"], "draft.fountain")],
    });
    act(() => input.dispatchEvent(new Event("change", { bubbles: true })));

    act(() => root?.render(<ToastHost />));
    await act(async () => finish({ imported: 1, failed: [] }));

    expect(document.querySelector('[role="status"]')).toBeNull();
  });
});

describe("HoldDelete", () => {
  it("clears every pending hold timer on unmount", () => {
    vi.useFakeTimers();
    const confirm = vi.fn();
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    act(() => root?.render(<HoldDelete onConfirm={confirm} />));
    const button = host.querySelector("button")!;

    act(() => {
      button.dispatchEvent(new Event("pointerdown", { bubbles: true }));
      button.dispatchEvent(new Event("pointerdown", { bubbles: true }));
      root?.unmount();
      root = null;
      vi.advanceTimersByTime(2_000);
    });

    expect(confirm).not.toHaveBeenCalled();
  });

  it("can be completed by holding a keyboard key", () => {
    vi.useFakeTimers();
    const confirm = vi.fn();
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    act(() => root?.render(<HoldDelete onConfirm={confirm} />));
    const button = host.querySelector("button")!;

    act(() => {
      button.dispatchEvent(
        new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true })
      );
      vi.advanceTimersByTime(2_000);
    });

    expect(confirm).toHaveBeenCalledOnce();
  });
});
