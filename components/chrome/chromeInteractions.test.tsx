// @vitest-environment jsdom

import { act, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DocsPanel } from "../DocsPanel";
import { EditorShell, type PanelId } from "./EditorShell";
import { EditorStatusBar } from "./EditorStatusBar";
import { HintCard } from "./HintCard";
import { TopBar } from "./TopBar";
import type { Folder } from "@/lib/storage/folders";
import type { ProjectMeta } from "@/lib/storage/projects";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;
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

function mount(node: ReactNode) {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root?.render(node));
}

afterEach(() => {
  if (root) act(() => root?.unmount());
  root = null;
  host?.remove();
  host = null;
  vi.useRealTimers();
  window.localStorage.clear();
});

const topBarProps = {
  title: "Original",
  onRename: vi.fn(),
  onBack: vi.fn(),
  cloudConfigured: false,
  user: null,
  syncStatus: "local" as const,
  sessionExpired: false,
  onSignIn: vi.fn(),
  modLabel: "Ctrl+",
  exportItems: [],
  overflowItems: [],
  theme: "light" as const,
  onThemeChange: vi.fn(),
  onToggleRail: vi.fn(),
  railOpen: false,
};

describe("TopBar", () => {
  it("cancels title editing on Escape without closing another shell layer", () => {
    const rename = vi.fn();
    mount(<TopBar {...topBarProps} onRename={rename} />);
    const input = host!.querySelector<HTMLInputElement>(".topbar-title")!;
    act(() => {
      input.focus();
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
        input,
        "Changed"
      );
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })
      );
    });

    expect(rename).not.toHaveBeenCalled();
    expect(input.value).toBe("Original");
  });

  it("reports whether the compact panel rail is open", () => {
    mount(<TopBar {...topBarProps} railOpen />);
    expect(
      host!.querySelector("[data-rail-toggle]")?.getAttribute("aria-expanded")
    ).toBe("true");
  });

  it("bounds a hostile stored title before rendering it", () => {
    mount(<TopBar {...topBarProps} title={"x".repeat(10_000)} />);
    expect(host!.querySelector<HTMLInputElement>(".topbar-title")!.value).toHaveLength(
      200
    );
  });
});

describe("EditorShell", () => {
  const shellProps = {
    focusMode: false,
    onExitFocus: vi.fn(),
    onEnterFocus: vi.fn(),
    title: "Draft",
    onRename: vi.fn(),
    onBack: vi.fn(),
    cloudConfigured: false,
    user: null,
    syncStatus: "local" as const,
    sessionExpired: false,
    onSignIn: vi.fn(),
    modLabel: "Ctrl+",
    exportItems: [],
    overflowItems: [],
    theme: "light" as const,
    onThemeChange: vi.fn(),
    railItems: [{ kind: "panel" as const, id: "docs" as const, label: "Docs" }],
  };

  it("restores focus to the panel trigger when dock content closes", () => {
    vi.useFakeTimers();
    function Harness() {
      const [panel, setPanel] = useState<PanelId | null>("docs");
      return (
        <EditorShell
          {...shellProps}
          activePanel={panel}
          onPanelChange={setPanel}
          dockPanel={<button onClick={() => setPanel(null)}>Close dock</button>}
        >
          <div>Page</div>
        </EditorShell>
      );
    }
    mount(<Harness />);
    const close = host!.querySelector<HTMLButtonElement>(".dock-inner button")!;
    act(() => {
      close.focus();
      close.click();
    });
    act(() => vi.runAllTimers());

    expect(document.activeElement).toBe(host!.querySelector('[data-panel-id="docs"]'));
  });

  it("closes the compact rail before exiting focus mode", () => {
    const exit = vi.fn();
    mount(
      <EditorShell
        {...shellProps}
        focusMode
        onExitFocus={exit}
        activePanel={null}
        onPanelChange={() => {}}
      >
        <div>Page</div>
      </EditorShell>
    );
    act(() => host!.querySelector<HTMLButtonElement>("[data-rail-toggle]")!.click());
    expect(host!.querySelector(".editor-shell")?.classList.contains("rail-open")).toBe(
      true
    );

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });

    expect(exit).not.toHaveBeenCalled();
    expect(host!.querySelector(".editor-shell")?.classList.contains("rail-open")).toBe(
      false
    );
  });
});

describe("EditorStatusBar", () => {
  it("does not open the line-type menu from a text field or modal", () => {
    mount(
      <>
        <input aria-label="Other field" />
        <EditorStatusBar
          currentElement="action"
          onSetElement={() => {}}
          mod="Ctrl+"
          dualVisible={false}
          dualActive={false}
          onToggleDual={() => {}}
          caretPage={1}
          pageCount={1}
          wordCount={0}
          saved
          saveError={false}
          locked={false}
        />
      </>
    );
    const input = host!.querySelector("input")!;
    act(() => {
      input.focus();
      input.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "e",
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        })
      );
    });
    expect(document.querySelector('[role="menu"]')).toBeNull();
  });
});

describe("HintCard", () => {
  it("creates one auto-dismiss timer and clears it on unmount", () => {
    vi.useFakeTimers();
    mount(<HintCard modLabel="Ctrl+" />);
    act(() => {
      for (let index = 0; index < 51; index++) {
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "a" }));
      }
    });
    expect(vi.getTimerCount()).toBe(1);
    act(() => root?.unmount());
    root = null;
    expect(vi.getTimerCount()).toBe(0);
  });

  it("closes when another tab records the dismissal", () => {
    mount(<HintCard modLabel="Ctrl+" />);
    expect(host!.querySelector(".hint-card")).not.toBeNull();

    act(() => {
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: "less:hints:v1",
          newValue: "dismissed",
        })
      );
    });

    expect(host!.querySelector(".hint-card")).toBeNull();
  });
});

describe("DocsPanel", () => {
  const folder: Folder = {
    id: "folder",
    name: "Folder",
    color: "#378ADD",
    stage: "in_progress",
    order: 0,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
  };
  const project: ProjectMeta = {
    id: "project",
    title: "Before rename",
    type: "screenplay",
    status: "writing",
    folderId: "folder",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    cloudCreated: true,
  };

  it("rereads storage while it remains mounted", () => {
    window.localStorage.setItem("less:folders", JSON.stringify([folder]));
    window.localStorage.setItem("less:projects:index", JSON.stringify([project]));
    mount(<DocsPanel projectId="project" onOpen={() => {}} onClose={() => {}} />);
    expect(host!.textContent).toContain("Before rename");

    window.localStorage.setItem(
      "less:projects:index",
      JSON.stringify([{ ...project, title: "After rename" }])
    );
    act(() =>
      root?.render(
        <DocsPanel projectId="project" onOpen={() => {}} onClose={() => {}} />
      )
    );

    expect(host!.textContent).toContain("After rename");
    expect(host!.textContent).not.toContain("Before rename");
  });
});
