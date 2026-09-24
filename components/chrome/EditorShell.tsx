"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { CloudUser as User } from "@/lib/cloud/client";
import type { SyncStatus } from "@/lib/storage/useCloudSync";
import type { MenuItem } from "../ui/Menu";
import { showToast } from "../ui/Toast";
import { TopBar } from "./TopBar";
import { LeftRail, type PanelId, type RailItem } from "./LeftRail";
import type { ThemeChoice } from "@/lib/storage/localStore";
import type { DuetConnectionStatus, DuetParticipant } from "@/lib/collab/duet";

export type { PanelId, RailItem };

/**
 * The editor shell (Superaudit 2, 2B): one top bar, the right icon rail, the
 * single right dock, and the status bar, arranged around the page column. Both
 * editor bodies (screenplay and plain) mount their page inside it. The shell
 * owns the chrome-level interaction rules:
 *
 *  - ONE Escape handler with the 2F ordering: close the dock first, then
 *    leave focus mode. (The old competing listeners are gone.)
 *  - Focus mode (2F): all chrome regions hide, the desk dims, a toast shows
 *    once per session, and the top bar peeks back in when the pointer touches
 *    the top 8px of the screen, hiding again on typing or pointer-leave.
 *  - The rail collapses below 900px into the top bar's rail toggle.
 *  - The dock is a grid column at >=1280px (the page recenters) and an
 *    overlay with a scrim below that.
 */

// One "Focus. Esc to leave." toast per browser session, across all projects.
let focusToastShown = false;

