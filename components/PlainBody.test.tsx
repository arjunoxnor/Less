// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import type { Editor } from "@tiptap/react";
import { DEFAULT_PREFS } from "@/lib/storage/localStore";
import { PlainBody } from "./PlainBody";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const projectId = "plain-test";
const storage = new Map<string, string>();

class TestBroadcastChannel {
  static instances: TestBroadcastChannel[] = [];
  private listeners = new Set<(event: MessageEvent) => void>();

  constructor(_name: string) {
    TestBroadcastChannel.instances.push(this);
  }

  addEventListener(_type: string, listener: (event: MessageEvent) => void) {
    this.listeners.add(listener);
  }

  removeEventListener(_type: string, listener: (event: MessageEvent) => void) {
    this.listeners.delete(listener);
  }

  postMessage(_message: unknown) {}

  emit(data: unknown) {
    for (const listener of this.listeners) listener({ data } as MessageEvent);
  }
}

Object.defineProperty(globalThis, "BroadcastChannel", {
  configurable: true,
  value: TestBroadcastChannel,
});

Object.defineProperty(window, "localStorage", {
  configurable: true,
  value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  },
});

let root: Root | null = null;
let host: HTMLDivElement | null = null;

async function renderPlainBody() {
  storage.set(
    `less:project:${projectId}:doc`,
    JSON.stringify({ type: "doc", content: [{ type: "paragraph" }] })
  );
  storage.set(
    "less:projects:index",
    JSON.stringify([
      {
        id: projectId,
        title: "Test",
        type: "plain",
        status: "writing",
        createdAt: "2026-08-01T00:00:00.000Z",
        updatedAt: "2026-08-01T00:00:00.000Z",
        cloudCreated: false,
      },
    ])
  );
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root?.render(
      <PlainBody
        projectId={projectId}
        title="Test"
        onRename={() => {}}
        status="writing"
        onStatusChange={() => {}}
        onBack={() => {}}
        prefs={DEFAULT_PREFS}
        onPrefsChange={() => {}}
        user={null}
      />
    );
  });
  for (let attempt = 0; attempt < 10; attempt++) {
    if ((window as unknown as { __lessPlainEditor?: Editor }).__lessPlainEditor) break;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
  return (window as unknown as { __lessPlainEditor?: Editor }).__lessPlainEditor;
}

afterEach(() => {
  if (root) {
    act(() => root?.unmount());
  }
  root = null;
  host?.remove();
  host = null;
  storage.clear();
  delete (window as unknown as { __lessPlainEditor?: Editor }).__lessPlainEditor;
});

describe("PlainBody document lifecycle", () => {
  it("uses prose pagination and page sheets without the screenplay plugin", async () => {
    const editor = await renderPlainBody();
    expect(editor).toBeDefined();
    expect(editor!.extensionManager.extensions.map((extension) => extension.name)).not.toContain(
      "pagination"
    );
    expect(editor!.extensionManager.extensions.map((extension) => extension.name)).toContain(
      "docPagination"
    );
    expect(host!.querySelector(".plain-sheet")).toBeNull();
    expect(host!.querySelector(".page-backdrop")).not.toBeNull();
    expect(host!.querySelector<HTMLElement>(".page-host-pl")!.style.minHeight).toBe("1056px");
    expect(host!.textContent).toContain("Page 1 of 1");
  }, 60_000);

  it("flushes an edit when closed before the debounce fires", async () => {
    const editor = await renderPlainBody();
    act(() => {
      editor!.commands.insertContent("Last word");
    });
    act(() => root?.unmount());
    root = null;

    const saved = JSON.parse(storage.get(`less:project:${projectId}:doc`) ?? "null");
    expect(saved.content?.[0]?.content?.[0]?.text).toBe("Last word");
  }, 60_000);

  it("does not let a sibling-tab save replace a pending local edit", async () => {
    const editor = await renderPlainBody();
    act(() => {
      editor!.commands.insertContent("Mine");
    });
    storage.set(
      `less:project:${projectId}:doc`,
      JSON.stringify({
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "Other" }] }],
      })
    );
    act(() => {
      TestBroadcastChannel.instances[0].emit({ type: "docSaved", id: projectId });
    });
    expect(editor!.getText()).toBe("Mine");
  }, 60_000);
});
