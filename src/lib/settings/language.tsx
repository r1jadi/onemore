/**
 * Real localization for the languages the app genuinely supports.
 *
 * Only English and Polish are offered: both dictionaries below are complete
 * for every string routed through `t()`, and the test suite fails on a missing
 * key rather than rendering a placeholder. Adding a language means adding a
 * complete dictionary — never an entry in the selector alone.
 */

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

import { readWithLegacy, safeLocalStorage } from "@/lib/storage";

export type Language = "en" | "pl";

const STORAGE_KEY = "unbored-language";
/** Pre-rename key: read once and moved forward by `readWithLegacy`. */
const LEGACY_STORAGE_KEY = "onemore-language";

const dictionaries = {
  en: {
    "nav.home": "Home",
    "nav.ranks": "Ranks",
    "nav.inbox": "Inbox",
    "nav.forYou": "For You",
    "nav.following": "Following",
    "nav.explore": "Explore",
    "nav.search": "Search",
    "nav.leaderboards": "Leaderboards",
    "nav.notifications": "Notifications",
    "nav.saved": "Saved",
    "nav.recent": "Recently played",
    "nav.profile": "Profile",
    "nav.settings": "Settings",
    "nav.admin": "Admin",
    "auth.login": "Log in",
    "auth.signup": "Create account",
    "auth.logout": "Log out",
    "settings.title": "Settings",
    "settings.account": "Account",
    "settings.profile": "Profile",
    "settings.privacy": "Privacy",
    "settings.notifications": "Notifications",
    "settings.language": "Language",
    "settings.appearance": "Appearance",
    "settings.accessibility": "Accessibility",
    "settings.blocked": "Blocked users",
    "settings.help": "Help",
    "settings.about": "About",
    "common.retry": "Retry",
    "common.signInRequired": "Sign in to continue.",
    "following.empty": "You're not following anyone yet",
    "notifications.empty": "You're all caught up",
  },
  pl: {
    "nav.home": "Główna",
    "nav.ranks": "Rankingi",
    "nav.inbox": "Skrzynka",
    "nav.forYou": "Dla Ciebie",
    "nav.following": "Obserwowane",
    "nav.explore": "Odkrywaj",
    "nav.search": "Szukaj",
    "nav.leaderboards": "Rankingi",
    "nav.notifications": "Powiadomienia",
    "nav.saved": "Zapisane",
    "nav.recent": "Ostatnio grane",
    "nav.profile": "Profil",
    "nav.settings": "Ustawienia",
    "nav.admin": "Admin",
    "auth.login": "Zaloguj się",
    "auth.signup": "Załóż konto",
    "auth.logout": "Wyloguj się",
    "settings.title": "Ustawienia",
    "settings.account": "Konto",
    "settings.profile": "Profil",
    "settings.privacy": "Prywatność",
    "settings.notifications": "Powiadomienia",
    "settings.language": "Język",
    "settings.appearance": "Wygląd",
    "settings.accessibility": "Dostępność",
    "settings.blocked": "Zablokowani",
    "settings.help": "Pomoc",
    "settings.about": "O aplikacji",
    "common.retry": "Spróbuj ponownie",
    "common.signInRequired": "Zaloguj się, aby kontynuować.",
    "following.empty": "Nikogo jeszcze nie obserwujesz",
    "notifications.empty": "Wszystko nadrobione",
  },
} as const;

export type TranslationKey = keyof (typeof dictionaries)["en"];

function readStored(): Language {
  const raw = readWithLegacy(safeLocalStorage(), STORAGE_KEY, LEGACY_STORAGE_KEY);
  if (raw === "pl") return "pl";
  if (raw === "en") return "en";
  try {
    const nav = navigator.language.toLowerCase();
    if (nav.startsWith("pl")) return "pl";
  } catch {
    // Ignore locale detection failures.
  }
  return "en";
}

const LanguageContext = createContext<{
  language: Language;
  setLanguage: (next: Language) => void;
}>({
  language: "en",
  setLanguage: () => undefined,
});

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>(() =>
    typeof window === "undefined" ? "en" : readStored(),
  );

  useEffect(() => {
    try {
      document.documentElement.lang = language;
    } catch {
      // Non-fatal.
    }
  }, [language]);

  function setLanguage(next: Language): void {
    setLanguageState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Best effort.
    }
    try {
      document.documentElement.lang = next;
    } catch {
      // Non-fatal.
    }
  }

  return (
    <LanguageContext.Provider value={{ language, setLanguage }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage(): {
  language: Language;
  setLanguage: (next: Language) => void;
  t: (key: TranslationKey) => string;
} {
  const { language, setLanguage } = useContext(LanguageContext);
  return { language, setLanguage, t: (key) => dictionaries[language][key] };
}

/** All offered languages. Add one only with a complete dictionary above. */
export const offeredLanguages: Array<{ code: Language; label: string; native: string }> = [
  { code: "en", label: "English", native: "English" },
  { code: "pl", label: "Polish", native: "Polski" },
];

/** Fails when a dictionary is missing a key, so partial translations cannot ship. */
export function assertDictionariesComplete(): string[] {
  const base = Object.keys(dictionaries.en);
  const missing: string[] = [];
  for (const key of base) {
    if (!(key in dictionaries.pl)) missing.push(`pl:${key}`);
  }
  return missing;
}
