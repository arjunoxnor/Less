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
  // These tests drive the list layout; the desk (covers) has its own below.
  storage.set("less:home:layout:v1", "list");
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

/** Carry and rest over the target for `ms` before letting go (fake timers on). */
function carryAndHold(from: HTMLElement, over: () => Element | null, ms: number) {
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
    vi.advanceTimersByTime(ms);
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

  it("closes an open actions menu and carries on with the drag", () => {
    const setFolder = vi.fn();
    renderHome([stage, card, other], { projects: [draft], onSetFolder: setFolder });
    openProject("Card");
    act(() => host!.querySelector<HTMLButtonElement>(".lib-main .lib-row .lib-kebab")!.click());
    expect(document.querySelector(".ui-menu")).not.toBeNull();
    const row = host!.querySelector<HTMLElement>(".lib-main .lib-row")!;
    const target = [...host!.querySelectorAll(".lib-project")].find((el) =>
      el.textContent?.startsWith("Other")
    )!;
    carry(row.querySelector(".lib-row-title") as HTMLElement, () => target);
    expect(setFolder).toHaveBeenCalledWith("draft", "other");
    expect(document.querySelector(".ui-menu")).toBeNull();
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

  it("duplicates a script beside the original from its actions menu", async () => {
    const doc = { type: "doc", content: [{ type: "screenplayLine", attrs: { element: "action" } }] };
    storage.set("less:project:draft:doc", JSON.stringify(doc));
    const create = vi.fn(() => ({ ...draft, id: "copy", title: "Draft (copy)" }));
    renderHome([stage, card], { projects: [draft], onCreate: create });
    openProject("Card");
    act(() => host!.querySelector<HTMLButtonElement>(".lib-main .lib-row .lib-kebab")!.click());
    clickMenuItem("Duplicate");
    await act(async () => {});
    expect(create).toHaveBeenCalledWith("screenplay", "Draft (copy)", {
      content: doc,
      titlePage: null,
      folderId: "card",
      status: "writing",
    });
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

/* ---- The desk: covers, kinds and version stacks ---- */

const plain = (id: string, title: string, extra: Partial<ProjectMeta> = {}): ProjectMeta => ({
  ...draft,
  id,
  title,
  type: "plain",
  status: "not_started",
  ...extra,
});

/** Give an element a box, so the desk's hit-tests can measure it in jsdom. */
function box(el: Element, left: number, top: number, width: number, height: number) {
  (el as HTMLElement).getBoundingClientRect = () =>
    ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON() {} }) as DOMRect;
}

const tileTitled = (title: string) =>
  [...host!.querySelectorAll<HTMLElement>(".lib-main .dk-tile")].find(
    (el) => el.querySelector(".dk-title")?.textContent === title
  )!;

describe("ProjectsHome desk", () => {
  beforeEach(() => {
    storage.delete("less:home:layout:v1");
  });

  it("shows covers by default, each labeled with what it is", () => {
    const pitch = plain("pitch", "Pitch one-pager");
    renderHome([stage, card], { projects: [draft, pitch] });
    openProject("Card");
    expect(tileTitled("Draft").querySelector(".dk-kind")?.textContent).toBe("Script");
    expect(tileTitled("Pitch one-pager").querySelector(".dk-kind")?.textContent).toBe("One-pager");
    expect(tileTitled("Draft").querySelector(".cv-script")).not.toBeNull();
  });

  it("reads a document's kind from the folder it is filed in", () => {
    const shelf = { ...stage, id: "pagers", name: "One Pagers", parentId: "card" };
    storage.set("less:home:folds:v1", JSON.stringify({ pagers: true }));
    renderHome([stage, card, shelf], { projects: [plain("p", "Gods of our ancestors", { folderId: "pagers" })] });
    openProject("Card");
    // The folder sits on the desk, shut, and says what it holds.
    expect(host!.querySelector(".dk-folder .dk-folder-count")?.textContent).toBe("1 one-pager");
  });

  it("shows a stack as one cover and fans its versions out, current first", () => {
    const v1 = plain("v1", "Pitch, Oct 1", { stackId: "s", createdAt: "2026-07-01T00:00:00.000Z" });
    const v2 = plain("v2", "Pitch, Oct 9", {
      stackId: "s",
      stackTop: "2026-10-09T00:00:00.000Z",
      createdAt: "2026-07-05T00:00:00.000Z",
    });
    renderHome([stage, card], { projects: [v1, v2], onSetOrg: vi.fn() });
    openProject("Card");
    expect(host!.querySelectorAll(".lib-main .dk-spot > .dk-tile")).toHaveLength(1);
    const pill = host!.querySelector<HTMLButtonElement>(".dk-versions")!;
    expect(pill.textContent).toContain("2");
    act(() => pill.click());
    const fanned = [...host!.querySelectorAll(".dk-tray .dk-tile")];
    expect(fanned.map((el) => el.querySelector(".dk-title")?.textContent)).toEqual(["Pitch, Oct 9", "Pitch, Oct 1"]);
    expect(fanned[0].querySelector(".dk-current")).not.toBeNull();
  });

  it("offers to stack drafts that sit side by side, newest on top", () => {
    const setOrg = vi.fn();
    const older = plain("old", "Pitch one-pager v1", { updatedAt: "2026-07-02T00:00:00.000Z" });
    const newer = plain("new", "Pitch one-pager v2", { updatedAt: "2026-07-09T00:00:00.000Z" });
    renderHome([stage, card], { projects: [older, newer], onSetOrg: setOrg });
    openProject("Card");
    const banner = host!.querySelector(".dk-suggest")!;
    expect(banner.textContent).toContain("2 drafts of");
    act(() =>
      [...banner.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === "Stack them")!.click()
    );
    expect(setOrg).toHaveBeenCalledWith("new", { stackId: "new", stackTop: expect.any(String) });
    expect(setOrg).toHaveBeenCalledWith("old", { stackId: "new", stackTop: null });
  });

  it("stacks a cover held for a moment over the middle of another", () => {
    vi.useFakeTimers();
    const setOrg = vi.fn();
    const setFolder = vi.fn();
    const a = plain("a", "Treatment A");
    const b = plain("b", "Treatment B");
    renderHome([stage, card], { projects: [a, b], onSetOrg: setOrg, onSetFolder: setFolder });
    openProject("Card");
    const target = tileTitled("Treatment B");
    box(target.querySelector(".dk-art")!, 0, 0, 100, 140);
    carryAndHold(tileTitled("Treatment A").querySelector(".dk-title") as HTMLElement, () => target.querySelector(".cv"), 600);
    act(() => {
      vi.runOnlyPendingTimers();
    });
    vi.useRealTimers();
    expect(setOrg).toHaveBeenCalledWith("b", { stackId: "b", stackTop: expect.any(String) });
    expect(setOrg).toHaveBeenCalledWith("a", { stackId: "b", stackTop: null });
    expect(setFolder).not.toHaveBeenCalled();
  });

  it("puts a cover down on top of another, without stacking, when it is let go at once", () => {
    const setOrg = vi.fn();
    const setDesk = vi.fn();
    const a = plain("a", "Treatment A");
    const b = plain("b", "Treatment B");
    renderHome([stage, card], { projects: [a, b], onSetOrg: setOrg, onSetDesk: setDesk });
    openProject("Card");
    const target = tileTitled("Treatment B");
    box(target.querySelector(".dk-art")!, 0, 0, 100, 140);
    box(host!.querySelector("[data-desk]")!, 0, 0, 1200, 900);
    carry(tileTitled("Treatment A").querySelector(".dk-title") as HTMLElement, () => target.querySelector(".cv"));
    expect(setOrg).not.toHaveBeenCalled();
    expect(spotsOf(setDesk).find((x) => x.k === "d:a")).toMatchObject({ x: 30, y: 30 });
  });

  it("takes a version out of its stack when it is carried out of the fan onto the desk", () => {
    const setOrg = vi.fn();
    const setDesk = vi.fn();
    const v1 = plain("v1", "Outline one", { stackId: "s" });
    const v2 = plain("v2", "Outline two", { stackId: "s", stackTop: "2026-10-09T00:00:00.000Z" });
    renderHome([stage, card], { projects: [v1, v2], onSetOrg: setOrg, onSetDesk: setDesk });
    openProject("Card");
    act(() => host!.querySelector<HTMLButtonElement>(".dk-versions")!.click());
    const older = [...host!.querySelectorAll<HTMLElement>(".dk-tray .dk-tile")][1];
    const desk = host!.querySelector("[data-desk]")!;
    carry(older.querySelector(".dk-title") as HTMLElement, () => desk);
    // A stack of two left with one is no stack: both become documents again.
    expect(setOrg).toHaveBeenCalledWith("v1", { stackId: null, stackTop: null });
    expect(setOrg).toHaveBeenCalledWith("v2", { stackId: null, stackTop: null });
    // And it lands where it was let go, the other version keeping the stack's place.
    const layout = setDesk.mock.calls.at(-1)![1] as { spots: { k: string }[] };
    expect(layout.spots.map((x) => x.k)).toEqual(expect.arrayContaining(["d:v1", "d:v2"]));
  });

  it("lets the writer say what a document is", () => {
    const setOrg = vi.fn();
    renderHome([stage, card], { projects: [plain("d", "Some pages")], onSetOrg: setOrg });
    openProject("Card");
    act(() => tileTitled("Some pages").querySelector<HTMLButtonElement>(".lib-kebab")!.click());
    clickMenuItem("What is this?");
    act(() => {
      [...document.querySelectorAll<HTMLButtonElement>(".dk-kind-option")]
        .find((b) => b.textContent?.includes("Treatment"))!
        .click();
    });
    expect(setOrg).toHaveBeenCalledWith("d", { kind: "treatment" });
  });

  it("saves a draft into the original's stack and keeps the original on top", async () => {
    const doc = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Hi" }] }] };
    storage.set("less:project:one:doc", JSON.stringify(doc));
    const setOrg = vi.fn();
    const create = vi.fn(() => plain("copy", "One, Oct 17"));
    renderHome([stage, card], { projects: [plain("one", "One")], onSetOrg: setOrg, onCreate: create });
    openProject("Card");
    act(() => tileTitled("One").querySelector<HTMLButtonElement>(".lib-kebab")!.click());
    clickMenuItem("Save a draft");
    await act(async () => {});
    expect(create).toHaveBeenCalledWith(
      "plain",
      expect.stringMatching(/^One, /),
      expect.objectContaining({ content: doc, folderId: "card", stackId: "one" })
    );
    expect(setOrg).toHaveBeenCalledWith("one", { stackId: "one", stackTop: expect.any(String) });
  });

  it("shows a stage's projects as fanned hands of covers, with what is in them", () => {
    renderHome([stage, card], { projects: [draft, plain("p", "Pitch one-pager")] });
    act(() => host!.querySelector<HTMLElement>(".lib-stage-name")!.click());
    const tile = host!.querySelector(".lib-main .dk-project")!;
    expect(tile.querySelector(".dk-project-name")?.textContent).toBe("Card");
    expect(tile.querySelectorAll(".dk-fan-card")).toHaveLength(2);
    expect(tile.textContent).toContain("1 script");
    expect(tile.textContent).toContain("1 one-pager");
  });

  it("moves a project's box on its stage page by grabbing it anywhere", () => {
    const reorder = vi.fn();
    renderHome([stage, card, other], { projects: [draft], onReorderFolders: reorder });
    act(() => host!.querySelector<HTMLElement>(".lib-stage-name")!.click());
    const [first, second] = [...host!.querySelectorAll<HTMLElement>("[data-project-tile]")];
    expect(first.dataset.projectTile).toBe("card");
    // Both boxes sit to the left of where it is let go: it lands after the second.
    box(first, -600, 0, 250, 300);
    box(second, -300, 0, 250, 300);
    const page = host!.querySelector("[data-project-grid]")!;
    carry(first.querySelector(".dk-project-name") as HTMLElement, () => page);
    expect(reorder).toHaveBeenLastCalledWith(["other", "card"]);
  });

  it("switches to the list and remembers it", () => {
    renderHome([stage, card], { projects: [draft] });
    openProject("Card");
    act(() => host!.querySelector<HTMLButtonElement>(".dk-layout-toggle")!.click());
    expect(host!.querySelector(".lib-main .lib-row-title")?.textContent).toBe("Draft");
    expect(storage.get("less:home:layout:v1")).toBe("list");
  });
});

/* ---- A project as a desk: free placement, folders as objects, undo ---- */

const old: Folder = { ...stage, id: "old", name: "Old", parentId: "card" };
const spotsOf = (fn: ReturnType<typeof vi.fn>) =>
  (fn.mock.calls.at(-1)![1] as { spots: { k: string; x: number; y: number; w?: number; open?: boolean }[] }).spots;
const pressUndo = () =>
  act(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true, cancelable: true }));
  });

