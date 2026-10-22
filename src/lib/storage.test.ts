import { beforeEach, describe, expect, it } from "vitest";

import { readWithLegacy, removeWithLegacy } from "@/lib/storage";

beforeEach(() => {
  window.localStorage.clear();
});

describe("readWithLegacy", () => {
  it("moves a legacy value to the current key and removes the legacy copy", () => {
    window.localStorage.setItem("onemore-language", "pl");

    expect(readWithLegacy(window.localStorage, "unbored-language", "onemore-language")).toBe("pl");
    expect(window.localStorage.getItem("unbored-language")).toBe("pl");
    // Moved, not copied: the fallback runs once for each visitor.
    expect(window.localStorage.getItem("onemore-language")).toBeNull();
  });

  it("prefers the current key and leaves a legacy copy untouched", () => {
    window.localStorage.setItem("unbored-language", "en");
    window.localStorage.setItem("onemore-language", "pl");

    expect(readWithLegacy(window.localStorage, "unbored-language", "onemore-language")).toBe("en");
    expect(window.localStorage.getItem("onemore-language")).toBe("pl");
  });

  it("returns null when neither key holds a value", () => {
    expect(readWithLegacy(window.localStorage, "unbored-language", "onemore-language")).toBeNull();
  });

  it("returns null when storage is unavailable", () => {
    expect(readWithLegacy(undefined, "unbored-language", "onemore-language")).toBeNull();
  });

  it("still returns the legacy value when the move cannot be written", () => {
    const writes: string[] = [];
    const denied: Storage = {
      length: 0,
      clear: () => undefined,
      getItem: (key: string) => (key === "onemore-language" ? "pl" : null),
      key: () => null,
      removeItem: () => undefined,
      setItem: (key: string) => {
        writes.push(key);
        throw new Error("quota exceeded");
      },
    };

    // A refused write must not hide the value the visitor already has.
    expect(readWithLegacy(denied, "unbored-language", "onemore-language")).toBe("pl");
    expect(writes).toEqual(["unbored-language"]);
  });
});

describe("removeWithLegacy", () => {
  it("clears the current and legacy keys", () => {
    window.localStorage.setItem("unbored-language", "en");
    window.localStorage.setItem("onemore-language", "pl");

    removeWithLegacy(window.localStorage, "unbored-language", "onemore-language");

    expect(window.localStorage.getItem("unbored-language")).toBeNull();
    expect(window.localStorage.getItem("onemore-language")).toBeNull();
  });

  it("does nothing when storage is unavailable", () => {
    expect(() => removeWithLegacy(undefined, "unbored-language", "onemore-language")).not.toThrow();
  });
});
