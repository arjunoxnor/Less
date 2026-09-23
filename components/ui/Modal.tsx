"use client";

import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { restoreFocus } from "@/lib/restoreFocus";

/**
 * The app modal (Superaudit 2, Part 2B.5). Replaces every native dialog:
 * a scrim over the page, a paper panel, and a right-aligned action row with a
 * text-styled Cancel and one solid confirm. Focus is trapped while open and
 * restored to the trigger on close; Esc closes; destructive confirms stay
 * disabled for a beat after mount so a double-click can never land on them.
 */

export type ModalAction = {
  label: string;
  onClick: () => void;
  /** "text" for Cancel-style, "solid" for the primary, "danger" destructive. */
  variant?: "text" | "solid" | "danger";
  disabled?: boolean;
};

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** How long a destructive confirm stays disabled after the modal mounts. */
const DANGER_ARM_MS = 400;

type ModalStackEntry = {
  token: symbol;
  panelRef: { current: HTMLDivElement | null };
};

const modalStack: ModalStackEntry[] = [];
let bodyOverflowBeforeModals = "";

function focusInside(panel: HTMLDivElement | null) {
  if (!panel) return;
  const field = panel.querySelector<HTMLElement>("input, textarea, select");
  const textBtn = panel.querySelector<HTMLElement>(".ui-btn-text");
  const any = panel.querySelector<HTMLElement>(FOCUSABLE);
  (field ?? textBtn ?? any ?? panel).focus();
}

function focusDocumentFallback() {
  const body = document.body;
  const hadTabIndex = body.hasAttribute("tabindex");
  if (!hadTabIndex) body.tabIndex = -1;
  body.focus();
  if (!hadTabIndex) body.removeAttribute("tabindex");
}

export function Modal({
  title,
  onClose,
  actions,
  children,
}: {
  title: string;
  onClose: () => void;
  actions?: ModalAction[];
  children?: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const tokenRef = useRef(Symbol("modal"));
  const openerRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const hasDanger = actions?.some((a) => a.variant === "danger") ?? false;
  const [armed, setArmed] = useState(!hasDanger);

  // Danger confirms arm after a beat.
  useEffect(() => {
    if (armed) return;
    const t = setTimeout(() => setArmed(true), DANGER_ARM_MS);
    return () => clearTimeout(t);
  }, [armed]);

  // One shared stack makes Escape, focus restore, and scroll locking obey the
  // visual order even when one modal closes underneath another.
  useLayoutEffect(() => {
    openerRef.current = document.activeElement as HTMLElement | null;
    const entry = { token: tokenRef.current, panelRef };
    if (modalStack.length === 0) {
      bodyOverflowBeforeModals = document.body.style.overflow;
      document.body.style.overflow = "hidden";
    }
    modalStack.push(entry);
    focusInside(panelRef.current);
    return () => {
      const index = modalStack.findIndex((candidate) => candidate.token === entry.token);
      const wasTop = index === modalStack.length - 1;
      if (index >= 0) modalStack.splice(index, 1);
      if (modalStack.length === 0) {
        document.body.style.overflow = bodyOverflowBeforeModals;
      }
      if (!wasTop) return;

      // React may still be removing the old opener during layout cleanup.
      // Restore after the commit so a detached control cannot receive focus.
      queueMicrotask(() => {
        const top = modalStack[modalStack.length - 1];
        const opener = openerRef.current;
        if (top) {
          if (opener?.isConnected && top.panelRef.current?.contains(opener)) {
            restoreFocus(opener);
          } else {
            focusInside(top.panelRef.current);
          }
        } else if (opener?.isConnected) {
          restoreFocus(opener);
        } else {
          focusDocumentFallback();
        }
      });
    };
  }, []);

  // Esc closes; Tab loops inside the panel (Shift+Tab in reverse).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (modalStack[modalStack.length - 1]?.token !== tokenRef.current) return;
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopImmediatePropagation();
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const panel = panelRef.current;
      if (!panel) return;
      const focusables = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
      e.preventDefault();
      e.stopImmediatePropagation();
      if (focusables.length === 0) {
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;
      if (e.shiftKey) {
        if (active === first || !panel.contains(active)) {
          last.focus();
        } else {
          const index = focusables.indexOf(active as HTMLElement);
          focusables[Math.max(0, index - 1)].focus();
        }
      } else {
        if (active === last || !panel.contains(active)) {
          first.focus();
        } else {
          const index = focusables.indexOf(active as HTMLElement);
          focusables[Math.min(focusables.length - 1, index + 1)].focus();
        }
      }
    };
    // Capture phase so the trap wins over editor-level key handlers.
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="ui-modal-scrim" onMouseDown={onClose}>
      <div
        ref={panelRef}
        className="ui-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 className="ui-modal-title" id={titleId}>
          {title}
        </h2>
        <div className="ui-modal-body">{children}</div>
        {actions && actions.length > 0 && (
          <div className="ui-modal-actions">
            {actions.map((a) => (
              <button
                key={a.label}
                type="button"
                className={
                  "ui-btn " +
                  (a.variant === "solid"
                    ? "ui-btn-solid"
                    : a.variant === "danger"
                      ? "ui-btn-danger"
                      : "ui-btn-text")
                }
                disabled={a.disabled || (a.variant === "danger" && !armed)}
                onClick={a.onClick}
              >
                {a.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
