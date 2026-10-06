/**
 * Public (browser-visible) configuration.
 *
 * Only values that are safe to ship to every visitor may live here — the Supabase
 * URL and the *publishable* key are fine because Row Level Security enforces
 * access. Anything else (secret key, service role key, JWT secret, database URL
 * with credentials, payment keys) belongs to the server and is read by the Go
 * services from the process environment. Never add a secret to a `VITE_`
 * variable: Vite inlines those into the client bundle.
 *
 * See .env.example for the full list, split into PUBLIC and SERVER sections.
 *
 * Supabase replaced the anon/service_role keys with publishable (`sb_publishable_`)
 * and secret (`sb_secret_`) keys and deprecates the legacy pair. The publishable
 * key is the value this module reads, with the legacy anon name accepted as a
 * fallback so an existing deployment does not break on the rename.
 */

import { SITE_URL } from "./seo";

const DEFAULT_API_PATH = "/api/v1";

function readEnv(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Base URL for the versioned API. Empty configuration means same-origin
 * `/api/v1`, which is how production is expected to be wired (the gateway
 * fronts the web origin); local development points at the gateway directly.
 */
function resolveApiBaseUrl(): string {
  const raw = readEnv(import.meta.env?.["VITE_API_BASE_URL"]);
  if (raw === "") return DEFAULT_API_PATH;
  if (raw.startsWith("/")) return raw.replace(/\/+$/, "");
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" && url.protocol !== "http:") return DEFAULT_API_PATH;
    return url.href.replace(/\/+$/, "");
  } catch {
    return DEFAULT_API_PATH;
  }
}

export const publicConfig = {
  /** Canonical origin, used for canonical links, OG tags and the sitemap. */
  siteUrl: SITE_URL,
  /** Versioned API base (`/api/v1` by default — see docs/architecture/api.md). */
  apiBaseUrl: resolveApiBaseUrl(),
  supabase: {
    url: readEnv(import.meta.env?.["VITE_SUPABASE_URL"]),
    /**
     * Publishable key (`sb_publishable_...`). RLS is the security boundary, not
     * secrecy. `VITE_SUPABASE_ANON_KEY` is the deprecated pre-2026 name and is
     * still honoured so a deployment that has not been renamed keeps working.
     */
    publishableKey:
      readEnv(import.meta.env?.["VITE_SUPABASE_PUBLISHABLE_KEY"]) ||
      readEnv(import.meta.env?.["VITE_SUPABASE_ANON_KEY"]),
  },
} as const;

/** Whether Supabase-backed features can be used in this build. */
export function isSupabaseConfigured(): boolean {
  return publicConfig.supabase.url !== "" && publicConfig.supabase.publishableKey !== "";
}

/**
 * Reads the Supabase client configuration or throws a clear configuration
 * error. Call it from the code path that needs Supabase so the rest of the app
 * keeps working while a deployment still has to be configured.
 */
export function requireSupabaseConfig(): { url: string; publishableKey: string } {
  if (!isSupabaseConfigured()) {
    throw new Error(
      "Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY (see .env.example).",
    );
  }
  return {
    url: publicConfig.supabase.url,
    publishableKey: publicConfig.supabase.publishableKey,
  };
}
