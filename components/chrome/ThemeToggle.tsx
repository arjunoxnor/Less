"use client";

import { useEffect, useState } from "react";
import type { ThemeChoice } from "@/lib/storage/localStore";
import { nextThemeChoice } from "@/lib/storage/libraryInteraction";
import { MoonIcon, SunIcon } from "./icons";

function systemResolvesDark(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
  );
}

export function ThemeToggle({
  theme,
  onChange,
}: {
  theme: ThemeChoice;
  onChange: (theme: ThemeChoice) => void;
}) {
  const [systemDark, setSystemDark] = useState(systemResolvesDark);

  useEffect(() => {
    if (theme !== "system" || typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => setSystemDark(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, [theme]);

  const next = nextThemeChoice(theme, systemDark);
  const label = `Switch to ${next}`;
  return (
    <button
      type="button"
      className="tb-icon"
      title={label}
      aria-label={label}
      onClick={() => onChange(nextThemeChoice(theme, systemResolvesDark()))}
    >
      {next === "dark" ? <MoonIcon /> : <SunIcon />}
    </button>
  );
}
