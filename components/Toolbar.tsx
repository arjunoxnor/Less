"use client";

import type { Editor } from "@tiptap/react";
import type { User } from "@supabase/supabase-js";
import {
  ELEMENT_CYCLE,
  ELEMENT_LABELS,
  ELEMENT_NUMBER,
  type ElementType,
} from "@/lib/editor/elements";
import type { Prefs } from "@/lib/storage/localStore";
import type { SyncStatus } from "@/lib/storage/useCloudSync";
import { modKeyLabel } from "@/lib/platform";

const SYNC_LABEL: Record<SyncStatus, string> = {
  local: "Local",
  syncing: "Saving…",
  synced: "Synced",
  offline: "Offline",
  error: "Sync error",
};

/**
 * The top toolbar: element-type buttons (with their Cmd/Ctrl+number hints),
 * the font toggle, dark mode, and the focus-mode toggle.
 *
 * The element buttons both *show* the current element (highlighted) and let a
 * mouse user do everything the keyboard shortcuts do.
 */
export function Toolbar({
  editor,
  currentElement,
  prefs,
  onPrefsChange,
  mod,
  cloudConfigured,
  user,
  syncStatus,
  onSignInClick,
  onSignOutClick,
  onHistoryClick,
}: {
  editor: Editor | null;
  currentElement: ElementType;
  prefs: Prefs;
  onPrefsChange: (next: Partial<Prefs>) => void;
  mod: string;
  cloudConfigured: boolean;
  user: User | null;
  syncStatus: SyncStatus;
  onSignInClick: () => void;
  onSignOutClick: () => void;
  onHistoryClick: () => void;
}) {
  const setElement = (type: ElementType) => {
    editor?.chain().focus().setElement(type).run();
  };

  return (
    <div className="toolbar">
      <div className="toolbar-brand" title="Last Ever Screenwriting Software">
        LESS
      </div>

      <div className="toolbar-group toolbar-elements">
        {ELEMENT_CYCLE.map((type) => (
          <button
            key={type}
            type="button"
            className={
              "tb-btn" + (currentElement === type ? " tb-btn-active" : "")
            }
            onClick={() => setElement(type)}
            title={`${ELEMENT_LABELS[type]}  (${mod}+${ELEMENT_NUMBER[type]})`}
          >
            {ELEMENT_LABELS[type]}
            <span className="tb-key">{ELEMENT_NUMBER[type]}</span>
          </button>
        ))}
      </div>

      <div className="toolbar-spacer" />

      <div className="toolbar-group">
        <select
          className="tb-select"
          value={prefs.font}
          onChange={(e) =>
            onPrefsChange({ font: e.target.value as Prefs["font"] })
          }
          title="Font"
        >
          <option value="courier-prime">Courier Prime</option>
          <option value="courier">Courier</option>
        </select>

        <button
          type="button"
          className="tb-btn"
          onClick={() =>
            onPrefsChange({ theme: prefs.theme === "dark" ? "light" : "dark" })
          }
          title="Toggle dark mode"
        >
          {prefs.theme === "dark" ? "Light" : "Dark"}
        </button>

        <button
          type="button"
          className={"tb-btn" + (prefs.focusMode ? " tb-btn-active" : "")}
          onClick={() => onPrefsChange({ focusMode: !prefs.focusMode })}
          title="Focus mode — hide everything but the page"
        >
          Focus
        </button>
      </div>

      {cloudConfigured && (
        <div className="toolbar-group toolbar-account">
          {user ? (
            <>
              <span
                className={"sync-dot sync-" + syncStatus}
                title={SYNC_LABEL[syncStatus]}
              />
              <span className="sync-label">{SYNC_LABEL[syncStatus]}</span>
              <button
                type="button"
                className="tb-btn"
                onClick={onHistoryClick}
                title="Version history"
              >
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
    </div>
  );
}

/** Convenience used by the page to show the right modifier symbol. */
export function useModLabel() {
  return modKeyLabel();
}
