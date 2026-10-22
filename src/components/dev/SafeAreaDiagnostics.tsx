import { useEffect, useState } from "react";

import { readWithLegacy, removeWithLegacy, safeLocalStorage } from "@/lib/storage";

/**
 * Development-only safe-area/PWA diagnostics overlay.
 *
 * Rendered only when `import.meta.env.DEV` is true (Vite statically replaces
 * the flag, so this module — and its import site in `__root` — is
 * dead-code-eliminated from production builds) AND diagnostics were requested
 * via `?diag=safe-area` once (persisted to localStorage, because iOS does not
 * reliably keep the query string on the Home-Screen start URL) or an existing
 * localStorage flag. `?diag=off` clears the flag again.
 *
 * Nothing here affects layout: all probes are fixed, pointer-transparent,
 * zero-size elements that are removed with the panel.
 */
const FLAG = "unbored-diag-safe-area";
/** Pre-rename key: read once and moved forward by `readWithLegacy`. */
const LEGACY_FLAG = "onemore-diag-safe-area";

export function SafeAreaDiagnostics() {
  const [enabled, setEnabled] = useState(false);
  const [readings, setReadings] = useState<Record<string, string>>({});
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    let params: URLSearchParams;
    try {
      params = new URLSearchParams(window.location.search);
    } catch {
      return;
    }
    if (params.has("diag") && params.get("diag") !== "safe-area") {
      // Both keys: a stale legacy copy would re-enable the panel.
      removeWithLegacy(safeLocalStorage(), FLAG, LEGACY_FLAG);
      setEnabled(false);
      return;
    }
    let want = params.get("diag") === "safe-area";
    if (want) {
      try {
        window.localStorage.setItem(FLAG, "1");
      } catch {
        /* storage unavailable */
      }
    } else {
      want = readWithLegacy(safeLocalStorage(), FLAG, LEGACY_FLAG) === "1";
    }
    if (!want) return;
    setEnabled(true);

    const read = () => {
      const next = collect();
      setReadings(next);
      console.table(next);
    };
    read();
    window.addEventListener("resize", read);
    window.visualViewport?.addEventListener("resize", read);
    return () => {
      window.removeEventListener("resize", read);
      window.visualViewport?.removeEventListener("resize", read);
    };
  }, []);

  if (!import.meta.env.DEV || !enabled) return null;

  return (
    <div
      data-diag="safe-area-panel"
      className="fixed top-2 left-2 z-[100] max-h-[80dvh] w-[320px] overflow-y-auto rounded-lg border border-border bg-background/95 p-3 font-mono text-[11px] leading-relaxed text-foreground shadow-xl"
    >
      <p className="mb-2 font-sans text-xs font-semibold">safe-area diagnostics (dev only)</p>
      <button
        type="button"
        className="mb-2 w-full rounded-md bg-surface-2 px-2 py-1.5 font-sans text-xs font-medium"
        onClick={() => {
          const payload = JSON.stringify(readings, null, 1);
          const done = () => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 2000);
          };
          try {
            const p = navigator.clipboard?.writeText(payload);
            if (p && typeof (p as Promise<void>).then === "function") {
              (p as Promise<void>).then(done, () => setCopied(false));
            } else {
              done();
            }
          } catch {
            setCopied(false);
          }
        }}
      >
        {copied ? "Copied ✓ (paste it back to us)" : "Copy values as JSON"}
      </button>
      <dl>
        {Object.entries(readings).map(([k, v]) => (
          <div key={k} className="flex justify-between gap-2 border-b border-border/50 py-0.5">
            <dt className="shrink-0 text-muted-foreground">{k}</dt>
            <dd className="truncate text-right">{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** Probe `env()` as the browser actually resolves it (0px when unsupported). */
function probeEnv(): Record<string, string> {
  const el = document.createElement("div");
  el.setAttribute("aria-hidden", "true");
  el.style.cssText =
    "position:fixed;top:0;left:0;width:0;height:0;pointer-events:none;" +
    "padding-top:env(safe-area-inset-top);padding-right:env(safe-area-inset-right);" +
    "padding-bottom:env(safe-area-inset-bottom);padding-left:env(safe-area-inset-left);";
  document.documentElement.appendChild(el);
  const cs = getComputedStyle(el);
  const out = {
    "env(top)": cs.paddingTop,
    "env(right)": cs.paddingRight,
    "env(bottom)": cs.paddingBottom,
    "env(left)": cs.paddingLeft,
  };
  el.remove();
  return out;
}

function rectOf(el: Element | null): string {
  if (!el) return "not-found";
  const r = el.getBoundingClientRect();
  const fmt = (n: number) => (Number.isFinite(n) ? Math.round(n * 10) / 10 : String(n));
  return `t${fmt(r.top)} l${fmt(r.left)} b${fmt(r.bottom)} h${fmt(r.height)}`;
}

function collect(): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    const navs = Array.from(document.querySelectorAll('nav[aria-label="Main"]'));
    const mobileNav =
      (navs.find((n) => getComputedStyle(n).position === "fixed") as HTMLElement | undefined) ??
      null;
    const feedTabs = document.querySelector('[aria-label="Feed"]');
    const header = document.querySelector("header");
    const main = document.querySelector("main");
    const vv = window.visualViewport;

    out["ua"] = navigator.userAgent.slice(0, 80);
    out["navigator.standalone"] = String(
      (navigator as Navigator & { standalone?: boolean }).standalone ?? "undefined",
    );
    out["display-mode: standalone"] = String(
      window.matchMedia("(display-mode: standalone)").matches,
    );
    out["display-mode: fullscreen"] = String(
      window.matchMedia("(display-mode: fullscreen)").matches,
    );
    out["viewport meta"] =
      document.querySelector('meta[name="viewport"]')?.getAttribute("content") ?? "missing";
    Object.assign(out, probeEnv());
    out["window.innerHeight"] = String(window.innerHeight);
    out["documentElement.clientHeight"] = String(document.documentElement.clientHeight);
    out["visualViewport.height"] = vv ? String(Math.round(vv.height)) : "unsupported";
    out["visualViewport.offsetTop"] = vv ? String(Math.round(vv.offsetTop)) : "unsupported";
    out["screen.height"] = String(window.screen?.height ?? "n/a");
    out["devicePixelRatio"] = String(window.devicePixelRatio);
    if (mobileNav) {
      const cs = getComputedStyle(mobileNav);
      out["nav.position"] = cs.position;
      out["nav.display"] = cs.display;
      out["nav.bottom"] = cs.bottom;
      out["nav.paddingBottom"] = cs.paddingBottom;
      // A fixed element with a non-null offsetParent is contained by a
      // transformed/filtered ancestor: `bottom:0` then anchors to that
      // ancestor, not the viewport — the classic "fixed is broken" cause.
      out["nav.offsetParent"] = mobileNav.offsetParent
        ? (mobileNav.offsetParent as HTMLElement).tagName +
          "." +
          ((mobileNav.offsetParent as HTMLElement).className?.toString?.().slice(0, 40) ?? "")
        : "null (viewport-anchored)";
      out["nav.rect"] = rectOf(mobileNav);
      out["nav.gapBelowViewport"] =
        cs.display === "none"
          ? "n/a (hidden)"
          : String(Math.round(window.innerHeight - mobileNav.getBoundingClientRect().bottom)) +
            "px";
    } else {
      out["nav.rect"] = "not-found";
    }
    // Feed header: the padded inner bar carries the top safe-area offset,
    // the fixed outer wrapper is the positioning context.
    const feedInner = feedTabs?.parentElement as HTMLElement | null;
    const feedOuter = (feedInner?.closest("div.fixed") as HTMLElement | null) ?? null;
    out["feedBar.rect"] = rectOf(feedInner);
    out["feedBar.paddingTop"] = feedInner ? getComputedStyle(feedInner).paddingTop : "n/a";
    out["feedWrap.rect"] = rectOf(feedOuter);
    out["header.rect"] = rectOf(header);
    out["header.paddingTop"] = header ? getComputedStyle(header).paddingTop : "n/a";
    out["main.rect"] = rectOf(main);
  } catch (err) {
    out["error"] = err instanceof Error ? err.message : String(err);
  }
  return out;
}
