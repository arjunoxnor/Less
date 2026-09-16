"use client";

import { useEffect, useState } from "react";
import type { CloudUser as User } from "@/lib/cloud/client";
import type { Prefs } from "@/lib/storage/localStore";
import {
  getProjectMeta,
  restoreEvictedBody,
  type ProjectStatus,
  type ProjectType,
  usesPlainSchema,
} from "@/lib/storage/projects";
import { fetchScript } from "@/lib/cloud/scripts";
import { ScreenplayBody } from "./ScreenplayBody";
import { PlainBody } from "./PlainBody";
import type { DuetAccess } from "./ScreenplayBody";
import type { SaveDuetCopy } from "@/lib/collab/duetCopy";

/**
 * Picks the editor body by project type. Mounted by AppShell with key={id} so
 * each open is a fresh editor + sync hook (the hook never swaps documents under
 * a live editor).
 *
 * If this project's local body was evicted to free storage, the cloud copy is
 * fetched and written back BEFORE the editor mounts, so the editor never opens
 * on an empty placeholder (which a keystroke could then push over the cloud).
 */
export function EditorHost({
  type,
  onImportAsNew,
  onSaveDuetCopy,
  ...rest
}: {
  projectId: string;
  type: ProjectType;
  title: string;
  onRename: (title: string) => void;
  status: ProjectStatus;
  onStatusChange: (status: ProjectStatus) => void;
  onBack: () => void;
  prefs: Prefs;
  onPrefsChange: (next: Partial<Prefs>) => void;
  user: User | null;
  /** The top bar's sync indicator carries the expired-session state (2B.1). */
  sessionExpired?: boolean;
  /** Screenplay-only: "Add as a new project" in the editor's import choice. */
  onImportAsNew?: (file: File) => Promise<{ imported: number; failed: string[] }>;
  /** Save-and-switch to a sibling project (the Docs panel's jump). */
  onOpenProject?: (id: string) => void;
  /** Focus and select the title on mount (instant-create flow, 2C). */
  autoFocusTitle?: boolean;
  /** Screenplay-only link collaboration. Guests have no local project row. */
  duet?: DuetAccess;
  /** Duet stage 3: file a guest's snapshot of the room as their own project. */
  onSaveDuetCopy?: SaveDuetCopy;
}) {
  const { projectId, onBack } = rest;
  const [hydration, setHydration] = useState<"checking" | "ready" | "failed">(() =>
    getProjectMeta(projectId)?.bodyEvicted ? "checking" : "ready"
  );

  useEffect(() => {
    if (hydration !== "checking") return;
    let cancelled = false;
    (async () => {
      try {
        const row = await fetchScript(projectId);
        if (cancelled) return;
        if (row && restoreEvictedBody(projectId, row.content, row.title_page ?? null, row.updated_at)) {
          setHydration("ready");
        } else {
          setHydration("failed");
        }
      } catch {
        if (!cancelled) setHydration("failed");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [hydration, projectId]);

  if (hydration === "checking") {
    return (
      <div className="host-hydrate">
        <p>Loading this script from your account…</p>
      </div>
    );
  }
  if (hydration === "failed") {
    return (
      <div className="host-hydrate">
        <p>
          This script&apos;s local copy was freed to save space, and it could not be
          loaded from the cloud just now. Check your connection and sign-in, then
          try again.
        </p>
        <div className="host-hydrate-row">
          <button type="button" className="tb-btn" onClick={() => setHydration("checking")}>
            Try again
          </button>
          <button type="button" className="tb-btn" onClick={onBack}>
            Back to projects
          </button>
        </div>
      </div>
    );
  }

  // Voice notes use the plain editor, but must keep their own type so every
  // save re-asserts it to the cloud.
  return usesPlainSchema(type) ? (
    <PlainBody {...rest} type={type} />
  ) : (
    <ScreenplayBody
      {...rest}
      onImportAsNew={onImportAsNew}
      onSaveDuetCopy={onSaveDuetCopy}
    />
  );
}
