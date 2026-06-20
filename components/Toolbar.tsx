"use client";

import { useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import type { User } from "@supabase/supabase-js";
import {
  ELEMENT_CYCLE,
  ELEMENT_LABELS,
  ELEMENT_NUMBER,
  type ElementType,
} from "@/lib/editor/elements";
import type { ExportFormat, ImportFormat } from "@/lib/export";
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
  onExport,
  onImport,
  onScenesClick,
  onFindClick,
  onCastClick,
  onTitlePageClick,
  onToggleDual,
  dualActive,
  scenesOpen,
  findOpen,
  castOpen,
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
  onExport: (format: ExportFormat) => void;
  onImport: (format: ImportFormat, file: File) => void;
  onScenesClick: () => void;
  onFindClick: () => void;
  onCastClick: () => void;
  onTitlePageClick: () => void;
  onToggleDual: () => void;
  dualActive: boolean;
  scenesOpen: boolean;
  findOpen: boolean;
  castOpen: boolean;
}) {
  const setElement = (type: ElementType) => {
    editor?.chain().focus().setElement(type).run();
  };

  // Which dropdown (if any) is open. Click-outside and Escape close it.
  const [openMenu, setOpenMenu] = useState<null | "export" | "import">(null);
  const fountainInputRef = useRef<HTMLInputElement>(null);
  const fdxInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!openMenu) return;
    const onDown = (e: MouseEvent) => {
      if (!(e.target as HTMLElement)?.closest(".tb-menu")) setOpenMenu(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenMenu(null);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [openMenu]);

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
        <button
          type="button"
          className={"tb-btn" + (dualActive ? " tb-btn-active" : "")}
          onClick={onToggleDual}
          title={`Dual dialogue  (${mod}+D)`}
        >
          Dual
        </button>
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
          title="Focus mode, hide everything but the page"
        >
          Focus
        </button>
      </div>

      <div className="toolbar-group">
        <div className="tb-menu">
          <button
            type="button"
            className={"tb-btn" + (openMenu === "export" ? " tb-btn-active" : "")}
            onClick={() =>
              setOpenMenu((m) => (m === "export" ? null : "export"))
            }
            title="Export your script"
          >
            Export
          </button>
          {openMenu === "export" && (
            <div className="tb-menu-list">
              <button
                type="button"
                className="tb-menu-item"
                title="Export to PDF"
                onClick={() => {
                  onExport("pdf");
                  setOpenMenu(null);
                }}
              >
                PDF
              </button>
              <button
                type="button"
                className="tb-menu-item"
                title="Export to Fountain"
                onClick={() => {
                  onExport("fountain");
                  setOpenMenu(null);
                }}
              >
                Fountain
              </button>
            </div>
          )}
        </div>

        <div className="tb-menu">
          <button
            type="button"
            className={"tb-btn" + (openMenu === "import" ? " tb-btn-active" : "")}
            onClick={() =>
              setOpenMenu((m) => (m === "import" ? null : "import"))
            }
            title="Import a script"
          >
            Import
          </button>
          {openMenu === "import" && (
            <div className="tb-menu-list">
              <button
                type="button"
                className="tb-menu-item"
                title="Import a Fountain file"
                onClick={() => {
                  fountainInputRef.current?.click();
                  setOpenMenu(null);
                }}
              >
                Fountain
              </button>
              <button
                type="button"
                className="tb-menu-item"
                title="Import a Final Draft file"
                onClick={() => {
                  fdxInputRef.current?.click();
                  setOpenMenu(null);
                }}
              >
                FDX
              </button>
            </div>
          )}
        </div>

        <input
          ref={fountainInputRef}
          type="file"
          accept=".fountain,.txt,.spmd"
          className="tb-file-input"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onImport("fountain", f);
            e.target.value = "";
          }}
        />
        <input
          ref={fdxInputRef}
          type="file"
          accept=".fdx,.xml"
          className="tb-file-input"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onImport("fdx", f);
            e.target.value = "";
          }}
        />
      </div>

      <div className="toolbar-group">
        <button
          type="button"
          className={"tb-btn" + (scenesOpen ? " tb-btn-active" : "")}
          onClick={onScenesClick}
          title="Scene navigator"
        >
          Scenes
        </button>
        <button
          type="button"
          className={"tb-btn" + (findOpen ? " tb-btn-active" : "")}
          onClick={onFindClick}
          title="Find and replace"
        >
          Find
        </button>
        <button
          type="button"
          className={"tb-btn" + (castOpen ? " tb-btn-active" : "")}
          onClick={onCastClick}
          title="Cast list"
        >
          Cast
        </button>
        <button
          type="button"
          className="tb-btn"
          onClick={onTitlePageClick}
          title="Edit the title page"
        >
          Title Page
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
