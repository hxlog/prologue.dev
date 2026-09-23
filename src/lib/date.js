/**
 * Site-wide date formatting (replaces moment.js).
 *
 * Uses the built-in Intl API — zero bundle cost, locale-correct, and works
 * identically in server components (Node ships full ICU) and the browser.
 * Policy: dates render in Chinese long form (2022年11月21日). A frontmatter
 * value that carries a clock time is pinned to Beijing time (UTC+8) upstream,
 * in `canonicalDate()` (src/lib/content/load.js), so the instant itself is
 * host-independent rather than merely displayed in one zone here.
 */

const longDate = new Intl.DateTimeFormat("zh-CN", { dateStyle: "long" });

function toDate(dateLike) {
  return dateLike instanceof Date ? dateLike : new Date(dateLike);
}

/** 2022年11月21日 */
export function formatDate(dateLike) {
  const date = toDate(dateLike);
  if (Number.isNaN(date.getTime())) return "";
  return longDate.format(date);
}

/** Current year, e.g. for the footer copyright. */
export function currentYear() {
  return new Date().getFullYear();
}
