import { describe, expect, it } from "vitest";

import { absoluteUrl, isIndexable, normalizePath, rootSeo, seo } from "@/lib/seo";

describe("indexability allowlist", () => {
  it("indexes public routes", () => {
    for (const path of [
      "/",
      "/explore",
      "/popular",
      "/new",
      "/trending",
      "/recent",
      "/categories",
      "/leaderboards",
      "/welcome",
      "/login",
      "/signup",
      "/privacy",
      "/terms",
      "/categories/puzzle",
      "/games/stack-10",
    ]) {
      expect(isIndexable(path), path).toBe(true);
    }
  });

  it("refuses to index account, admin, session and search routes", () => {
    for (const path of [
      "/admin",
      "/admin/users",
      "/settings",
      "/notifications",
      "/activity",
      "/following",
      "/likes",
      "/saved",
      "/profile",
      "/play/stack-10",
      "/results/stack-10",
      "/onboarding",
      "/search",
      "/forgot-password",
      "/reset-password",
      "/verify-email",
      "/account-created",
      "/games/../admin",
      "/unknown-new-route",
    ]) {
      expect(isIndexable(path), path).toBe(false);
    }
  });

  it("ignores query strings, trailing slashes and casing", () => {
    expect(normalizePath("/Explore?tab=1")).toBe("/explore");
    expect(isIndexable("/explore/?utm_source=x")).toBe(true);
    expect(isIndexable("/ADMIN/users")).toBe(false);
  });
});

describe("rootSeo", () => {
  it("emits a self-referencing canonical URL for the home page", () => {
    const { links } = rootSeo("/");

    expect(links[0]).toEqual({ rel: "canonical", href: `${absoluteUrl("/")}` });
  });

  it("emits noindex for private routes", () => {
    const { meta, scripts } = rootSeo("/settings");

    expect(meta).toContainEqual({ name: "robots", content: "noindex, nofollow" });
    expect(scripts).toBeUndefined();
  });

  it("emits site structured data only on indexable routes", () => {
    const { scripts } = rootSeo("/explore");

    expect(scripts?.length).toBeGreaterThan(0);
    for (const script of scripts ?? []) {
      expect(script.type).toBe("application/ld+json");
      expect(() => JSON.parse(script.children)).not.toThrow();
    }
  });
});

describe("seo", () => {
  it("keeps the existing title format", () => {
    const { meta } = seo("Explore", "Discover games.");

    expect(meta).toContainEqual({ title: "Explore — onemore" });
    expect(meta).toContainEqual({ property: "og:title", content: "Explore — onemore" });
  });

  it("supports explicit noindex pages", () => {
    const { meta } = seo("Admin", "Moderation.", { indexable: false });

    expect(meta).toContainEqual({ name: "robots", content: "noindex, nofollow" });
  });

  it("serialises JSON-LD safely", () => {
    const { scripts } = seo("Explore", "Discover games.", {
      jsonLd: { "@type": "CollectionPage" },
    });

    expect(scripts?.[0].type).toBe("application/ld+json");
    expect(JSON.parse(scripts?.[0].children ?? "{}")).toEqual({ "@type": "CollectionPage" });
  });
});
