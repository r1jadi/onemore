/**
 * Browser-storage compatibility for the rename to Unbored.
 *
 * Keys are the only place the old name survives, and existing visitors still
 * hold a session and their preferences under them. Every read falls back to the
 * old key once and rewrites the value under the new one, so the rename never
 * signs anyone out or resets a choice. The old keys are only read and removed;
 * nothing writes them.
 */

/** `localStorage`, or `undefined` where it is unavailable (the server, denied storage). */
export function safeLocalStorage(): Storage | undefined {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

/** `sessionStorage`, or `undefined` where it is unavailable (the server, denied storage). */
export function safeSessionStorage(): Storage | undefined {
  try {
    return typeof sessionStorage === "undefined" ? undefined : sessionStorage;
  } catch {
    return undefined;
  }
}

/**
 * Reads `key`, falling back to `legacyKey` and moving the value forward.
 *
 * Returns `null` when neither key holds anything (or storage is unavailable).
 * Copying is best effort: when storage refuses the write, the legacy value is
 * still returned, so a denied or full storage degrades to a read-only fallback
 * rather than losing the value.
 */
export function readWithLegacy(
  storage: Storage | undefined,
  key: string,
  legacyKey: string,
): string | null {
  if (!storage) return null;

  let current: string | null;
  try {
    current = storage.getItem(key);
  } catch {
    return null;
  }
  if (current !== null) return current;

  let legacy: string | null;
  try {
    legacy = storage.getItem(legacyKey);
  } catch {
    return null;
  }
  if (legacy === null) return null;

  try {
    storage.setItem(key, legacy);
    storage.removeItem(legacyKey);
  } catch {
    /* the legacy copy stays authoritative until it can be moved */
  }
  return legacy;
}

/** Removes the current and legacy key, so a stale copy cannot revive state. */
export function removeWithLegacy(
  storage: Storage | undefined,
  key: string,
  legacyKey: string,
): void {
  if (!storage) return;
  for (const name of [key, legacyKey]) {
    try {
      storage.removeItem(name);
    } catch {
      /* best effort */
    }
  }
}
