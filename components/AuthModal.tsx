"use client";

import { useState } from "react";
import { signIn, signUp } from "@/lib/supabase/auth";

/**
 * Sign in / sign up modal. Appears only when the writer chooses to save to the
 * cloud — you never need an account just to start writing.
 */
export function AuthModal({ onClose }: { onClose: () => void }) {
  const [mode, setMode] = useState<"signin" | "signup">("signup");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const fn = mode === "signup" ? signUp : signIn;
    const { error } = await fn(email.trim(), password);
    setBusy(false);
    if (error) {
      setError(error.message);
      return;
    }
    onClose(); // auth state change triggers sync automatically
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2 className="modal-title">
          {mode === "signup" ? "Create your account" : "Welcome back"}
        </h2>
        <p className="modal-sub">
          Your work is saved locally already. Sign {mode === "signup" ? "up" : "in"}{" "}
          to back it up and sync across devices.
        </p>

        <form onSubmit={submit}>
          <label className="field">
            <span>Email</span>
            <input
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoFocus
            />
          </label>
          <label className="field">
            <span>Password</span>
            <input
              type="password"
              autoComplete={
                mode === "signup" ? "new-password" : "current-password"
              }
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>

          {error && <div className="modal-error">{error}</div>}

          <button type="submit" className="modal-primary" disabled={busy}>
            {busy
              ? "Working…"
              : mode === "signup"
                ? "Create account"
                : "Sign in"}
          </button>
        </form>

        <div className="modal-switch">
          {mode === "signup" ? (
            <>
              Already have an account?{" "}
              <button type="button" onClick={() => setMode("signin")}>
                Sign in
              </button>
            </>
          ) : (
            <>
              New here?{" "}
              <button type="button" onClick={() => setMode("signup")}>
                Create an account
              </button>
            </>
          )}
        </div>

        <button type="button" className="modal-close" onClick={onClose}>
          Keep writing without an account
        </button>
      </div>
    </div>
  );
}
