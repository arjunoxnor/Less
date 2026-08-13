// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DuetCopyPlan } from "@/lib/collab/duetCopy";
import { DuetSaveCopyModal } from "./DuetSaveCopyModal";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

const plan: DuetCopyPlan = {
  type: "screenplay",
  title: "Nightfall",
  content: { type: "doc", content: [] },
  previous: null,
};

async function render(node: React.ReactElement) {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root?.render(node);
  });
}

/** React tracks the input's value, so a plain assignment is not seen. */
function type(field: HTMLInputElement | null, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
    field,
    value
  );
  field?.dispatchEvent(new Event("input", { bubbles: true }));
}

function button(label: string): HTMLButtonElement | undefined {
  return [...document.body.querySelectorAll<HTMLButtonElement>(".ui-modal-actions button")].find(
    (candidate) => candidate.textContent === label
  );
}

afterEach(() => {
  if (root) act(() => root?.unmount());
  root = null;
  host?.remove();
  host = null;
});

describe("Saving a guest's copy", () => {
  it("says the copy is a snapshot and where the writer ends up", async () => {
    await render(<DuetSaveCopyModal plan={plan} saving={false} onSave={() => {}} onClose={() => {}} />);
    const text = document.body.querySelector(".ui-modal-body")?.textContent ?? "";
    expect(text).toContain("will not follow later");
    expect(text).toContain("will not go back");
    expect(text).toContain("Saving opens your copy, so you leave the shared session");
  });

  it("saves under the name the writer typed", async () => {
    const onSave = vi.fn();
    await render(<DuetSaveCopyModal plan={plan} saving={false} onSave={onSave} onClose={() => {}} />);
    const field = document.body.querySelector<HTMLInputElement>(".field input");
    expect(field?.value).toBe("Nightfall");
    await act(async () => type(field, "  My own draft  "));
    act(() => button("Save copy")?.click());
    expect(onSave).toHaveBeenCalledWith("My own draft");
  });

  it("cannot be saved with an empty name, or twice while a save is running", async () => {
    const onSave = vi.fn();
    await render(<DuetSaveCopyModal plan={plan} saving={false} onSave={onSave} onClose={() => {}} />);
    const field = document.body.querySelector<HTMLInputElement>(".field input");
    await act(async () => type(field, "   "));
    expect(button("Save copy")?.disabled).toBe(true);

    await act(async () => {
      root?.render(
        <DuetSaveCopyModal plan={plan} saving onSave={onSave} onClose={() => {}} />
      );
    });
    expect(button("Saving…")?.disabled).toBe(true);
    expect(onSave).not.toHaveBeenCalled();
  });

  it("warns when this link was already saved, and proposes a different name", async () => {
    await render(
      <DuetSaveCopyModal
        plan={{
          ...plan,
          title: "Nightfall (2)",
          previous: { projectId: "p1", title: "Nightfall", savedAt: "" },
        }}
        saving={false}
        onSave={() => {}}
        onClose={() => {}}
      />
    );
    const text = document.body.querySelector(".ui-modal-body")?.textContent ?? "";
    expect(text).toContain("You have already saved this shared script as Nightfall");
    expect(document.body.querySelector<HTMLInputElement>(".field input")?.value).toBe(
      "Nightfall (2)"
    );
  });
});
