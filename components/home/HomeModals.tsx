"use client";

import { FOLDER_COLORS, type Folder } from "@/lib/storage/folders";
import { canMoveFolderTo, listFolderMoveTargets } from "@/lib/storage/library";
import type { ProjectMeta } from "@/lib/storage/projects";
import { Modal } from "../ui/Modal";
import { HoldDelete } from "./homeParts";

/* The home's dialogs: a folder's color, deleting a project, deleting a
   folder (its contents move up a level), and Move to, the keyboard way of
   doing what dragging does with a pointer. */

export function FolderColorModal({
  folder,
  onPick,
  onClose,
}: {
  folder: Folder;
  onPick: (color: string, close: boolean) => void;
  onClose: () => void;
}) {
  const custom = !FOLDER_COLORS.includes(folder.color);
  return (
    <Modal title="Folder color" onClose={onClose}>
      <div className="folder-swatches" role="group" aria-label="Folder color">
        {FOLDER_COLORS.map((c) => (
          <button
            key={c}
            type="button"
            className={"swatch" + (folder.color === c ? " swatch-on" : "")}
            style={{ background: c }}
            onClick={() => onPick(c, true)}
            aria-label={"Color " + c}
          />
        ))}
        <label
          className={"swatch swatch-custom" + (custom ? " swatch-on" : "")}
          style={custom ? { background: folder.color } : undefined}
          title="Custom color"
        >
          <input
            type="color"
            className="swatch-custom-input"
            value={folder.color}
            onChange={(e) => onPick(e.target.value, false)}
            aria-label="Pick a custom color"
          />
        </label>
      </div>
    </Modal>
  );
}

export function DeleteProjectModal({
  project,
  onDelete,
  onClose,
}: {
  project: ProjectMeta;
  onDelete: () => void;
  onClose: () => void;
}) {
  const word =
    project.type === "screenplay"
      ? "script"
      : project.type === "board"
        ? "board"
        : project.type === "voice"
          ? "voice note"
          : "document";
  return (
    <Modal
      title={`Delete ${word}`}
      onClose={onClose}
      actions={[
        { label: "Cancel", onClick: onClose },
        { label: "Delete", variant: "danger", onClick: onDelete },
      ]}
    >
      <p>Delete &quot;{project.title}&quot;? This cannot be undone.</p>
    </Modal>
  );
}

export function DeleteFolderModal({
  folder,
  parentName,
  onConfirm,
  onClose,
}: {
  folder: Folder;
  parentName: string | null;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Modal title="Delete folder" onClose={onClose} actions={[{ label: "Cancel", onClick: onClose }]}>
      <p>
        Delete the folder &quot;{folder.name}&quot;? Nothing inside it is deleted. Its scripts,
        documents and folders move up one level, into{" "}
        {parentName ? `"${parentName}"` : "the top level"}.
      </p>
      <div className="hold-row">
        <HoldDelete onConfirm={onConfirm} />
      </div>
    </Modal>
  );
}

export type MoveTarget = { kind: "item"; meta: ProjectMeta } | { kind: "folder"; folder: Folder };

export function MoveToModal({
  target,
  folders,
  onMove,
  onClose,
}: {
  target: MoveTarget;
  folders: Folder[];
  /** Called only for a real move: null means out of every folder. */
  onMove: (folderId: string | null) => void;
  onClose: () => void;
}) {
  const currentId =
    target.kind === "item" ? (target.meta.folderId ?? null) : (target.folder.parentId ?? null);
  const pick = (folderId: string | null) => {
    if (folderId !== currentId) onMove(folderId);
    onClose();
  };
  const choices = listFolderMoveTargets(folders).filter(
    ({ folder: f }) => target.kind === "item" || canMoveFolderTo(target.folder.id, f.id, folders)
  );
  return (
    <Modal
      title={`Move "${target.kind === "item" ? target.meta.title : target.folder.name}"`}
      onClose={onClose}
    >
      <div className="move-list">
        <button
          type="button"
          className={"move-item" + (currentId === null ? " move-current" : "")}
          aria-current={currentId === null ? "location" : undefined}
          onClick={() => pick(null)}
        >
          Not in a folder
        </button>
        {choices.map(({ folder: f, path }) => {
          const here = currentId === f.id;
          return (
            <button
              key={f.id}
              type="button"
              className={"move-item" + (here ? " move-current" : "")}
              aria-current={here ? "location" : undefined}
              onClick={() => pick(f.id)}
            >
              <span className="move-dot" style={{ background: f.color }} aria-hidden="true" />
              {f.name}
              {path && <span className="move-path">{path}</span>}
            </button>
          );
        })}
      </div>
    </Modal>
  );
}
