import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { SocialButtons } from "@/components/auth/AuthLayout";
import { googleAuthorizeUrl } from "@/lib/auth/session";

function base64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function s256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return base64Url(new Uint8Array(digest));
}

beforeEach(() => {
  sessionStorage.clear();
});

afterEach(() => {
  sessionStorage.clear();
});

describe("googleAuthorizeUrl", () => {
  it("builds a complete Supabase PKCE authorize URL", async () => {
    const raw = await googleAuthorizeUrl("/");
    const url = new URL(raw);

    expect(`${url.origin}${url.pathname}`).toBe("https://project.supabase.co/auth/v1/authorize");
    expect(url.searchParams.get("provider")).toBe("google");
    // A redirect carries no headers, so the public key must travel as a param.
    expect(url.searchParams.get("apikey")).toBe("sb_publishable_test_value");
    expect(url.searchParams.get("code_challenge_method")).toBe("s256");

    const redirectTo = new URL(url.searchParams.get("redirect_to") ?? "");
    expect(redirectTo.pathname).toBe("/auth/callback");
    expect(redirectTo.searchParams.get("next")).toBe("/");
  });

  it("binds the challenge to a fresh stored verifier and keeps the next page", async () => {
    const raw = await googleAuthorizeUrl("/settings/connected");
    const url = new URL(raw);

    const verifier = sessionStorage.getItem("onemore-oauth-verifier");
    expect(verifier).toBeTruthy();
    expect(url.searchParams.get("code_challenge")).toBe(await s256(verifier ?? ""));

    const redirectTo = new URL(url.searchParams.get("redirect_to") ?? "");
    expect(redirectTo.searchParams.get("next")).toBe("/settings/connected");
  });

  it("stores a fresh verifier per call (single-use)", async () => {
    await googleAuthorizeUrl("/");
    const first = sessionStorage.getItem("onemore-oauth-verifier");
    await googleAuthorizeUrl("/");
    const second = sessionStorage.getItem("onemore-oauth-verifier");
    expect(first).toBeTruthy();
    expect(second).toBeTruthy();
    expect(second).not.toBe(first);
  });
});

describe("SocialButtons", () => {
  it("offers Google only — no Apple button remains", () => {
    render(<SocialButtons />);

    expect(screen.getByRole("button", { name: "Continue with Google" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Continue with Apple" })).not.toBeInTheDocument();
    expect(screen.queryByText(/Apple sign-in/i)).not.toBeInTheDocument();
  });
});
