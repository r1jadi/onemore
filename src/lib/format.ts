/**
 * Number formatting for the UI.
 *
 * It lives here rather than next to any one feature because every screen that
 * shows a count — scores, followers, comments — wants the same abbreviation, and
 * a shared helper is the only way two screens cannot drift into "1.2K" and
 * "1,200" for the same number.
 *
 * It is deliberately not a general-purpose `Intl` wrapper: the product is a feed
 * of short games where a score is read at a glance, so the compact form (a period
 * as the decimal separator, one decimal place, no trailing `.0`) is a design
 * decision rather than a localisation one.
 */
export const fmt = (n: number): string =>
  n >= 1_000_000
    ? `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`
    : n >= 1000
      ? `${(n / 1000).toFixed(1).replace(/\.0$/, "")}K`
      : `${n}`;

/**
 * A stored timestamp as a short, local date.
 *
 * It returns `undefined` for a missing or unparseable value rather than
 * `Invalid Date`, so a caller can decide to render nothing instead of a broken
 * label — the same rule the rest of the app follows for a value it does not have.
 */
export const fmtDate = (value: string | null | undefined): string | undefined => {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
};
