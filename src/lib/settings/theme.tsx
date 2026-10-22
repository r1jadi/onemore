/**
 * Real appearance setting: dark, light and system. The selection applies
 * immediately to the document, follows the OS in system mode (including live
 * changes), persists across reloads, and never changes the displayed value
 * without applying the theme.
 */

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

import { readWithLegacy, safeLocalStorage } from "@/lib/storage";

export type Appearance = "dark" | "light" | "system";

const STORAGE_KEY = "unbored-appearance";
/** Pre-rename key: read once and moved forward by `readWithLegacy`. */
const LEGACY_STORAGE_KEY = "onemore-appearance";

function readStored(): Appearance {
  const raw = readWithLegacy(safeLocalStorage(), STORAGE_KEY, LEGACY_STORAGE_KEY);
  if (raw === "dark" || raw === "light" || raw === "system") return raw;
  return "dark";
}

function resolveEffective(choice: Appearance): "dark" | "light" {
  if (choice !== "system") return choice;
  try {
    return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  } catch {
    return "dark";
  }
}

function apply(choice: Appearance): void {
  const effective = resolveEffective(choice);
  const root = document.documentElement;
  root.classList.toggle("dark", effective === "dark");
  root.classList.toggle("light", effective === "light");
  root.style.colorScheme = effective;
}

const ThemeContext = createContext<{ choice: Appearance; setChoice: (next: Appearance) => void }>({
  choice: "dark",
  setChoice: () => undefined,
});

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [choice, setChoiceState] = useState<Appearance>(() =>
    typeof window === "undefined" ? "dark" : readStored(),
  );

  useEffect(() => {
    apply(choice);
  }, [choice]);

  // System mode tracks the OS live.
  useEffect(() => {
    if (choice !== "system") return;
    let query: MediaQueryList | undefined;
    try {
      query = window.matchMedia("(prefers-color-scheme: light)");
    } catch {
      return;
    }
    const onChange = () => apply("system");
    query.addEventListener("change", onChange);
    return () => query?.removeEventListener("change", onChange);
  }, [choice]);

  function setChoice(next: Appearance): void {
    setChoiceState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Persistence is best effort; the live application still updates.
    }
    apply(next);
  }

  return <ThemeContext.Provider value={{ choice, setChoice }}>{children}</ThemeContext.Provider>;
}

export function useTheme(): { choice: Appearance; setChoice: (next: Appearance) => void } {
  return useContext(ThemeContext);
}
