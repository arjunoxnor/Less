"use client";

import { useState } from "react";
import { MAX_LIBRARY_NAME_LENGTH, normalizeLibraryName } from "@/lib/storage/library";
import type { DuetCopyPlan } from "@/lib/collab/duetCopy";
import { Modal } from "./ui/Modal";

/**
 * Duet stage 3: the guest's "keep this" step. It names the copy, says plainly
 * that the copy is a snapshot, and says where the writer lands afterwards.
 */
export function DuetSaveCopyModal({
  plan,
  saving,
  onSave,
  onClose,
}: {
  plan: DuetCopyPlan;
  saving: boolean;
  onSave: (title: string) => void;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(plan.title);
  const clean = normalizeLibraryName(title, "");

  return (
    <Modal
      title="Save a copy to your library"
      onClose={onClose}
      actions={[
        { label: "Cancel", variant: "text", disabled: saving, onClick: onClose },
        {
          label: saving ? "Saving…" : "Save copy",
          variant: "solid",
          disabled: saving || !clean,
          onClick: () => onSave(clean),
        },
      ]}
    >
      {plan.previous && (
        <p className="ui-modal-note">
          You have already saved this shared script as {plan.previous.title}. Saving
          again makes a second, separate copy.
        </p>
      )}
      <label className="field">
        <span>Name this copy</span>
        <input
          value={title}
          maxLength={MAX_LIBRARY_NAME_LENGTH}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Untitled"
        />
      </label>
      <p>
        This saves the text as it is right now. Your copy will not follow later
        changes to the shared script, and your edits to it will not go back to the
        people writing there.
      </p>
      <p>
        Saving opens your copy, so you leave the shared session. The link still
        works if you want to go back to it.
      </p>
    </Modal>
  );
}