describe("ProjectsHome desk inside a project", () => {
  beforeEach(() => {
    storage.delete("less:home:layout:v1");
  });

  it("puts a cover right where it is let go, without moving anything else", () => {
    const setDesk = vi.fn();
    renderHome([stage, card], { projects: [plain("a", "Pitch A"), plain("b", "Pitch B")], onSetDesk: setDesk });
    openProject("Card");
    const desk = host!.querySelector("[data-desk]")!;
    box(desk, 0, 0, 1200, 900);
    carry(tileTitled("Pitch A").querySelector(".dk-title") as HTMLElement, () => desk);
    const spots = spotsOf(setDesk);
    // Grabbed 10px in from its corner, let go at (40, 40): its corner lands at (30, 30).
    expect(spots.find((x) => x.k === "d:a")).toMatchObject({ x: 30, y: 30 });
    // Everything else is pinned where it already sat, and the moved one is on top.
    expect(spots.map((x) => x.k)).toEqual(["d:b", "d:a"]);
  });

  it("files a document into a folder on the desk, and Ctrl+Z puts it back", () => {
    const setFolder = vi.fn();
    renderHome([stage, card, old], { projects: [plain("a", "Pitch A")], onSetFolder: setFolder, onSetDesk: vi.fn() });
    openProject("Card");
    const folder = host!.querySelector(".dk-folder")!;
    carry(tileTitled("Pitch A").querySelector(".dk-title") as HTMLElement, () => folder);
    expect(setFolder).toHaveBeenLastCalledWith("a", "old");
    pressUndo();
    expect(setFolder).toHaveBeenLastCalledWith("a", "card");
  });

  it("rifles through a shut folder and opens the one that comes up", () => {
    const open = vi.fn();
    const inside = ["One", "Two", "Three"].map((t, i) => plain("p" + i, t + " one-pager", { folderId: "old" }));
    renderHome([stage, card, old], { projects: inside, onOpen: open });
    openProject("Card");
    const body = host!.querySelector(".dk-folder-body")!;
    box(body, 0, 0, 300, 200);
    const front = host!.querySelector(".dk-folder-front")!;
    box(front, 0, 100, 300, 100);
    // On the folder's front the pointer is holding the folder: nothing comes up.
    act(() => {
      front.dispatchEvent(new PointerEvent("pointermove", { clientX: 250, clientY: 150, bubbles: true }));
    });
    expect(host!.querySelector(".dk-folder-pulled")).toBeNull();
    // Over the papers, they come up one at a time.
    act(() => {
      body.dispatchEvent(new PointerEvent("pointermove", { clientX: 250, clientY: 50, bubbles: true }));
    });
    expect(host!.querySelector(".dk-folder-pulled-title")?.textContent).toBe("Three one-pager");
    expect(host!.querySelector(".dk-folder-count")?.textContent).toBe("3 of 3");
    act(() => host!.querySelector<HTMLElement>(".dk-folder-pulled")!.click());
    expect(open).toHaveBeenCalledWith("p2");
  });

  it("moves an open folder from anywhere on it, while a thing inside comes out on its own", () => {
    const setDesk = vi.fn();
    const setFolder = vi.fn();
    const inside = plain("p", "Old draft", { folderId: "old" });
    const withDesk = { ...card, desk: { v: 1 as const, spots: [{ k: "f:old", x: 400, y: 300, open: true }] } };
    renderHome([stage, withDesk, old], { projects: [inside], onSetDesk: setDesk, onSetFolder: setFolder });
    openProject("Card");
    const desk = host!.querySelector("[data-desk]")!;
    box(desk, 0, 0, 1200, 900);
    // The empty space in the folder, not just its head, picks the folder up.
    carry(host!.querySelector<HTMLElement>(".dk-column-body")!, () => desk);
    expect(spotsOf(setDesk).find((x) => x.k === "f:old")).toMatchObject({ x: 30, y: 30, open: true });
    expect(setFolder).not.toHaveBeenCalled();
    // A row inside is carried as itself, out onto the desk.
    carry(host!.querySelector<HTMLElement>(".dk-column [data-row]")!, () => desk);
    expect(setFolder).toHaveBeenLastCalledWith("p", "card");
  });

  it("opens a folder into a column on the desk, and folds it shut again", () => {
    const setDesk = vi.fn();
    const inside = plain("p", "Old draft", { folderId: "old" });
    const props = renderHome([stage, card, old], { projects: [inside], onSetDesk: setDesk });
    openProject("Card");
    act(() => host!.querySelector<HTMLElement>(".dk-folder-front")!.click());
    const opened = spotsOf(setDesk).find((x) => x.k === "f:old");
    expect(opened).toMatchObject({ open: true });
    const withDesk = { ...card, desk: { v: 1 as const, spots: [{ k: "f:old", x: 40, y: 40, open: true }] } };
    act(() => root?.render(<ProjectsHome {...props} folders={[stage, withDesk, old]} />));
    expect(host!.querySelector(".dk-column .dk-row-title")?.textContent).toBe("Old draft");
    act(() => host!.querySelector<HTMLButtonElement>(".dk-column-fold")!.click());
    expect(spotsOf(setDesk).find((x) => x.k === "f:old")?.open).toBeUndefined();
  });

  it("makes a new one-pager from the toolbar, right where it is let go", () => {
    const setDesk = vi.fn();
    const create = vi.fn(() => plain("fresh", "Untitled one-pager", { folderId: "card" }));
    renderHome([stage, card], { projects: [], onCreate: create, onSetDesk: setDesk, onSetOrg: vi.fn() });
    openProject("Card");
    const desk = host!.querySelector("[data-desk]")!;
    box(desk, -100, -100, 1200, 900);
    const tool = [...host!.querySelectorAll<HTMLElement>(".dk-tool")].find((el) => el.textContent?.includes("One-pager"))!;
    carry(tool, () => desk);
    expect(create).toHaveBeenCalledWith(
      "plain",
      "Untitled one-pager",
      expect.objectContaining({ folderId: "card", kind: "onepager" })
    );
    // Let go at (40, 40) on a desk starting at (-100, -100): the pointer is at
    // (140, 140) on the desk, the middle of the new 188px cover (251px tall).
    expect(spotsOf(setDesk).find((x) => x.k === "d:fresh")).toMatchObject({ x: 46, y: 15 });
  });

  it("draws a desk laid out for a bigger screen scaled to fit, and drops land in desk units", () => {
    const setDesk = vi.fn();
    const wide = { ...card, desk: { v: 1 as const, w0: 2200, spots: [{ k: "d:a", x: 1600, y: 40 }] } };
    renderHome([stage, wide], { projects: [plain("a", "Pitch A"), plain("b", "Pitch B")], onSetDesk: setDesk });
    openProject("Card");
    const desk = host!.querySelector<HTMLElement>("[data-desk]")!;
    // Laid out for 2200, shown 1100 wide: half size would be too small, so the
    // smallest readable scale, and the rest scrolls.
    expect(desk.dataset.scale).toBe("0.55");
    expect(desk.style.zoom).toBe("0.55");
    box(desk, 0, 0, 1200, 900);
    carry(tileTitled("Pitch B").querySelector(".dk-title") as HTMLElement, () => desk);
    // Let go 30px (on screen) from where it was grabbed: 55 desk units.
    const spots = spotsOf(setDesk);
    expect(spots.find((x) => x.k === "d:b")).toMatchObject({ x: 55, y: 55 });
    expect((setDesk.mock.calls.at(-1)![1] as { w0?: number }).w0).toBe(2200);
  });

  it("gives a desk arranged before desks scaled the width it is shown at, the first time it changes", () => {
    const setDesk = vi.fn();
    const before = { ...card, desk: { v: 1 as const, spots: [{ k: "d:a", x: 40, y: 40 }] } };
    renderHome([stage, before], { projects: [plain("a", "Pitch A")], onSetDesk: setDesk });
    openProject("Card");
    expect(host!.querySelector<HTMLElement>("[data-desk]")!.dataset.scale).toBe("1");
    const desk = host!.querySelector("[data-desk]")!;
    box(desk, 0, 0, 1200, 900);
    carry(tileTitled("Pitch A").querySelector(".dk-title") as HTMLElement, () => desk);
    expect((setDesk.mock.calls.at(-1)![1] as { w0?: number }).w0).toBe(1100);
  });

  it("lets a drag be called off with Escape, and letting go then opens nothing", () => {
    const open = vi.fn();
    const setDesk = vi.fn();
    renderHome([stage, card], { projects: [plain("a", "Pitch A")], onOpen: open, onSetDesk: setDesk });
    openProject("Card");
    const title = tileTitled("Pitch A").querySelector(".dk-title") as HTMLElement;
    const at = (x: number, buttons: number) => ({ pointerId: 1, isPrimary: true, pointerType: "mouse", button: 0, buttons, clientX: x, clientY: 10, bubbles: true, cancelable: true });
    document.elementFromPoint = () => title;
    act(() => {
      title.dispatchEvent(new PointerEvent("pointerdown", at(10, 1)));
      window.dispatchEvent(new PointerEvent("pointermove", at(60, 1)));
    });
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    });
    expect(document.querySelector(".drag-ghost")).toBeNull();
    act(() => {
      window.dispatchEvent(new PointerEvent("pointerup", at(60, 0)));
      title.click();
    });
    expect(open).not.toHaveBeenCalled();
    expect(setDesk).not.toHaveBeenCalled();
  });

  it("puts a folder's size back when Escape is pressed while resizing it", () => {
    const setDesk = vi.fn();
    const open = vi.fn();
    renderHome([stage, card, old], { projects: [plain("p", "Old draft", { folderId: "old" })], onSetDesk: setDesk, onOpen: open });
    openProject("Card");
    const handle = host!.querySelector(".dk-folder-resize")!;
    const at = (x: number, buttons: number) => ({ pointerId: 1, button: 0, buttons, clientX: x, clientY: 100, bubbles: true });
    act(() => {
      handle.dispatchEvent(new PointerEvent("pointerdown", at(100, 1)));
      window.dispatchEvent(new PointerEvent("pointermove", at(180, 1)));
    });
    expect((host!.querySelector(".dk-folder") as HTMLElement).style.width).toBe("294px");
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    });
    expect((host!.querySelector(".dk-folder") as HTMLElement).style.width).toBe("214px");
    act(() => {
      window.dispatchEvent(new PointerEvent("pointerup", at(180, 0)));
      (host!.querySelector(".dk-folder-name") as HTMLElement).click();
    });
    expect(setDesk).not.toHaveBeenCalled();
  });

  it("makes a new note inside a shut folder without leaving the desk waiting for its name", () => {
    const setDesk = vi.fn();
    const create = vi.fn(() => plain("fresh", "Untitled notes", { folderId: "old" }));
    const props = renderHome([stage, card, old], {
      projects: [plain("a", "Pitch A")],
      onCreate: create,
      onSetDesk: setDesk,
      onSetOrg: vi.fn(),
    });
    openProject("Card");
    const tool = [...host!.querySelectorAll<HTMLElement>(".dk-tool")].find((el) => el.textContent?.includes("Note"))!;
    carry(tool, () => host!.querySelector(".dk-folder"));
    expect(create).toHaveBeenCalledWith("plain", "Untitled notes", expect.objectContaining({ folderId: "old" }));
    act(() =>
      root?.render(<ProjectsHome {...props} projects={[plain("a", "Pitch A"), plain("fresh", "Untitled notes", { folderId: "old" })]} />)
    );
    // Nothing is left half-renamed: the next thing carried still moves.
    const desk = host!.querySelector("[data-desk]")!;
    box(desk, 0, 0, 1200, 900);
    carry(tileTitled("Pitch A").querySelector(".dk-title") as HTMLElement, () => desk);
    expect(spotsOf(setDesk).find((x) => x.k === "d:a")).toMatchObject({ x: 30, y: 30 });
  });

  it("makes a new note inside an open folder when it is let go over the folder's list", () => {
    const create = vi.fn(() => plain("fresh", "Untitled notes", { folderId: "old" }));
    const withDesk = { ...card, desk: { v: 1 as const, spots: [{ k: "f:old", x: 400, y: 300, open: true }] } };
    renderHome([stage, withDesk, old], { projects: [], onCreate: create, onSetDesk: vi.fn(), onSetOrg: vi.fn() });
    openProject("Card");
    const tool = [...host!.querySelectorAll<HTMLElement>(".dk-tool")].find((el) => el.textContent?.includes("Note"))!;
    carry(tool, () => host!.querySelector(".dk-column-body"));
    expect(create).toHaveBeenCalledWith("plain", "Untitled notes", expect.objectContaining({ folderId: "old" }));
  });

  it("tidies up the desk, and undo puts every spot back", () => {
    const setDesk = vi.fn();
    const arranged = { ...card, desk: { v: 1 as const, spots: [{ k: "d:a", x: 700, y: 500 }, { k: "d:b", x: 40, y: 900 }] } };
    renderHome([stage, arranged], { projects: [plain("a", "Pitch A"), plain("b", "Pitch B")], onSetDesk: setDesk });
    openProject("Card");
    act(() => [...host!.querySelectorAll<HTMLButtonElement>(".dk-tidy")][0].click());
    expect(spotsOf(setDesk).find((x) => x.k === "d:a")).toMatchObject({ x: 28, y: 28 });
    pressUndo();
    expect(setDesk).toHaveBeenLastCalledWith("card", arranged.desk);
  });

  it("resizes a cover from its corner", () => {
    const setDesk = vi.fn();
    renderHome([stage, card], { projects: [plain("t", "Gods treatment")], onSetDesk: setDesk });
    openProject("Card");
    const handle = tileTitled("Gods treatment").querySelector<HTMLButtonElement>(".dk-resize")!;
    act(() => {
      handle.dispatchEvent(
        new PointerEvent("pointerdown", { pointerId: 1, button: 0, clientX: 100, clientY: 100, bubbles: true })
      );
      window.dispatchEvent(new PointerEvent("pointermove", { pointerId: 1, clientX: 160, clientY: 100 }));
      window.dispatchEvent(new PointerEvent("pointerup", { pointerId: 1, clientX: 160, clientY: 100 }));
    });
    // A treatment starts 188 wide; dragged 60 to the right.
    expect(spotsOf(setDesk).find((x) => x.k === "d:t")).toMatchObject({ w: 248 });
  });

  it("resizes a shut folder from its corner, and an open one in both directions", () => {
    const setDesk = vi.fn();
    const drag = (el: Element, dx: number, dy: number) =>
      act(() => {
        el.dispatchEvent(new PointerEvent("pointerdown", { pointerId: 1, button: 0, clientX: 100, clientY: 100, bubbles: true }));
        window.dispatchEvent(new PointerEvent("pointermove", { pointerId: 1, clientX: 100 + dx, clientY: 100 + dy }));
        window.dispatchEvent(new PointerEvent("pointerup", { pointerId: 1, clientX: 100 + dx, clientY: 100 + dy }));
      });
    const props = renderHome([stage, card, old], { projects: [plain("p", "Old draft", { folderId: "old" })], onSetDesk: setDesk });
    openProject("Card");
    drag(host!.querySelector(".dk-folder-resize")!, 60, 0);
    // A folder starts 214 wide; dragged 60 to the right.
    expect(spotsOf(setDesk).find((x) => x.k === "f:old")).toMatchObject({ w: 274 });
    const opened = { ...card, desk: { v: 1 as const, spots: [{ k: "f:old", x: 40, y: 40, w: 274, open: true }] } };
    act(() => root?.render(<ProjectsHome {...props} folders={[stage, opened, old]} />));
    drag(host!.querySelector(".dk-column-resize")!, 40, 80);
    // Open, it has its own size (292 wide to start), and keeps the shut size apart.
    expect(spotsOf(setDesk).find((x) => x.k === "f:old")).toMatchObject({ w: 274, ow: 332, oh: 400, open: true });
  });

  it("opens LESS's own menu on a right-click: make something right there, or a thing's own actions", () => {
    const setDesk = vi.fn();
    const create = vi.fn(() => plain("fresh", "Untitled one-pager", { folderId: "card" }));
    renderHome([stage, card, old], {
      projects: [plain("a", "Pitch A")],
      onCreate: create,
      onSetDesk: setDesk,
      onSetOrg: vi.fn(),
    });
    openProject("Card");
    const desk = host!.querySelector("[data-desk]")!;
    box(desk, 0, 0, 1200, 900);
    const rightClick = (el: Element, x: number, y: number) => {
      const ev = new MouseEvent("contextmenu", { clientX: x, clientY: y, bubbles: true, cancelable: true });
      act(() => {
        el.dispatchEvent(ev);
      });
      return ev;
    };
    // Empty desk: what can be made, and it lands where the click was.
    expect(rightClick(desk, 300, 200).defaultPrevented).toBe(true);
    clickMenuItem("New one-pager");
    expect(create).toHaveBeenCalledWith("plain", "Untitled one-pager", expect.objectContaining({ kind: "onepager" }));
    expect(spotsOf(setDesk).find((x) => x.k === "d:fresh")).toMatchObject({ x: 300, y: 200 });
    // A document: its own actions.
    rightClick(tileTitled("Pitch A").querySelector(".dk-title")!, 50, 50);
    expect(document.querySelector('[aria-label="Document actions"]')?.textContent).toContain("Rename");
    act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    // A folder: the folder's actions.
    rightClick(host!.querySelector(".dk-folder-front")!, 60, 60);
    expect(document.querySelector('[aria-label="Folder actions"]')?.textContent).toContain("Rename");
  });

  it("shows more of a folder as it grows: more papers, then a contents slip with the first titles", () => {
    const inside = Array.from({ length: 8 }, (_, i) => plain("q" + i, "Draft " + (i + 1), { folderId: "old" }));
    const at = (w: number) => ({ ...card, desk: { v: 1 as const, spots: [{ k: "f:old", x: 40, y: 40, w }] } });
    const props = renderHome([stage, at(150), old], { projects: inside });
    openProject("Card");
    const papers = () => host!.querySelectorAll(".dk-folder-paper").length;
    expect(papers()).toBe(3);
    expect(host!.querySelector(".dk-folder-slip")).toBeNull();
    act(() => root?.render(<ProjectsHome {...props} folders={[stage, at(300), old]} />));
    expect(papers()).toBe(7);
    expect([...host!.querySelectorAll(".dk-folder-slip-line")].map((l) => l.textContent)).toEqual([
      "Draft 1",
      "Draft 2",
      "Draft 3",
    ]);
    expect(host!.querySelector(".dk-folder-slip-more")?.textContent).toBe("and 5 more");
    act(() => root?.render(<ProjectsHome {...props} folders={[stage, at(420), old]} />));
    expect(papers()).toBe(8);
    expect(host!.querySelectorAll(".dk-folder-slip-line")).toHaveLength(5);
  });
});
