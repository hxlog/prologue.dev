/**
 * Parsing for content dates (frontmatter `publishDate` / `lastmod`).
 *
 * These arrive as strings from YAML — `2025-02-15`, `2025-2-15`, or
 * `2026-3-7 12:00` — and `new Date(value)` is NOT safe on them. Only the
 * zero-padded, date-only form is ISO 8601, and only that form is parsed as
 * UTC by specification. Everything else falls back to the engine's
 * implementation-defined parser, which reads the string in the *local* time
 * zone.
 *
 * That matters here because the value flows all the way to a displayed date
 * with no time-zone pinning at the other end:
 *
 *   frontmatter string  ->  Date  ->  Intl.DateTimeFormat("zh-CN")
 *
 * The last step runs in whatever zone the process has. Locally that is
 * Asia/Shanghai; on Vercel it is UTC. So `2025-2-15` became
 * 2025-02-14T16:00Z locally and 2025-02-15T00:00Z on production, and the same
 * post displayed 2025年2月14日 locally and 2025年2月15日 on the live site.
 * Measured: 6 of 63 posts, plus their RSS entries, plus their ordering.
 *
 * The fix is to never let the engine guess. Every accepted form is normalised
 * to an explicit UTC ISO string here, so the produced instant — and therefore
 * the displayed date and the feed `pubDate` — is identical on every machine.
 *
 * `parseContentDate("2025-2-15").toISOString()` is always
 * `"2025-02-15T00:00:00.000Z"`, in Shanghai, in UTC, and in CI.
 */

const DATE_ONLY = /^(\d{4})-(\d{1,2})-(\d{1,2})$/;
const DATE_TIME =
  /^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?$/;

const pad = (n) => String(n).padStart(2, "0");

/**
 * @param {string|Date|null|undefined} value
 * @returns {Date|null} a Date whose instant does not depend on the host zone,
 *   or null if the value is empty or unparseable.
 */
export function parseContentDate(value) {
  if (value == null || value === "") return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;

  const raw = String(value).trim();
  if (raw === "") return null;

  const dateOnly = DATE_ONLY.exec(raw);
  if (dateOnly) {
    const [, y, m, d] = dateOnly;
    // Validate rather than trusting the round-trip: "2025-02-31" would
    // otherwise silently become March 3rd.
    const iso = `${y}-${pad(m)}-${pad(d)}`;
    const parsed = new Date(`${iso}T00:00:00.000Z`);
    if (Number.isNaN(parsed.getTime())) return null;
    if (parsed.toISOString().slice(0, 10) !== iso) return null;
    return parsed;
  }

  const dateTime = DATE_TIME.exec(raw);
  if (dateTime) {
    const [, y, mo, d, h, mi, s] = dateTime;
    const iso = `${y}-${pad(mo)}-${pad(d)}T${pad(h)}:${mi}:${s ? pad(s) : "00"}.000Z`;
    const parsed = new Date(iso);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed;
  }

  // Anything else (a full ISO string with an offset, say) is already
  // unambiguous — hand it to the engine, which handles offsets correctly.
  const fallback = new Date(raw);
  return Number.isNaN(fallback.getTime()) ? null : fallback;
}

/** Format used inside JSON (pg) and JSONB columns. */
export function contentDateISO(value) {
  const date = parseContentDate(value);
  return date ? date.toISOString() : null;
}