export function EditorShell({
  rootClassName,
  focusMode,
  onExitFocus,
  onEnterFocus,
  title,
  onRename,
  onBack,
  cloudConfigured,
  user,
  syncStatus,
  collaborationStatus,
  participants,
  sessionExpired,
  onSignIn,
  modLabel,
  onOpenPalette,
  exportItems,
  overflowItems,
  theme,
  onThemeChange,
  railItems,
  activePanel,
  onPanelChange,
  dockPanel,
  secondRow,
  statusBar,
  autoFocusTitle,
  viewSwitch,
  children,
}: {
  /** Extra classes for the shell root (font choice, scene numbers, etc). */
  rootClassName?: string;
  focusMode: boolean;
  onExitFocus: () => void;
  onEnterFocus: () => void;
  title: string;
  onRename: (title: string) => void;
  onBack: () => void;
  cloudConfigured: boolean;
  user: User | null;
  syncStatus: SyncStatus;
  collaborationStatus?: DuetConnectionStatus;
  participants?: DuetParticipant[];
  sessionExpired: boolean;
  onSignIn: () => void;
  modLabel: string;
  onOpenPalette?: () => void;
  exportItems: MenuItem[];
  overflowItems: MenuItem[];
  theme: ThemeChoice;
  onThemeChange: (theme: ThemeChoice) => void;
  railItems: RailItem[];
  activePanel: PanelId | null;
  onPanelChange: (panel: PanelId | null) => void;
  /** The active panel's content, mounted inside the dock. */
  dockPanel?: ReactNode;
  /** Optional slim second row under the top bar (plain formatting controls). */
  secondRow?: ReactNode;
  statusBar?: ReactNode;
  /** Focus and select the title input on mount (instant-create flow, 2C). */
  autoFocusTitle?: boolean;
  /** A way to switch what the page column shows (Script / Board). */
  viewSwitch?: ReactNode;
  children: ReactNode;
}) {
  const [railOpen, setRailOpen] = useState(false);
  const [peek, setPeek] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const topRef = useRef<HTMLDivElement>(null);
  const previousPanel = useRef<PanelId | null>(activePanel);

  // The single ordered Escape handler (2B.3 / 2F): dock closes before focus
  // mode exits. Menus, modals, and the palette stop propagation themselves,
  // so an Esc that dismissed one of those never reaches this.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (railOpen) {
        setRailOpen(false);
        return;
      }
      if (activePanel) {
        onPanelChange(null);
        return;
      }
      if (focusMode) onExitFocus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activePanel, focusMode, onPanelChange, onExitFocus, railOpen]);

  // Focus-mode entry side effects: close the dock (2F hides it anyway, and a
  // leftover panel would silently eat the first Esc) and the once-per-session
  // toast. onPanelChange is a state setter in both bodies, so its identity is
  // stable and this runs only on the focusMode flip.
  useEffect(() => {
    if (focusMode) {
      setRailOpen(false);
      onPanelChange(null);
      if (!focusToastShown) {
        focusToastShown = true;
        showToast("Focus. Esc to leave.");
      }
    }
    if (!focusMode) setPeek(false);
  }, [focusMode, onPanelChange]);

  // A dock close button or Escape removes the focused panel contents. Put
  // focus back on the control that opened that panel instead of losing it to
  // the document body.
  useEffect(() => {
    const previous = previousPanel.current;
    previousPanel.current = activePanel;
    if (!previous || activePanel || focusMode) return;
    const timer = setTimeout(() => {
      const compact =
        typeof window.matchMedia === "function" &&
        window.matchMedia("(max-width: 899px)").matches;
      const selector = compact
        ? "[data-rail-toggle]"
        : `[data-panel-id="${previous}"]`;
      rootRef.current?.querySelector<HTMLElement>(selector)?.focus();
    }, 0);
    return () => clearTimeout(timer);
  }, [activePanel, focusMode]);

  // Focus-mode top-bar reveal: pointer into the top 8px shows the bar; typing
  // hides it again. Leaving the bar itself also hides it (onMouseLeave below).
  useEffect(() => {
    if (!focusMode) return;
    let last = 0;
    const onMove = (e: MouseEvent) => {
      const now = Date.now();
      if (now - last < 100) return;
      last = now;
      if (e.clientY <= 8) setPeek(true);
    };
    const onType = (e: KeyboardEvent) => {
      if (e.key.length === 1 || e.key === "Enter" || e.key === "Backspace") {
        setPeek(false);
      }
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("keydown", onType);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("keydown", onType);
    };
  }, [focusMode]);

  return (
    <div
      ref={rootRef}
      className={
        "editor-shell" +
        (rootClassName ? " " + rootClassName : "") +
        (focusMode ? " focus-mode" : "") +
        (peek ? " topbar-peek" : "") +
        (railOpen ? " rail-open" : "")
      }
    >
      <div
        ref={topRef}
        className="editor-topbar-slot"
        onMouseLeave={() => {
          if (focusMode) setPeek(false);
        }}
      >
        <TopBar
          title={title}
          onRename={onRename}
          onBack={onBack}
          cloudConfigured={cloudConfigured}
          user={user}
          syncStatus={syncStatus}
          collaborationStatus={collaborationStatus}
          participants={participants}
          sessionExpired={sessionExpired}
          onSignIn={onSignIn}
          modLabel={modLabel}
          onOpenPalette={onOpenPalette}
          exportItems={exportItems}
          overflowItems={overflowItems}
          theme={theme}
          onThemeChange={onThemeChange}
          onToggleRail={() => setRailOpen((v) => !v)}
          railOpen={railOpen}
          autoFocusTitle={autoFocusTitle}
          viewSwitch={viewSwitch}
        />
      </div>

      {secondRow && <div className="editor-secondrow">{secondRow}</div>}

      <div className={"editor-body" + (activePanel ? " dock-open" : "")}>
        <div className="editor-page-col">{children}</div>

        <LeftRail
          items={railItems}
          activePanel={activePanel}
          onPanelChange={(p) => {
            onPanelChange(p);
            setRailOpen(false);
          }}
          onEnterFocus={onEnterFocus}
        />

        {activePanel && (
          <div
            className="dock-scrim"
            onClick={() => onPanelChange(null)}
            aria-hidden="true"
          />
        )}
        <aside className="editor-dock" aria-label="Panel">
          {activePanel && (
            <div className="dock-inner" key={activePanel}>
              {dockPanel}
            </div>
          )}
        </aside>
      </div>

      {statusBar}
    </div>
  );
}
