"use client";

import { useState } from "react";
import { shareLink, type DuetShareRecord } from "@/lib/collab/duet";
import { Modal } from "./ui/Modal";
import { showToast } from "./ui/Toast";

async function copyText(value: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const input = document.createElement("textarea");
  input.value = value;
  input.style.position = "fixed";
  input.style.opacity = "0";
  document.body.appendChild(input);
  input.select();
  const copied = document.execCommand("copy");
  input.remove();
  if (!copied) throw new Error("Copy failed");
}

export function DuetShareModal({
  record,
  owner,
  displayName,
  onDisplayNameChange,
  onStop,
  onClose,
}: {
  record: DuetShareRecord;
  owner: boolean;
  displayName: string;
  onDisplayNameChange: (name: string) => void;
  onStop: () => Promise<void>;
  onClose: () => void;
}) {
  const [stopping, setStopping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const link = shareLink(record.token);

  const stop = async () => {
    setStopping(true);
    setError(null);
    try {
      await onStop();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Sharing could not be stopped.");
      setStopping(false);
    }
  };

  return (
    <Modal
      title="Share this script"
      onClose={onClose}
      actions={[
        ...(owner
          ? [
              {
                label: stopping ? "Stopping…" : "Stop sharing",
                variant: "danger" as const,
                disabled: stopping,
                onClick: () => void stop(),
              },
            ]
          : []),
        { label: "Done", variant: "solid", disabled: stopping, onClick: onClose },
      ]}
    >
      <div className="duet-link-row">
        <input value={link} readOnly aria-label="Sharing link" onFocus={(event) => event.currentTarget.select()} />
        <button
          type="button"
          className="ui-btn ui-btn-solid"
          onClick={() => {
            void copyText(link)
              .then(() => showToast("Sharing link copied."))
              .catch(() => showToast("Could not copy the link.", { variant: "danger" }));
          }}
        >
          Copy
        </button>
      </div>
      <p>Anyone with this link can edit this script</p>
      <label className="field duet-name-field">
        <span>Your name here</span>
        <input
          value={displayName}
          maxLength={50}
          onChange={(event) => onDisplayNameChange(event.target.value)}
          placeholder="Name"
        />
      </label>
      {error && <p className="modal-error">{error}</p>}
    </Modal>
  );
}
