/**
 * Site-wide date formatting (replaces moment.js).
 *
 * Uses the built-in Intl API — zero bundle cost, locale-correct, and works
 * identically in server components (Node ships full ICU) and the browser.
 * Policy: all dates render in Chinese long form (2022年11月21日); anything
 * that includes a clock time renders Beijing time (UTC+8) explicitly.
 *
 * ---------------------------------------------------------------------------
 * Why the date-only formatter pins `timeZone: "UTC"`.
 *
 * Content dates are instants that mean "this calendar day", and the site used
 * to format them in whatever zone the process happened to have. In this
 * checkout that is Asia/Shanghai; on Vercel it is UTC. For a post whose
 * frontmatter reads `publishDate: 2025-2-15` the two disagreed, because
 * `new Date("2025-2-15")` is not ISO 8601 (the month is unpadded) and the
 * engine therefore parsed it in LOCAL time:
 *
 *   here     new Date("2025-2-15")  ->  2025-02-14T16:00Z  ->  2025年2月14日
 *   Vercel   new Date("2025-2-15")  ->  2025-02-15T00:00Z  ->  2025年2月15日
 *
 * The live site is the one that is right — 2025年2月15日 is what the author
 * typed and what readers see today. Dates are now parsed unambiguously in
 * src/lib/content/dates.js, and formatting them in UTC makes that stable: the
 * stored instant is midnight UTC, and noon UTC on the same day is the same
 * calendar day in every zone the site could plausibly run in.
 *
 * Pinning UTC rather than Asia/Shanghai is the safer of the two: a value
 * that reaches here at 00:00Z under a Shanghai-pinned formatter would render
 * as the PREVIOUS day for any reader, and the formatter's zone has to be at
 * least as far west as the parse zone for the round trip to hold. UTC is the
 * parse zone, so the round trip is exact.
 * ---------------------------------------------------------------------------
 */

const longDate = new Intl.DateTimeFormat("zh-CN", {
  dateStyle: "long",
  timeZone: "UTC",
});

const longDateTime = new Intl.DateTimeFormat("zh-CN", {
  dateStyle: "long",
  timeStyle: "short",
  timeZone: "Asia/Shanghai",
});

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
 * 2022年11月21日 20:30（北京时间）
 *
 * Unlike formatDate this keeps the Beijing pin: the value is a genuine clock
 * time, so the zone it is displayed in is meaningful rather than incidental.
 */
export function formatDateTime(dateLike) {
  const date = toDate(dateLike);
  if (Number.isNaN(date.getTime())) return "";
  return `${longDateTime.format(date)}（北京时间）`;
}
