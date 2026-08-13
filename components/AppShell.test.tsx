// @vitest-environment jsdom

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const projectApi = vi.hoisted(() => ({
  projects: [],
  folders: [],
  refresh: vi.fn(),
  syncNow: vi.fn(async () => true),
  create: vi.fn(),
  remove: vi.fn(),
  rename: vi.fn(),
  setStatus: vi.fn(),
  setFolder: vi.fn(),
  reorder: vi.fn(),
  createFolder: vi.fn(),
  reorderFolders: vi.fn(),
  updateFolder: vi.fn(),
  deleteFolder: vi.fn(),
}));

vi.mock("@/lib/cloud/auth", () => ({
  useAuth: () => ({ user: null, sessionExpired: false }),
  signOut: vi.fn(),
}));
vi.mock("@/lib/cloud/client", () => ({ isCloudConfigured: false }));
vi.mock("@/lib/storage/useProjects", () => ({ useProjects: () => projectApi }));
vi.mock("./ProjectsHome", () => ({
  ProjectsHome: (props: {
    prefs: { theme: string };
    onPrefsChange: (next: { theme: "dark" }) => void;
  }) => (
    <div data-testid="home" data-theme={props.prefs.theme}>
      <button type="button" onClick={() => props.onPrefsChange({ theme: "dark" })}>
        Dark
      </button>
    </div>
  ),
}));
vi.mock("./EditorHost", () => ({
  // Stand in for the editor, exposing only the duet stage 3 hook: a guest's
  // "save a copy" reaches the app shell through this callback.
  EditorHost: (props: {
    onSaveDuetCopy?: (input: { type: string; title: string; content: unknown }) => unknown;
  }) =>
    props.onSaveDuetCopy ? (
      <button
        type="button"
        data-testid="save-duet-copy"
        onClick={() =>
          props.onSaveDuetCopy?.({
            type: "screenplay",
            title: "Kept from the link",
            content: { type: "doc", content: [] },
          })
        }
      />
    ) : null,
}));
vi.mock("./AuthModal", () => ({ AuthModal: () => null }));
vi.mock("./SessionExpiredBanner", () => ({ SessionExpiredBanner: () => null }));
vi.mock("@/lib/export", () => ({ importFile: vi.fn() }));

import { AppShell } from "./AppShell";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;
const storage = new Map<string, string>();
const localStorageMock = {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: vi.fn((key: string, value: string) => storage.set(key, value)),
  removeItem: (key: string) => storage.delete(key),
  clear: () => storage.clear(),
};
Object.defineProperty(window, "localStorage", {
  configurable: true,
  value: localStorageMock,
});

function mount(node: ReactNode) {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root?.render(node));
}

beforeEach(() => {
  storage.clear();
  localStorageMock.setItem.mockClear();
  window.localStorage.setItem("less:seeded:v1", "1");
  window.location.hash = "";
});

afterEach(() => {
  if (root) act(() => root?.unmount());
  root = null;
  host?.remove();
  host = null;
  vi.restoreAllMocks();
});

describe("AppShell preferences", () => {
  it("does not write stored preferences back during mount", () => {
    window.localStorage.setItem(
      "less:prefs",
      JSON.stringify({ theme: "light", autoContd: true })
    );
    localStorageMock.setItem.mockClear();
    mount(<AppShell />);

    expect(
      localStorageMock.setItem.mock.calls.filter(([key]) => key === "less:prefs")
    ).toHaveLength(0);
  });

  it("adopts an external preference change without echoing it", () => {
    mount(<AppShell />);
    const next = JSON.stringify({ theme: "dark", autoContd: true });
    window.localStorage.setItem("less:prefs", next);
    localStorageMock.setItem.mockClear();

    act(() => {
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: "less:prefs",
          newValue: next,
        })
      );
    });

    expect(host!.querySelector('[data-testid="home"]')?.getAttribute("data-theme")).toBe(
      "dark"
    );
    expect(
      localStorageMock.setItem.mock.calls.filter(([key]) => key === "less:prefs")
    ).toHaveLength(0);
  });

  it("persists an explicit local preference change once", () => {
    mount(<AppShell />);
    localStorageMock.setItem.mockClear();

    act(() => host!.querySelector("button")!.click());

    expect(
      localStorageMock.setItem.mock.calls.filter(([key]) => key === "less:prefs")
    ).toHaveLength(1);
  });
});

describe("AppShell routing", () => {
  it("falls back to the home for a malformed encoded project hash", () => {
    window.location.hash = "#/p/%E0%A4%A";

    expect(() => mount(<AppShell />)).not.toThrow();
    expect(host!.querySelector('[data-testid="home"]')).not.toBeNull();
  });
});

describe("Keeping a shared script (duet stage 3)", () => {
  const token = "d".repeat(43);

  it("files the guest's copy as an ordinary project and opens it", () => {
    projectApi.create.mockReturnValue({ id: "kept-1", title: "Kept from the link" });
    // The real create writes the index; here it is mocked, so stand the row up
    // by hand or the shell would bounce straight back to the home.
    window.localStorage.setItem(
      "less:projects:index",
      JSON.stringify([
        {
          id: "kept-1",
          title: "Kept from the link",
          type: "screenplay",
          status: "writing",
          createdAt: "2026-08-01T00:00:00.000Z",
          updatedAt: "2026-08-01T00:00:00.000Z",
          cloudCreated: false,
        },
      ])
    );
    window.location.hash = `#/duet/${token}`;
    mount(<AppShell />);

    act(() => host!.querySelector<HTMLButtonElement>('[data-testid="save-duet-copy"]')!.click());

    expect(projectApi.create).toHaveBeenCalledWith("screenplay", "Kept from the link", {
      content: { type: "doc", content: [] },
    });
    // Somewhere unambiguous: the writer lands in their own copy, not the room.
    expect(window.location.hash).toBe("#/p/kept-1");
  });

  it("offers nothing to save from an ordinary project", () => {
    window.location.hash = "";
    mount(<AppShell />);

    expect(host!.querySelector('[data-testid="save-duet-copy"]')).toBeNull();
  });
});
