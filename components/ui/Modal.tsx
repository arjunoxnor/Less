"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

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
  const titleId = useId();
  const hasDanger = actions?.some((a) => a.variant === "danger") ?? false;
  const [armed, setArmed] = useState(!hasDanger);

  // Danger confirms arm after a beat.
  useEffect(() => {
    if (armed) return;
    const t = setTimeout(() => setArmed(true), DANGER_ARM_MS);
    return () => clearTimeout(t);
  }, [armed]);

  // Lock the page scroller while the modal is open so wheel and touch over
  // the scrim cannot scroll the content behind it. The previous inline value
  // is saved and restored so nested modals unwind cleanly.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  // Initial focus (first field, else the least-destructive button) and focus
  // restore to whatever was focused when the modal opened.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    if (panel) {
      const field = panel.querySelector<HTMLElement>(
        "input, textarea, select"
      );
      const textBtn = panel.querySelector<HTMLElement>(".ui-btn-text");
      const any = panel.querySelector<HTMLElement>(FOCUSABLE);
      (field ?? textBtn ?? any ?? panel).focus();
    }
    return () => {
      opener?.focus?.();
    };
  }, []);

  // Esc closes; Tab loops inside the panel (Shift+Tab in reverse).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const panel = panelRef.current;
      if (!panel) return;
      const focusables = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (focusables.length === 0) {
        e.preventDefault();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;
      if (e.shiftKey) {
        if (active === first || !panel.contains(active)) {
          e.preventDefault();
          last.focus();
        }
      } else if (active === last || !panel.contains(active)) {
        e.preventDefault();
        first.focus();
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
