// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { docOf, line } from "@/lib/editor/testKit";
import { HistoryPanel } from "./HistoryPanel";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  if (root) act(() => root?.unmount());
  root = null;
  host?.remove();
  host = null;
});

describe("HistoryPanel restore metadata", () => {
  it("preserves an explicit null title page so restore can clear the current one", async () => {
    const onRestore = vi.fn();
    const content = docOf(line("action", "Earlier"));
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => {
      root?.render(
        <HistoryPanel
          getVersions={async () => [
            {
              id: "version-1",
              content,
              title_page: null,
              label: "Earlier version",
              created_at: "2026-08-01T00:00:00.000Z",
            },
          ]}
          onRestore={onRestore}
          onClose={() => {}}
        />
      );
    });
    const restore = host.querySelector<HTMLButtonElement>(".history-restore");
    expect(restore?.title).toContain("remove the current title page");
    act(() => restore?.click());
    expect(onRestore).toHaveBeenCalledWith(content, null);
  });
});
