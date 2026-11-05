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

/**
 * "约 8 分钟" — the one reading-time label used by cards, the post header and
 * the OG card.
 *
 * `reading-time` reports `{ text: "1 min read", minutes, words, time }`; its
 * built-in English label is the only piece the site does not want. Minutes are
 * rounded up with a floor of 1: a 12-second note should not read "约 0 分钟",
 * and the loader's wordsPerMinute (1000 CJK characters) makes sub-minute
 * estimates common for short posts.
 */
export function readingTimeLabel(readingTime) {
  if (!readingTime) return "";
  const minutes = Math.max(1, Math.ceil(readingTime.minutes ?? 1));
  return `约 ${minutes} 分钟`;
}

/**
 * Month/day + year for the microblog timeline rail: "Oct. 4" and "2026".
 *
 * The day is intentionally not zero-padded ("Oct. 4", not "Oct. 04"); May is
 * the one English month written without a trailing period. Split into two
 * lines by the rail, so the parts are returned separately instead of one
 * formatted string. Asia/Shanghai is pinned for the same reason as
 * yearInBeijing(): the site's dates are Beijing dates regardless of where the
 * build or the reader runs.
 */
const railDate = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "short",
  day: "numeric",
});

export function formatRailDate(dateLike) {
  const date = toDate(dateLike);
  if (Number.isNaN(date.getTime())) return { monthDay: "", year: "" };
  const parts = {};
  for (const part of railDate.formatToParts(date)) {
    if (part.type !== "literal") parts[part.type] = part.value;
  }
  const month = parts.month === "May" ? "May" : `${parts.month}.`;
  return { monthDay: `${month} ${parts.day}`, year: parts.year };
}

/** The year in Beijing time for a given instant (defaults to now). */
export function yearInBeijing(now = new Date()) {
  return Number(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
    }).format(now)
  );
}
