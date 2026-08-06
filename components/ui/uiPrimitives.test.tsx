// @vitest-environment jsdom

import { act, useRef, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Menu } from "./Menu";
import { Modal } from "./Modal";
import { showToast, ToastHost } from "./Toast";
import { Tooltip } from "./Tooltip";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

function mount(node: ReactNode) {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root?.render(node));
}

afterEach(async () => {
  if (root) act(() => root?.unmount());
  root = null;
  host?.remove();
  host = null;
  vi.useRealTimers();
  await act(async () => {});
  document.body.style.overflow = "";
});

function MenuHarness() {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button ref={trigger} type="button" onClick={() => setOpen((value) => !value)}>
        Actions
      </button>
      {open && trigger.current && (
        <Menu
          anchor={trigger.current.getBoundingClientRect()}
          items={[
            { label: "Disabled", disabled: true, onSelect: () => {} },
            { label: "First", onSelect: () => {} },
            { label: "Second", onSelect: () => {} },
          ]}
          onClose={() => setOpen(false)}
          ariaLabel="Actions"
        />
      )}
    </>
  );
}

describe("Menu", () => {
  it("closes when its own trigger is clicked again", () => {
    mount(<MenuHarness />);
    const trigger = host!.querySelector("button")!;
    act(() => {
      trigger.focus();
      trigger.click();
    });
    expect(document.querySelector('[role="menu"]')).not.toBeNull();

    act(() => {
      trigger.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      trigger.click();
    });

    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("announces the active, enabled menu item", () => {
    mount(<MenuHarness />);
    act(() => host!.querySelector("button")!.click());
    const menu = document.querySelector<HTMLElement>('[role="menu"]')!;
    const first = [...menu.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
      (item) => item.textContent?.includes("First")
    )!;
    expect(menu.getAttribute("aria-activedescendant")).toBe(first.id);

    act(() => {
      menu.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })
      );
    });
    const second = [...menu.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
      (item) => item.textContent?.includes("Second")
    )!;
    expect(menu.getAttribute("aria-activedescendant")).toBe(second.id);
  });

  it("does not steal focus from a modal opened by a menu action", () => {
    function Harness() {
      const [menu, setMenu] = useState(false);
      const [modal, setModal] = useState(false);
      const trigger = useRef<HTMLButtonElement>(null);
      return (
        <>
          <button ref={trigger} onClick={() => setMenu(true)}>
            Open actions
          </button>
          {menu && trigger.current && (
            <Menu
              anchor={trigger.current.getBoundingClientRect()}
              items={[
                {
                  label: "Open dialog",
                  onSelect: () => setModal(true),
                },
              ]}
              onClose={() => setMenu(false)}
            />
          )}
          {modal && (
            <Modal title="Opened dialog" onClose={() => setModal(false)}>
              <input aria-label="Dialog field" />
            </Modal>
          )}
        </>
      );
    }
    mount(<Harness />);
    act(() => host!.querySelector("button")!.click());
    act(() => document.querySelector<HTMLButtonElement>(".ui-menu-item")!.click());

    expect(document.activeElement).toBe(
      document.querySelector('[aria-label="Dialog field"]')
    );
  });
});

describe("Modal", () => {
  it("lets only the top modal handle Escape", () => {
    function Harness() {
      const [outer, setOuter] = useState(true);
      const [inner, setInner] = useState(true);
      return (
        <>
          {outer && (
            <Modal title="Outer" onClose={() => setOuter(false)}>
              <button type="button">Outer action</button>
            </Modal>
          )}
          {inner && (
            <Modal title="Inner" onClose={() => setInner(false)}>
              <input aria-label="Inner field" />
            </Modal>
          )}
        </>
      );
    }
    mount(<Harness />);

    act(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })
      );
    });

    const dialogs = [...document.querySelectorAll<HTMLElement>('[role="dialog"]')];
    expect(dialogs).toHaveLength(1);
    expect(dialogs[0].textContent).toContain("Outer");
  });

  it("keeps scroll and focus locked when an underlying modal closes first", () => {
    let closeOuter = () => {};
    function Harness() {
      const [outer, setOuter] = useState(true);
      closeOuter = () => setOuter(false);
      return (
        <>
          {outer && (
            <Modal title="Outer" onClose={() => setOuter(false)}>
              <button type="button">Outer action</button>
            </Modal>
          )}
          <Modal title="Inner" onClose={() => {}}>
            <input aria-label="Inner field" />
          </Modal>
        </>
      );
    }
    mount(<Harness />);
    const inner = document.querySelector<HTMLInputElement>('[aria-label="Inner field"]')!;
    expect(document.activeElement).toBe(inner);

    act(() => closeOuter());

    expect(document.body.style.overflow).toBe("hidden");
    expect(document.activeElement).toBe(inner);
  });

  it("keeps Tab inside the top modal and away from background shortcuts", () => {
    mount(
      <Modal title="Trap" onClose={() => {}}>
        <button type="button">First</button>
        <button type="button">Second</button>
      </Modal>
    );
    const buttons = document.querySelectorAll<HTMLButtonElement>(".ui-modal-body button");
    const background = vi.fn();
    window.addEventListener("keydown", background);
    act(() => {
      buttons[0].focus();
      buttons[0].dispatchEvent(
        new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true })
      );
    });
    window.removeEventListener("keydown", background);

    expect(document.activeElement).toBe(buttons[1]);
    expect(background).not.toHaveBeenCalled();
  });
});

describe("ToastHost", () => {
  it("does not show a toast that expired before a host mounted", () => {
    vi.useFakeTimers();
    act(() => showToast("Too old"));
    act(() => vi.advanceTimersByTime(4_000));
    mount(<ToastHost />);
    expect(document.querySelector('[role="status"]')).toBeNull();
  });

  it("does not resurrect an expired toast after a host remount", () => {
    vi.useFakeTimers();
    mount(<ToastHost />);
    act(() => showToast("Finished"));
    expect(document.querySelector('[role="status"]')?.textContent).toBe("Finished");
    act(() => vi.advanceTimersByTime(4_000));
    expect(document.querySelector('[role="status"]')).toBeNull();

    act(() => root?.render(<div />));
    act(() => root?.render(<ToastHost />));
    expect(document.querySelector('[role="status"]')).toBeNull();
  });

  it("announces danger toasts as alerts", () => {
    mount(<ToastHost />);
    act(() => showToast("Could not save", { variant: "danger" }));
    expect(document.querySelector('[role="alert"]')?.textContent).toBe(
      "Could not save"
    );
  });
});

describe("Tooltip", () => {
  it("preserves a trigger's existing accessible description", () => {
    vi.useFakeTimers();
    mount(
      <Tooltip label="Helpful label">
        <button type="button" aria-describedby="existing-help">
          Hover me
        </button>
      </Tooltip>
    );
    const button = host!.querySelector("button")!;
    expect(button.getAttribute("aria-describedby")).toBe("existing-help");

    act(() => {
      button.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
      vi.advanceTimersByTime(200);
    });
    expect(button.getAttribute("aria-describedby")?.split(" ")).toContain(
      "existing-help"
    );
    expect(button.getAttribute("aria-describedby")?.split(" ")).toHaveLength(2);

    act(() => button.dispatchEvent(new FocusEvent("focusout", { bubbles: true })));
    expect(button.getAttribute("aria-describedby")).toBe("existing-help");
  });
});
