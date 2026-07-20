"use client";

import { useEffect, useRef, useState } from "react";
import type { CloudUser as User } from "@/lib/cloud/client";
import type { SyncStatus } from "@/lib/storage/useCloudSync";
import { Menu, type MenuItem } from "../ui/Menu";
import { ChevronLeftIcon, DotsIcon, SidebarIcon } from "./icons";

/**
 * The single 48px top bar (Superaudit 2, 2B.1): back chevron, borderless
 * inline title, quiet sync indicator, spacer, palette hint chip, the one
 * solid-ink Export button, a rail toggle on small screens, and the overflow
 * menu. No email address in the bar, ever; the account row lives in the
 * overflow.
 */

const SYNC_WORD: Record<SyncStatus, string> = {
  local: "Local",
  syncing: "Saving",
  synced: "Saved",
  offline: "Offline",
  error: "Error",
};

export function TopBar({
  title,
  onRename,
  onBack,
  cloudConfigured,
  user,
  syncStatus,
  sessionExpired,
  onSignIn,
  modLabel,
  onOpenPalette,
  exportItems,
  overflowItems,
  onToggleRail,
  autoFocusTitle,
}: {
  title: string;
  onRename: (title: string) => void;
  onBack: () => void;
  cloudConfigured: boolean;
  user: User | null;
  syncStatus: SyncStatus;
  sessionExpired: boolean;
  onSignIn: () => void;
  modLabel: string;
  onOpenPalette?: () => void;
  exportItems: MenuItem[];
  overflowItems: MenuItem[];
  onToggleRail: () => void;
  /** Instant-create flow (2C): focus and select the title on first open so a
   *  brand-new "Untitled screenplay" can be named by just typing. */
  autoFocusTitle?: boolean;
}) {
  const [draft, setDraft] = useState(title);
  useEffect(() => setDraft(title), [title]);
  const [menu, setMenu] = useState<null | "export" | "overflow">(null);
  const exportRef = useRef<HTMLButtonElement>(null);
  const moreRef = useRef<HTMLButtonElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);

  // Consume the hint once, on mount only; later prop flips must not re-focus.
  const focusOnce = useRef(autoFocusTitle);
  useEffect(() => {
    if (focusOnce.current) {
      focusOnce.current = false;
      titleRef.current?.focus();
      titleRef.current?.select();
    }
  }, []);

  const commit = () => {
    const next = draft.trim();
    if (next && next !== title) onRename(next);
    else setDraft(title);
  };

  return (
    <div className="editor-topbar">
      <button
        type="button"
        className="tb-icon"
        onClick={onBack}
        aria-label="Back to projects"
        title="Back to projects"
      >
        <ChevronLeftIcon />
      </button>

      <input
        ref={titleRef}
        className="topbar-title"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            (e.target as HTMLInputElement).blur();
          }
        }}
        aria-label="Project title"
      />

      {cloudConfigured &&
        (sessionExpired ? (
          <button type="button" className="topbar-sync-btn" onClick={onSignIn}>
            Session expired: sign in
          </button>
        ) : user ? (
          <span className="topbar-sync" title="Cloud sync">
            <span className={"sync-dot sync-" + syncStatus} aria-hidden="true" />
            {SYNC_WORD[syncStatus]}
          </span>
        ) : (
          <button
            type="button"
            className="topbar-sync-btn"
            onClick={onSignIn}
            title="Save your work to the cloud"
          >
            Sign in to back up
          </button>
        ))}

      <div className="toolbar-spacer" />

      {onOpenPalette && (
        <button
          type="button"
          className="topbar-kbd"
          onClick={onOpenPalette}
          title="Command palette"
          aria-label="Command palette"
        >
          {modLabel}K
        </button>
      )}

      <button
        type="button"
        ref={exportRef}
        className="ui-btn ui-btn-solid topbar-export"
        onClick={() => setMenu((m) => (m === "export" ? null : "export"))}
        aria-haspopup="menu"
        aria-expanded={menu === "export"}
      >
        Export
      </button>
      {menu === "export" && exportRef.current && (
        <Menu
          anchor={exportRef.current.getBoundingClientRect()}
          items={exportItems}
          onClose={() => setMenu(null)}
          ariaLabel="Export"
        />
      )}

      <button
        type="button"
        className="tb-icon topbar-railtoggle"
        onClick={onToggleRail}
        aria-label="Panels"
        title="Panels"
      >
        <SidebarIcon />
      </button>

      <button
        type="button"
        ref={moreRef}
        className="tb-icon"
        onClick={() => setMenu((m) => (m === "overflow" ? null : "overflow"))}
        aria-haspopup="menu"
        aria-expanded={menu === "overflow"}
        aria-label="More"
        title="More"
      >
        <DotsIcon />
      </button>
      {menu === "overflow" && moreRef.current && (
        <Menu
          anchor={moreRef.current.getBoundingClientRect()}
          items={overflowItems}
          onClose={() => setMenu(null)}
          ariaLabel="More"
        />
      )}
    </div>
  );
}
