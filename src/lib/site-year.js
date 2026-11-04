import { cacheLife } from "next/cache";
import { yearInBeijing } from "./date";

/**
 * The site's current year, for the footer copyright.
 *
 * `new Date()` is synchronous IO: Cache Components refuses to prerender a
 * component that calls it (`blocking-prerender-current-time`). The documented
 * escape hatch is exactly this shape -- run the non-deterministic read inside
 * a `'use cache'` function so the value is captured at a build/revalidation
 * boundary and every reader within that window sees the same year.
 *
 * It cannot run at request time either: the footer is in the root layout, and
 * making the layout request-bound would leave the App Shell with no footer on
 * every route. A cache lifetime of one day (with a week before the entry is
 * discarded) means the year flips at most a day after New Year in Beijing,
 * and a stale deploy is corrected on its next revalidation -- the footer date
 * is not content that must be exact to the minute.
 */
export async function getSiteYear() {
  "use cache";
  cacheLife("days");
  return yearInBeijing();
}
