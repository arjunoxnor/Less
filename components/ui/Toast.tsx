"use client";

import { useEffect, useRef, useState } from "react";

/**
 * One toast at a time, bottom-center, on the inverted surface (the same look
 * as the storage and session banners, but auto-dismissing). A tiny module-level
 * manager means any code can call showToast(...) without threading props; the
 * single ToastHost in the root layout renders whatever is current.
 */

export type ToastVariant = "default" | "danger";

type ToastData = { id: number; text: string; variant: ToastVariant };

const DISMISS_MS = 4000;

let nextId = 1;
let current: ToastData | null = null;
let notify: ((t: ToastData | null) => void) | null = null;

export function showToast(text: string, opts?: { variant?: ToastVariant }) {
  current = { id: nextId++, text, variant: opts?.variant ?? "default" };
  notify?.(current);
}

export function ToastHost() {
  const [toast, setToast] = useState<ToastData | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const armedAt = useRef(0);
  const remaining = useRef(DISMISS_MS);

  useEffect(() => {
    notify = setToast;
    setToast(current);
    return () => {
      if (notify === setToast) notify = null;
    };
  }, []);

  // Auto-dismiss with pause-on-hover: hovering stops the clock, leaving
  // resumes it with whatever time was left (with a small floor so a toast
  // never vanishes the instant the pointer leaves).
  useEffect(() => {
    if (!toast) return;
    remaining.current = DISMISS_MS;
    armedAt.current = Date.now();
    timer.current = setTimeout(() => setToast(null), remaining.current);
    return () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
    };
  }, [toast]);

  if (!toast) return null;

  const pause = () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
      remaining.current -= Date.now() - armedAt.current;
    }
  };
  const resume = () => {
    if (!timer.current) {
      remaining.current = Math.max(600, remaining.current);
      armedAt.current = Date.now();
      timer.current = setTimeout(() => setToast(null), remaining.current);
    }
  };

  return (
    <div
      className={"ui-toast" + (toast.variant === "danger" ? " ui-toast-danger" : "")}
      role="status"
      onMouseEnter={pause}
      onMouseLeave={resume}
    >
      {toast.text}
    </div>
  );
}
