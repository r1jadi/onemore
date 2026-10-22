/**
 * Real accessibility preferences. Each toggle changes the interface and
 * persists; controls that would do nothing are not rendered.
 */

import { useEffect, useState } from "react";

import { readWithLegacy, safeLocalStorage } from "@/lib/storage";

export type AccessibilityPrefs = {
  reduceMotion: boolean;
  largerText: boolean;
  increaseContrast: boolean;
};

const STORAGE_KEY = "unbored-accessibility";
/** Pre-rename key: read once and moved forward by `readWithLegacy`. */
const LEGACY_STORAGE_KEY = "onemore-accessibility";

const defaults: AccessibilityPrefs = {
  reduceMotion: false,
  largerText: false,
  increaseContrast: false,
};

function readStored(): AccessibilityPrefs {
  const raw = readWithLegacy(safeLocalStorage(), STORAGE_KEY, LEGACY_STORAGE_KEY);
  if (!raw) return defaults;
  try {
    const parsed = JSON.parse(raw) as Partial<AccessibilityPrefs>;
    return {
      reduceMotion: parsed.reduceMotion === true,
      largerText: parsed.largerText === true,
      increaseContrast: parsed.increaseContrast === true,
    };
  } catch {
    return defaults;
  }
}

function apply(prefs: AccessibilityPrefs): void {
  const root = document.documentElement;
  root.classList.toggle("a11y-reduce-motion", prefs.reduceMotion);
  root.classList.toggle("a11y-larger-text", prefs.largerText);
  root.classList.toggle("a11y-contrast", prefs.increaseContrast);
}

export function useAccessibility(): {
  prefs: AccessibilityPrefs;
  setPrefs: (next: AccessibilityPrefs) => void;
} {
  const [prefs, setPrefsState] = useState<AccessibilityPrefs>(() =>
    typeof window === "undefined" ? defaults : readStored(),
  );

  useEffect(() => {
    apply(prefs);
  }, [prefs]);

  // Respect the OS reduce-motion setting until the user chooses explicitly. A
  // choice saved before the rename counts as explicit, so it is read (and moved
  // forward) rather than mistaken for "never chose".
  useEffect(() => {
    if (readWithLegacy(safeLocalStorage(), STORAGE_KEY, LEGACY_STORAGE_KEY)) return;
    try {
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        setPrefsState((prev) => ({ ...prev, reduceMotion: true }));
      }
    } catch {
      // Non-fatal.
    }
  }, []);

  function setPrefs(next: AccessibilityPrefs): void {
    setPrefsState(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Best effort.
    }
    apply(next);
  }

  return { prefs, setPrefs };
}
