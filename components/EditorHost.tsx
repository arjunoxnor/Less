"use client";

import { useEffect, useState } from "react";
import type { CloudUser as User } from "@/lib/cloud/client";
import type { Prefs } from "@/lib/storage/localStore";
import {
  getProjectMeta,
  restoreEvictedBody,
  type ProjectStatus,
  type ProjectType,
} from "@/lib/storage/projects";
import { fetchScript } from "@/lib/cloud/scripts";
import { ScreenplayBody } from "./ScreenplayBody";
import { PlainBody } from "./PlainBody";

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

  return type === "plain" ? <PlainBody {...rest} /> : <ScreenplayBody {...rest} />;
}
