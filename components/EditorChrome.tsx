"use client";

import { useEffect, useState, type ReactNode } from "react";
import type { User } from "@supabase/supabase-js";
import type { Prefs } from "@/lib/storage/localStore";
import type { SyncStatus } from "@/lib/storage/useCloudSync";
import type { ProjectStatus } from "@/lib/storage/projects";

const SYNC_LABEL: Record<SyncStatus, string> = {
  local: "Local",
  syncing: "Saving…",
  synced: "Synced",
  offline: "Offline",
  error: "Sync error",
};

const STATUS_SEG: { value: ProjectStatus; label: string }[] = [
  { value: "not_started", label: "Not started" },
  { value: "writing", label: "Writing" },
  { value: "done", label: "Done" },
];

/**
 * The shared top chrome for an open project, composed by both the screenplay and
 * plain bodies. Row one is the project bar (back, title, status, account, prefs);
 * row two is the type-specific toolbar passed as children.
 */
export function EditorChrome({
  onBack,
  title,
  onRename,
  status,
  onStatusChange,
  prefs,
  onPrefsChange,
  cloudConfigured,
  user,
  syncStatus,
  onSignInClick,
  onSignOutClick,
  onHistoryClick,
  children,
}: {
  onBack: () => void;
  title: string;
  onRename: (title: string) => void;
  status: ProjectStatus;
  onStatusChange: (status: ProjectStatus) => void;
  prefs: Prefs;
  onPrefsChange: (next: Partial<Prefs>) => void;
  cloudConfigured: boolean;
  user: User | null;
  syncStatus: SyncStatus;
  onSignInClick: () => void;
  onSignOutClick: () => void;
  onHistoryClick: () => void;
  children?: ReactNode;
}) {
  const [draft, setDraft] = useState(title);
  useEffect(() => setDraft(title), [title]);

  const commit = () => {
    const next = draft.trim();
    if (next && next !== title) onRename(next);
    else setDraft(title);
  };

  return (
    <>
      <div className="chrome-bar">
        <button type="button" className="tb-btn chrome-back" onClick={onBack} title="Back to projects">
          Projects
        </button>

        <input
          className="chrome-title"
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

        <div className="status-seg" role="group" aria-label="Project status">
          {STATUS_SEG.map((s) => (
            <button
              key={s.value}
              type="button"
              className={"seg" + (status === s.value ? " seg-active" : "")}
              onClick={() => onStatusChange(s.value)}
            >
              {s.label}
            </button>
          ))}
        </div>

        <div className="toolbar-spacer" />

        {cloudConfigured && (
          <div className="toolbar-group toolbar-account">
            {user ? (
              <>
                <span className={"sync-dot sync-" + syncStatus} title={SYNC_LABEL[syncStatus]} />
                <span className="sync-label">{SYNC_LABEL[syncStatus]}</span>
                <button type="button" className="tb-btn" onClick={onHistoryClick} title="Version history">
                  History
                </button>
                <span className="account-email" title={user.email ?? ""}>
                  {user.email}
                </span>
                <button type="button" className="tb-btn" onClick={onSignOutClick}>
                  Sign out
                </button>
              </>
            ) : (
              <button
                type="button"
                className="tb-btn tb-btn-active"
                onClick={onSignInClick}
                title="Save your work to the cloud"
              >
                Sign in to save
              </button>
            )}
          </div>
        )}

        <div className="toolbar-group">
          <select
            className="tb-select"
            value={prefs.font}
            onChange={(e) => onPrefsChange({ font: e.target.value as Prefs["font"] })}
            title="Font"
          >
            <option value="courier-prime">Courier Prime</option>
            <option value="courier">Courier</option>
          </select>
          <button
            type="button"
            className="tb-btn"
            onClick={() => onPrefsChange({ theme: prefs.theme === "dark" ? "light" : "dark" })}
            title="Toggle dark mode"
          >
            {prefs.theme === "dark" ? "Light" : "Dark"}
          </button>
          <button
            type="button"
            className={"tb-btn" + (prefs.focusMode ? " tb-btn-active" : "")}
            onClick={() => onPrefsChange({ focusMode: !prefs.focusMode })}
            title="Focus mode, hide everything but the page"
          >
            Focus
          </button>
        </div>
      </div>

      <div className="toolbar">{children}</div>
    </>
  );
}
