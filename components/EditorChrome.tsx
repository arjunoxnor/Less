"use client";

import { useEffect, useState, type ReactNode } from "react";
import type { CloudUser as User } from "@/lib/cloud/client";
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
  { value: "not_started", label: "Idea" },
  { value: "writing", label: "In progress" },
  { value: "done", label: "Completed" },
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
  fontValue,
  fontOptions,
  onFontChange,
  fontSizeValue,
  fontSizeOptions,
  onFontSizeChange,
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
  fontValue: string;
  fontOptions: { value: string; label: string }[];
  onFontChange: (value: string) => void;
  /** Optional font-size control (plain docs only; screenplays are fixed). */
  fontSizeValue?: number;
  fontSizeOptions?: number[];
  onFontSizeChange?: (value: number) => void;
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
            value={fontValue}
            onChange={(e) => onFontChange(e.target.value)}
            title="Font"
          >
            {fontOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          {fontSizeOptions && onFontSizeChange && (
            <select
              className="tb-select tb-select-size"
              value={fontSizeValue}
              onChange={(e) => onFontSizeChange(Number(e.target.value))}
              title="Font size"
            >
              {fontSizeOptions.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          )}
          <button
            type="button"
            className="tb-btn"
            onClick={() =>
              onPrefsChange({
                theme:
                  prefs.theme === "light" ? "dark" : prefs.theme === "dark" ? "system" : "light",
              })
            }
            title="Theme: light, dark, or system. Click to cycle."
          >
            {prefs.theme === "system" ? "System" : prefs.theme === "dark" ? "Dark" : "Light"}
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
