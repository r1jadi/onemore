import "@testing-library/jest-dom/vitest";

// Public configuration has to be deterministic: a local `.env.local` is not
// present on a fresh checkout or in CI, and code that builds a Supabase URL (an
// avatar, for instance) needs a value a test can assert against.
vi.stubEnv("VITE_SUPABASE_URL", "https://project.supabase.co");
vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test_value");

Object.defineProperty(window, "scrollTo", {
  writable: true,
  value: () => {},
});

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => {},
  }),
});
