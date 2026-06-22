"use client";

import { useState } from "react";
import { createSyncCode, adoptSyncCode, formatSyncCode } from "@/lib/cloud/auth";

/**
 * Sync setup. There is no account or password: you create a private sync code
 * (which is also your recovery key) and paste it on your other devices to link
 * them. Appears only when the writer chooses to sync; you never need it to
 * start writing.
 */
export function AuthModal({ onClose }: { onClose: () => void }) {
  const [created, setCreated] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [entry, setEntry] = useState("");
  const [error, setError] = useState<string | null>(null);

  const create = () => setCreated(createSyncCode());

  const copy = () => {
    if (!created) return;
    navigator.clipboard?.writeText(formatSyncCode(created)).then(
      () => setCopied(true),
      () => setCopied(false)
    );
  };

  const link = () => {
    setError(null);
    if (!adoptSyncCode(entry)) {
      setError("That code looks too short. Paste the full code from your other device.");
      return;
    }
    onClose();
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        {created ? (
          <>
            <h2 className="modal-title">Your sync is on</h2>
            <p className="modal-sub">
              This is your private sync code. Save it somewhere safe. It is the only way to
              reach your work on another device, so treat it like a key.
            </p>
            <div className="synccode-box">{formatSyncCode(created)}</div>
            <button type="button" className="modal-primary" onClick={copy}>
              {copied ? "Copied" : "Copy code"}
            </button>
            <button type="button" className="modal-close" onClick={onClose}>
              Done
            </button>
          </>
        ) : (
          <>
            <h2 className="modal-title">Sync across devices</h2>
            <p className="modal-sub">
              Your work is saved on this device already. Turn on sync to back it up and open it
              from your other computers.
            </p>

            <button type="button" className="modal-primary" onClick={create}>
              Create my sync code
            </button>

            <div className="modal-divider">
              <span>or link a device</span>
            </div>

            <label className="field">
              <span>Paste a code from another device</span>
              <input
                type="text"
                value={entry}
                onChange={(e) => setEntry(e.target.value)}
                placeholder="ABCD-EFGH-..."
                autoComplete="off"
                spellCheck={false}
              />
            </label>
            {error && <div className="modal-error">{error}</div>}
            <button type="button" className="modal-primary modal-secondary" onClick={link}>
              Link this device
            </button>

            <button type="button" className="modal-close" onClick={onClose}>
              Keep writing without sync
            </button>
          </>
        )}
      </div>
    </div>
  );
}
