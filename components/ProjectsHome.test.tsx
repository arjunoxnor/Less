// @vitest-environment jsdom

import { act } from "react";
import type { ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

const stage: Folder = {
  id: "top",
  name: "Top",
  color: "#3F7D5C",
  stage: "idea",
  order: 0,
  createdAt: "2026-07-01T00:00:00.000Z",
  updatedAt: "2026-07-01T00:00:00.000Z",
};
const card: Folder = { ...stage, id: "card", name: "Card", parentId: "top" };
const other: Folder = { ...stage, id: "other", name: "Other", parentId: "top", order: 1 };
const draft: ProjectMeta = {
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

function renderHome(folders: Folder[], overrides: Partial<ComponentProps<typeof ProjectsHome>> = {}) {
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

/** Open a project in the main pane from the sidebar. */
function openProject(name: string) {
  const row = [...host!.querySelectorAll<HTMLElement>(".lib-project")].find((el) =>
    el.textContent?.startsWith(name)
  )!;
  act(() => row.click());
}

function clickMenuItem(text: string) {
  act(() => {
    [...document.querySelectorAll<HTMLButtonElement>(".ui-menu-item")]
      .find((button) => button.textContent?.includes(text))!
      .click();
  });
}

beforeEach(() => {
  // jsdom has no layout: the drag hit-test asks the page what is under the
  // pointer, so each test says what that is.
  document.elementFromPoint = () => null;
});

afterEach(async () => {
  vi.useRealTimers();
  // A finished drag swallows the click that follows it for one task; let that
  // pass so it cannot eat the next test's first click.
  await new Promise((resolve) => setTimeout(resolve, 0));
  if (root) act(() => root?.unmount());
  root = null;
  host?.remove();
  host = null;
  storage.clear();
  document.querySelectorAll(".drag-ghost").forEach((el) => el.remove());
  document.documentElement.classList.remove("is-dragging");
  vi.useRealTimers();
});

describe("ProjectsHome library", () => {
  it("lists stages and their projects in the sidebar, and a project's contents on the right", () => {
    renderHome([stage, card], { projects: [draft] });
    expect(host!.querySelector(".lib-stage-name")?.textContent).toBe("Top");
    expect(host!.querySelector(".lib-project")?.textContent).toContain("Card");
    openProject("Card");
    expect(host!.querySelector(".lib-title")?.textContent).toBe("Card");
    expect(host!.querySelector(".lib-main .lib-row-title")?.textContent).toBe("Draft");
  });

  it("comes back to the view the writer left, after the first render", () => {
    storage.set("less:home:view:v1", "project:card");
    renderHome([stage, card], { projects: [draft] });
    expect(host!.querySelector(".lib-title")?.textContent).toBe("Card");
    expect(host!.querySelector(".lib-project.is-on")?.textContent).toContain("Card");
  });

  it("does not erase saved folds before folders finish hydrating", () => {
    storage.set("less:home:folds:v1", JSON.stringify({ top: false }));
    renderHome([]);
    expect(storage.get("less:home:folds:v1")).toBe(JSON.stringify({ top: false }));
  });

  it("adopts fold changes made in another tab", () => {
    renderHome([stage]);
    const caret = host!.querySelector<HTMLButtonElement>(".lib-stage-head .lib-caret")!;
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

  it("hides nested folders until their parent folder is opened", () => {
    const child = { ...stage, id: "child", name: "Child", parentId: "card" };
    const grandchild = { ...stage, id: "grandchild", name: "Grandchild", parentId: "child" };
    renderHome([stage, card, child, grandchild], { projects: [{ ...draft, folderId: "grandchild" }] });
    openProject("Card");
    expect(host!.querySelector(".lib-main")!.textContent).toContain("Child");
    expect(host!.querySelector(".lib-main")!.textContent).not.toContain("Grandchild");
    act(() => {
      [...host!.querySelectorAll<HTMLButtonElement>(".shelf-name")]
        .find((button) => button.textContent === "Child")!
        .click();
    });
    expect(host!.querySelector(".lib-main")!.textContent).toContain("Grandchild");
  });

  it("keeps empty nested folders reachable", () => {
    const child = { ...stage, id: "child", name: "Empty child", parentId: "card" };
    renderHome([stage, card, child]);
    openProject("Card");
    expect(host!.querySelector(".lib-main")!.textContent).toContain("Empty child");
  });
});

/** Carry a row with the pointer and let go over whatever the page reports. */
function carry(from: HTMLElement, over: () => Element | null) {
  const at = (x: number, y: number) => ({
    pointerId: 1,
    isPrimary: true,
    pointerType: "mouse",
    button: 0,
    buttons: 1,
    clientX: x,
    clientY: y,
    bubbles: true,
    cancelable: true,
  });
  document.elementFromPoint = () => over();
  act(() => {
    from.dispatchEvent(new PointerEvent("pointerdown", at(10, 10)));
    window.dispatchEvent(new PointerEvent("pointermove", at(40, 40)));
  });
  act(() => {
    window.dispatchEvent(new PointerEvent("pointerup", at(40, 40)));
  });
}

describe("ProjectsHome dragging", () => {
  it("files a script into a project it is dropped on in the sidebar", () => {
    const setFolder = vi.fn();
    renderHome([stage, card, other], { projects: [draft], onSetFolder: setFolder });
    openProject("Card");
    const row = host!.querySelector<HTMLElement>(".lib-main .lib-row")!;
    const target = [...host!.querySelectorAll(".lib-project")].find((el) =>
      el.textContent?.startsWith("Other")
    )!;
    carry(row.querySelector(".lib-row-title") as HTMLElement, () => target);
    expect(setFolder).toHaveBeenCalledWith("draft", "other");
    expect(host!.querySelector(".is-lifted")).toBeNull();
  });

  it("does not stamp placement when a script is dropped on its own folder", () => {
    const setFolder = vi.fn();
    const reorder = vi.fn();
    renderHome([stage, card], { projects: [draft], onSetFolder: setFolder, onReorder: reorder });
    openProject("Card");
    const row = host!.querySelector<HTMLElement>(".lib-main .lib-row")!;
    const own = host!.querySelector(".lib-project")!;
    carry(row.querySelector(".lib-row-title") as HTMLElement, () => own);
    expect(setFolder).not.toHaveBeenCalled();
    expect(reorder).not.toHaveBeenCalled();
  });

  it("does not start a drag while an actions menu is open", () => {
    const setFolder = vi.fn();
    renderHome([stage, card, other], { projects: [draft], onSetFolder: setFolder });
    openProject("Card");
    act(() => host!.querySelector<HTMLButtonElement>(".lib-main .lib-row .lib-kebab")!.click());
    const row = host!.querySelector<HTMLElement>(".lib-main .lib-row")!;
    const target = [...host!.querySelectorAll(".lib-project")].find((el) =>
      el.textContent?.startsWith("Other")
    )!;
    carry(row.querySelector(".lib-row-title") as HTMLElement, () => target);
    expect(setFolder).not.toHaveBeenCalled();
    expect(document.querySelector(".drag-ghost")).toBeNull();
  });

  it("does not open the script after it has been carried", () => {
    const open = vi.fn();
    renderHome([stage, card, other], { projects: [draft], onOpen: open });
    openProject("Card");
    const title = host!.querySelector<HTMLElement>(".lib-main .lib-row .lib-row-title")!;
    carry(title, () => null);
    act(() => title.click());
    expect(open).not.toHaveBeenCalled();
  });
});

describe("ProjectsHome layered interactions", () => {
  it("does not open a script when Enter is pressed on its actions button", () => {
    const open = vi.fn();
    renderHome([stage, card], { projects: [draft], onOpen: open });
    openProject("Card");
    const button = host!.querySelector<HTMLButtonElement>(".lib-main .lib-row .lib-kebab")!;
    expect(button.getAttribute("aria-expanded")).toBe("false");
    act(() => {
      button.focus();
      button.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    });
    expect(open).not.toHaveBeenCalled();
    act(() => button.click());
    expect(button.getAttribute("aria-expanded")).toBe("true");
  });

  it("closes a delete dialog when its script disappears in another tab", async () => {
    const props = renderHome([stage, card], { projects: [draft] });
    openProject("Card");
    act(() => host!.querySelector<HTMLButtonElement>(".lib-main .lib-row .lib-kebab")!.click());
    clickMenuItem("Delete");
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    act(() => root?.render(<ProjectsHome {...props} projects={[]} />));
    await act(async () => {});
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(host!.querySelector(".home-search"));
  });

  it("updates an open delete dialog after a rename in another tab", () => {
    const props = renderHome([stage, card], { projects: [draft] });
    openProject("Card");
    act(() => host!.querySelector<HTMLButtonElement>(".lib-main .lib-row .lib-kebab")!.click());
    clickMenuItem("Delete");
    act(() => root?.render(<ProjectsHome {...props} projects={[{ ...draft, title: "Renamed elsewhere" }]} />));
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Renamed elsewhere");
  });

  it("does not write when the move dialog picks the current folder", () => {
    const setFolder = vi.fn();
    renderHome([stage, card], { projects: [draft], onSetFolder: setFolder });
    openProject("Card");
    act(() => host!.querySelector<HTMLButtonElement>(".lib-main .lib-row .lib-kebab")!.click());
    clickMenuItem("Move to");
    const current = [...document.querySelectorAll<HTMLButtonElement>(".move-item")].find((button) =>
      button.textContent?.includes("Card")
    )!;
    expect(current.getAttribute("aria-current")).toBe("location");
    act(() => current.click());
    expect(setFolder).not.toHaveBeenCalled();
  });

  it("moves cyclic folder contents to the top when deleting the folder", () => {
    vi.useFakeTimers();
    const a = { ...stage, id: "a", name: "A", parentId: "b" };
    const b = { ...stage, id: "b", name: "B", parentId: "a" };
    const updateFolder = vi.fn();
    const setFolder = vi.fn();
    renderHome([a, b], {
      projects: [{ ...draft, folderId: "a" }],
      onUpdateFolder: updateFolder,
      onSetFolder: setFolder,
    });
    const aHead = [...host!.querySelectorAll<HTMLElement>(".lib-stage-head")].find((head) =>
      head.textContent?.includes("A")
    )!;
    act(() => aHead.querySelector<HTMLButtonElement>(".lib-kebab")!.click());
    clickMenuItem("Delete folder");
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
    expect(document.body.textContent).not.toContain("Imported 1 script");
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
      button.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true }));
      vi.advanceTimersByTime(2_000);
    });
    expect(confirm).toHaveBeenCalledOnce();
  });
});
