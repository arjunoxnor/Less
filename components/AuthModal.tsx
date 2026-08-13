"use client";

import { useEffect, useRef, useState } from "react";
import {
  createSyncCode,
  adoptSyncCode,
  formatSyncCode,
  signInWithGoogle,
} from "@/lib/cloud/auth";
import { listScripts } from "@/lib/cloud/scripts";

const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;

/**
 * Sign in to sync. Primary path is "Sign in with Google" (when a client id is
 * configured); a private sync code is offered as a no-account fallback and for
 * linking a device. There is no password.
 */
export function AuthModal({ onClose }: { onClose: () => void }) {
  const [created, setCreated] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [entry, setEntry] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [googleError, setGoogleError] = useState<string | null>(null);
  const googleHostRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Esc dismisses the modal. Capture phase with stopPropagation, matching
  // ui/Modal, so the shell's window-level Escape handler (dock, focus mode)
  // never acts behind a still-open dialog.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      onCloseRef.current();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  // Render the Google Identity Services button.
  useEffect(() => {
    if (!GOOGLE_CLIENT_ID || created) return;
    let cancelled = false;
    const handle = async (resp: { credential?: string }) => {
      if (!resp.credential) return;
      setGoogleError(null);
      const { error } = await signInWithGoogle(resp.credential);
      if (error) {
        setGoogleError("Google sign-in failed. Make sure you are added as a test user on the consent screen.");
        return;
      }
      onCloseRef.current();
    };
    const init = () => {
      const g = (window as unknown as { google?: GoogleNS }).google;
      if (cancelled || !g || !googleHostRef.current) return;
      g.accounts.id.initialize({ client_id: GOOGLE_CLIENT_ID, callback: handle });
      g.accounts.id.renderButton(googleHostRef.current, {
        theme: "outline",
        size: "large",
        text: "continue_with",
        width: 300,
      });
    };
    if ((window as unknown as { google?: GoogleNS }).google?.accounts?.id) {
      init();
      return;
    }
    let s = document.getElementById("gsi-script") as HTMLScriptElement | null;
    if (s) {
      s.addEventListener("load", init);
      return () => {
        cancelled = true;
        s?.removeEventListener("load", init);
      };
    }
    s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client";
    s.async = true;
    s.defer = true;
    s.id = "gsi-script";
    s.onload = init;
    document.head.appendChild(s);
    return () => {
      cancelled = true;
    };
  }, [created]);

  const create = () => setCreated(createSyncCode());
  const copy = () => {
    if (!created) return;
    navigator.clipboard?.writeText(formatSyncCode(created)).then(
      () => setCopied(true),
      () => setCopied(false)
    );
  };
  const [linking, setLinking] = useState(false);
  const link = async () => {
    setError(null);
    if (!adoptSyncCode(entry)) {
      setError("That code looks too short. Paste the full code from your other device.");
      return;
    }
    setLinking(true);
    try {
      // A code is just an identity, so a typo links to a valid-but-empty account.
      // Peek at the cloud: if there is nothing there, keep the modal open with a
      // hint instead of dropping the writer into a blank workspace.
      const scripts = await listScripts();
      if (scripts.length === 0) {
        setLinking(false);
        setError(
          "Linked, but this code has no scripts in the cloud yet. If you expected your work here, double-check the code. Otherwise you can keep going."
        );
        return;
      }
    } catch {
      /* network issue: fall through and let reconcile handle it */
    }
    setLinking(false);
    onClose();
  };

  if (created) {
    return (
      <div className="modal-backdrop" onClick={onClose}>
        <div className="modal" onClick={(e) => e.stopPropagation()}>
          <h2 className="modal-title">Your sync is on</h2>
          <p className="modal-sub">
            This is your private sync code. Save it somewhere safe. It is the only way to reach
            your work on another device, so treat it like a key.
          </p>
          <div className="synccode-box">{formatSyncCode(created)}</div>
          <button type="button" className="modal-primary" onClick={copy}>
            {copied ? "Copied" : "Copy code"}
          </button>
          <button type="button" className="modal-close" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2 className="modal-title">Sign in to sync</h2>
        <p className="modal-sub">
          Your work is saved on this device already. Sign in to back it up and open it from your
          other computers.
        </p>

        {GOOGLE_CLIENT_ID && (
          <>
            <div className="google-btn-host" ref={googleHostRef} />
            {googleError && <div className="modal-error">{googleError}</div>}
            <div className="modal-divider">
              <span>or use a sync code</span>
            </div>
          </>
        )}

        <button type="button" className="modal-primary modal-secondary" onClick={create}>
          Create a sync code
        </button>

        <label className="field" style={{ marginTop: 10 }}>
          <span>Or paste a code from another device</span>
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
        <button
          type="button"
          className="modal-primary modal-secondary"
          onClick={() => void link()}
          disabled={linking}
        >
          {linking ? "Linking" : "Link this device"}
        </button>

        <button type="button" className="modal-close" onClick={onClose}>
          Keep writing without sync
        </button>
      </div>
    </div>
  );
}

/* Minimal typing for the Google Identity Services global. */
type GoogleNS = {
  accounts: {
    id: {
      initialize: (cfg: { client_id: string; callback: (r: { credential?: string }) => void }) => void;
      renderButton: (
        el: HTMLElement,
        opts: { theme?: string; size?: string; text?: string; width?: number }
      ) => void;
    };
  };
};
