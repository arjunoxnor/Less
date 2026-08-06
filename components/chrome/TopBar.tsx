"use client";

import { useEffect, useRef, useState } from "react";
import type { CloudUser as User } from "@/lib/cloud/client";
import type { SyncStatus } from "@/lib/storage/useCloudSync";
import { Menu, type MenuItem } from "../ui/Menu";
import { ChevronLeftIcon, DotsIcon, SidebarIcon } from "./icons";
import type { ThemeChoice } from "@/lib/storage/localStore";
import {
  MAX_LIBRARY_NAME_LENGTH,
  normalizeLibraryName,
} from "@/lib/storage/library";
import { ThemeToggle } from "./ThemeToggle";
import type { DuetConnectionStatus, DuetParticipant } from "@/lib/collab/duet";

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

const DUET_WORD: Record<DuetConnectionStatus, string> = {
  connected: "Connected",
  reconnecting: "Reconnecting",
  offline: "Offline",
};

export function TopBar({
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
  onToggleRail,
  railOpen,
  autoFocusTitle,
}: {
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
  onToggleRail: () => void;
  railOpen: boolean;
  /** Instant-create flow (2C): focus and select the title on first open so a
   *  brand-new "Untitled screenplay" can be named by just typing. */
  autoFocusTitle?: boolean;
}) {
  const safeTitle = normalizeLibraryName(title, "Untitled");
  const [draft, setDraft] = useState(safeTitle);
  useEffect(() => setDraft(safeTitle), [safeTitle]);
  const [menu, setMenu] = useState<null | "export" | "overflow">(null);
  const exportRef = useRef<HTMLButtonElement>(null);
  const moreRef = useRef<HTMLButtonElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const cancelTitleCommit = useRef(false);

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
    if (cancelTitleCommit.current) {
      cancelTitleCommit.current = false;
      setDraft(safeTitle);
      return;
    }
    const next = normalizeLibraryName(draft, "");
    if (next && next !== safeTitle) onRename(next);
    else setDraft(safeTitle);
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
        maxLength={MAX_LIBRARY_NAME_LENGTH}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            (e.target as HTMLInputElement).blur();
          } else if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            cancelTitleCommit.current = true;
            setDraft(safeTitle);
            (e.target as HTMLInputElement).blur();
          }
        }}
        aria-label="Project title"
      />

      {collaborationStatus ? (
        <span
          className="topbar-sync"
          title="Duet collaboration is active. Account cloud sync is off while this script is shared."
        >
          <span className={"sync-dot sync-" + collaborationStatus} aria-hidden="true" />
          {DUET_WORD[collaborationStatus]}
        </span>
      ) : cloudConfigured &&
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

      {participants && participants.length > 0 && (
        <div className="duet-presence" aria-label="People in this script">
          {participants.slice(0, 3).map((participant) => (
            <span className="duet-person" key={participant.clientId} title={`${participant.name} is here`}>
              <span
                className="duet-person-dot"
                style={{ backgroundColor: participant.color }}
                aria-hidden="true"
              />
              {participant.name}
            </span>
          ))}
          {participants.length > 3 && (
            <span className="duet-person" title={`${participants.length - 3} more people are here`}>
              +{participants.length - 3}
            </span>
          )}
        </div>
      )}

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

      <ThemeToggle theme={theme} onChange={onThemeChange} />

      <button
        type="button"
        className="tb-icon topbar-railtoggle"
        data-rail-toggle=""
        onClick={onToggleRail}
        aria-label="Panels"
        aria-expanded={railOpen}
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
