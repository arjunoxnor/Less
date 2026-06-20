"use client";

import type { User } from "@supabase/supabase-js";
import type { Prefs } from "@/lib/storage/localStore";
import type { ProjectStatus, ProjectType } from "@/lib/storage/projects";
import { ScreenplayBody } from "./ScreenplayBody";
import { PlainBody } from "./PlainBody";

/**
 * Picks the editor body by project type. Mounted by AppShell with key={id} so
 * each open is a fresh editor + sync hook (the hook never swaps documents under
 * a live editor).
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
  return type === "plain" ? <PlainBody {...rest} /> : <ScreenplayBody {...rest} />;
}
