import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  normalizeUsername,
  useUsernameAvailability,
  USERNAME_CHECK_DEBOUNCE_MS,
  usernameStatusMessage,
  usernameValidationMessage,
} from "@/lib/users/username";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

type Deferred = {
  promise: Promise<Response>;
  resolve: (response: Response) => void;
};

function deferred(): Deferred {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function mockFetch(handler: (url: string) => Response | Promise<Response>) {
  const spy = vi.fn(async (input: RequestInfo | URL) => handler(String(input)));
  vi.stubGlobal("fetch", spy);
  return spy;
}

function usernameOf(url: string): string | null {
  return new URL(url, "http://localhost").searchParams.get("username");
}

/** Advances fake time and flushes the promises the timers started. */
async function tick(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("username rules", () => {
  it("normalizes surrounding whitespace and case", () => {
    expect(normalizeUsername("  Rijad  ")).toBe("rijad");
    expect(normalizeUsername("RIJAD")).toBe("rijad");
    expect(normalizeUsername("\trijad\n")).toBe("rijad");
  });

  it("accepts the documented shape", () => {
    expect(usernameValidationMessage("rijad")).toBeUndefined();
    expect(usernameValidationMessage("player_01")).toBeUndefined();
    expect(usernameValidationMessage("abc")).toBeUndefined();
    expect(usernameValidationMessage("a".repeat(24))).toBeUndefined();
  });

  it("names the exact rule a value breaks", () => {
    expect(usernameValidationMessage("")).toBe("Choose a username.");
    expect(usernameValidationMessage("ab")).toBe("Use 3–24 characters for your username.");
    expect(usernameValidationMessage("a".repeat(25))).toBe(
      "Use 3–24 characters for your username.",
    );
    expect(usernameValidationMessage("rijad adil")).toBe(
      "Use only letters, numbers and underscores.",
    );
    expect(usernameValidationMessage("rijad-adil")).toBe(
      "Use only letters, numbers and underscores.",
    );
    expect(usernameValidationMessage("rijad!")).toBe("Use only letters, numbers and underscores.");
  });

  it("has user-facing text for every state", () => {
    expect(usernameStatusMessage({ state: "empty" })).toBe("Choose a username");
    expect(usernameStatusMessage({ state: "checking" })).toBe("Checking availability...");
    expect(usernameStatusMessage({ state: "available", username: "rijad" })).toBe(
      "Username is available",
    );
    expect(usernameStatusMessage({ state: "taken" })).toBe("Username is already taken");
    expect(usernameStatusMessage({ state: "error" })).toBe(
      "Couldn't check username availability. Try again.",
    );
    expect(usernameStatusMessage({ state: "invalid", message: "Too short." })).toBe("Too short.");
  });
});

describe("useUsernameAvailability", () => {
  it("does not ask about an empty or invalid value", async () => {
    const spy = mockFetch(() => jsonResponse({ username: "x", available: true }));
    const { result, rerender } = renderHook(({ value }) => useUsernameAvailability(value), {
      initialProps: { value: "" },
    });

    expect(result.current.status.state).toBe("empty");
    rerender({ value: "ab" });
    expect(result.current.status).toEqual({
      state: "invalid",
      message: "Use 3–24 characters for your username.",
    });

    await act(async () => {
      vi.advanceTimersByTime(USERNAME_CHECK_DEBOUNCE_MS * 3);
    });
    expect(spy).not.toHaveBeenCalled();
  });

  it("debounces typing into one lookup for the settled value", async () => {
    const spy = mockFetch((url) => jsonResponse({ username: usernameOf(url), available: true }));
    const { result, rerender } = renderHook(({ value }) => useUsernameAvailability(value), {
      initialProps: { value: "r" },
    });

    rerender({ value: "ri" });
    rerender({ value: "rij" });

    await tick(USERNAME_CHECK_DEBOUNCE_MS - 1);
    expect(spy).not.toHaveBeenCalled();
    expect(result.current.status.state).toBe("checking");

    await tick(1);
    expect(result.current.status).toEqual({ state: "available", username: "rij" });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(usernameOf(String(spy.mock.calls[0][0]))).toBe("rij");
  });

  it("reports both an available and a taken answer", async () => {
    mockFetch((url) =>
      jsonResponse({ username: usernameOf(url), available: usernameOf(url) === "free_name" }),
    );
    const { result, rerender } = renderHook(({ value }) => useUsernameAvailability(value), {
      initialProps: { value: "free_name" },
    });

    await tick(USERNAME_CHECK_DEBOUNCE_MS);
    expect(result.current.status).toEqual({ state: "available", username: "free_name" });

    rerender({ value: "taken_name" });
    await tick(USERNAME_CHECK_DEBOUNCE_MS);
    expect(result.current.status).toEqual({ state: "taken" });
  });

  it("never lets a late answer overwrite the latest username", async () => {
    const alpha = deferred();
    const beta = deferred();
    mockFetch((url) => (usernameOf(url) === "alpha_name" ? alpha.promise : beta.promise));

    const { result, rerender } = renderHook(({ value }) => useUsernameAvailability(value), {
      initialProps: { value: "alpha_name" },
    });
    await act(async () => {
      vi.advanceTimersByTime(USERNAME_CHECK_DEBOUNCE_MS);
    });

    rerender({ value: "beta_name" });
    expect(result.current.status.state).toBe("checking");
    await act(async () => {
      vi.advanceTimersByTime(USERNAME_CHECK_DEBOUNCE_MS);
    });

    // The newer request answers first...
    await act(async () => {
      beta.resolve(jsonResponse({ username: "beta_name", available: true }));
    });
    expect(result.current.status).toEqual({ state: "available", username: "beta_name" });

    // ...and the abandoned older one answers afterwards, reporting the name it
    // asked about as taken. It must not touch the status of beta_name.
    await act(async () => {
      alpha.resolve(jsonResponse({ username: "alpha_name", available: false }));
    });
    expect(result.current.status).toEqual({ state: "available", username: "beta_name" });
  });

  it("is not fooled by an answer that names a different username", async () => {
    const late = deferred();
    mockFetch(() => late.promise);
    const { result } = renderHook(() => useUsernameAvailability("rijad"));

    await tick(USERNAME_CHECK_DEBOUNCE_MS);
    await act(async () => {
      late.resolve(jsonResponse({ username: "someone_else", available: true }));
    });

    expect(result.current.status.state).toBe("checking");
  });

  it("reports a failed lookup as an error, never as available", async () => {
    mockFetch(() =>
      jsonResponse({ error: { code: "service_unavailable", message: "Couldn't check." } }, 503),
    );
    const { result } = renderHook(() => useUsernameAvailability("rijad"));

    await tick(USERNAME_CHECK_DEBOUNCE_MS);
    // apiFetch retries a 503 twice; move past both delays.
    await tick(1000);
    expect(result.current.status).toEqual({ state: "error" });
  });

  it("rechecks on demand without changing the value", async () => {
    let available = false;
    const spy = mockFetch((url) => jsonResponse({ username: usernameOf(url), available }));
    const { result } = renderHook(() => useUsernameAvailability("rijad"));

    await tick(USERNAME_CHECK_DEBOUNCE_MS);
    expect(result.current.status).toEqual({ state: "taken" });

    available = true;
    act(() => result.current.recheck());
    // A recheck is immediately "checking", not the previous verdict.
    expect(result.current.status).toEqual({ state: "checking" });
    await tick(USERNAME_CHECK_DEBOUNCE_MS);
    expect(result.current.status).toEqual({ state: "available", username: "rijad" });
    expect(spy).toHaveBeenCalledTimes(2);
  });
});
