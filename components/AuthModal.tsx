"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  createSyncCode,
  adoptSyncCode,
  formatSyncCode,
  signInWithGoogle,
} from "@/lib/cloud/auth";
import { listScripts } from "@/lib/cloud/scripts";
import { Modal } from "./ui/Modal";

const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;

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
  const [linking, setLinking] = useState(false);
  const googleHostRef = useRef<HTMLDivElement>(null);
  const copyRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  const aliveRef = useRef(true);
  const linkAttemptRef = useRef(0);
  const linkingRef = useRef(false);
  onCloseRef.current = onClose;

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      linkAttemptRef.current++;
    };
  }, []);

  useLayoutEffect(() => {
    if (created) copyRef.current?.focus();
  }, [created]);

  const close = () => {
    linkAttemptRef.current++;
    linkingRef.current = false;
    onCloseRef.current();
  };

  // Render the Google Identity Services button.
  useEffect(() => {
    if (!GOOGLE_CLIENT_ID || created) return;
    let cancelled = false;
    const handle = async (resp: { credential?: string }) => {
      if (!resp.credential) return;
      setGoogleError(null);
      const { error } = await signInWithGoogle(resp.credential);
      if (cancelled || !aliveRef.current) return;
      if (error) {
        setGoogleError("Google sign-in failed. Make sure you are added as a test user on the consent screen.");
        return;
      }
      close();
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

  const create = () => {
    setCopied(false);
    setCreated(createSyncCode());
  };
  const copy = () => {
    if (!created) return;
    void copyText(formatSyncCode(created)).then(
      () => {
        if (aliveRef.current) setCopied(true);
      },
      () => {
        if (aliveRef.current) setCopied(false);
      }
    );
  };
  const link = async () => {
    if (linkingRef.current) return;
    setError(null);
    if (!adoptSyncCode(entry)) {
      setError("That code looks too short. Paste the full code from your other device.");
      return;
    }
    linkingRef.current = true;
    setLinking(true);
    const attempt = ++linkAttemptRef.current;
    try {
      // A code is just an identity, so a typo links to a valid-but-empty account.
      // Peek at the cloud: if there is nothing there, keep the modal open with a
      // hint instead of dropping the writer into a blank workspace.
      const scripts = await listScripts();
      if (!aliveRef.current || attempt !== linkAttemptRef.current) return;
      if (scripts.length === 0) {
        linkingRef.current = false;
        setLinking(false);
        setError(
          "Linked, but this code has no scripts in the cloud yet. If you expected your work here, double-check the code. Otherwise you can keep going."
        );
        return;
      }
    } catch {
      /* network issue: fall through and let reconcile handle it */
    }
    if (!aliveRef.current || attempt !== linkAttemptRef.current) return;
    linkingRef.current = false;
    setLinking(false);
    close();
  };

  if (created) {
    return (
      <Modal
        title="Your sync is on"
        onClose={close}
        actions={[{ label: "Done", variant: "solid", onClick: close }]}
      >
          <p className="modal-sub">
            This is your private sync code. Save it somewhere safe. It is the only way to reach
            your work on another device, so treat it like a key.
          </p>
          <div className="synccode-box">{formatSyncCode(created)}</div>
          <button
            ref={copyRef}
            type="button"
            className="modal-primary"
            onClick={copy}
          >
            {copied ? "Copied" : "Copy code"}
          </button>
      </Modal>
    );
  }

  return (
    <Modal
      title="Sign in to sync"
      onClose={close}
      actions={[{ label: "Keep writing without sync", onClick: close }]}
    >
        <p className="modal-sub">
          Your work is saved on this device already. Sign in to back it up and open it from your
          other computers.
        </p>

        {GOOGLE_CLIENT_ID && (
          <>
            <div className="google-btn-host" ref={googleHostRef} />
            {googleError && <div className="modal-error" role="alert">{googleError}</div>}
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
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void link();
              }
            }}
          />
        </label>
        {error && <div className="modal-error" role="alert">{error}</div>}
        <button
          type="button"
          className="modal-primary modal-secondary"
          onClick={() => void link()}
          disabled={linking}
        >
          {linking ? "Linking…" : "Link this device"}
        </button>
    </Modal>
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
