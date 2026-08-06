"use client";

import { useEffect, useRef, useState } from "react";

/**
 * One toast at a time, bottom-center, on the inverted surface (the same look
 * as the storage and session banners, but auto-dismissing). A tiny module-level
 * manager means any code can call showToast(...) without threading props; the
 * single ToastHost in the root layout renders whatever is current.
 */

export type ToastVariant = "default" | "danger";

type ToastData = {
  id: number;
  text: string;
  variant: ToastVariant;
  createdAt: number;
};

const DISMISS_MS = 4000;

let nextId = 1;
let current: ToastData | null = null;
let notify: ((t: ToastData | null) => void) | null = null;

export function showToast(text: string, opts?: { variant?: ToastVariant }) {
  current = {
    id: nextId++,
    text,
    variant: opts?.variant ?? "default",
    createdAt: Date.now(),
  };
  notify?.(current);
}

export function ToastHost() {
  const [toast, setToast] = useState<ToastData | null>(null);
  const toastRef = useRef<ToastData | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const armedAt = useRef(0);
  const remaining = useRef(DISMISS_MS);

  useEffect(() => {
    notify = setToast;
    if (current && Date.now() - current.createdAt < DISMISS_MS) {
      setToast(current);
    } else {
      current = null;
      setToast(null);
    }
    return () => {
      if (notify === setToast) notify = null;
      if (current?.id === toastRef.current?.id) current = null;
    };
  }, []);

  useEffect(() => {
    toastRef.current = toast;
  }, [toast]);

  const dismiss = (id: number) => {
    if (current?.id === id) current = null;
    setToast((shown) => (shown?.id === id ? null : shown));
  };

  // Auto-dismiss with pause-on-hover: hovering stops the clock, leaving
  // resumes it with whatever time was left (with a small floor so a toast
  // never vanishes the instant the pointer leaves).
  useEffect(() => {
    if (!toast) return;
    remaining.current = Math.max(
      0,
      DISMISS_MS - (Date.now() - toast.createdAt)
    );
    armedAt.current = Date.now();
    const id = toast.id;
    timer.current = setTimeout(() => dismiss(id), remaining.current);
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
      timer.current = setTimeout(() => dismiss(toast.id), remaining.current);
    }
  };

  return (
    <div
      className={"ui-toast" + (toast.variant === "danger" ? " ui-toast-danger" : "")}
      role={toast.variant === "danger" ? "alert" : "status"}
      onMouseEnter={pause}
      onMouseLeave={resume}
    >
      {toast.text}
    </div>
  );
}
