"use client";

/**
 * A slim, persistent notice shown when the stored session has expired (the API
 * answered 401). Nothing is wiped and nothing is lost: local saves keep working
 * and sync simply pauses until the writer signs in again. The banner is the one
 * visible surface of that state; it stays until a successful sign-in clears the
 * expiry flag (see lib/cloud/client.ts).
 */
export function SessionExpiredBanner({ onSignIn }: { onSignIn: () => void }) {
  return (
    <div className="session-banner" role="alert">
      <span>
        Your sign-in expired. Sign in again to keep syncing. Your work is safe
        on this device.
      </span>
      <button type="button" className="session-banner-btn" onClick={onSignIn}>
        Sign in
      </button>
    </div>
  );
}
