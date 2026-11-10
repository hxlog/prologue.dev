import { cacheLife, cacheTag } from "next/cache";
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
 * every route. The lifetime is the same "max" profile the content caches use,
 * so the year is refreshed by any deploy and, at worst, a month later; a footer
 * copyright line does not need to be exact to the day.
 */
export async function getSiteYear() {
  "use cache";
  // "days" here is not a local decision: this value is read by the footer, which
  // the root layout renders, and Next sets a route's revalidate to the SHORTEST
  // window among every cache it contains. A one-day profile therefore pinned all
  // 87 page routes to a daily re-render -- 2,600 full page renders a month for a
  // footer that changes once a year. "max" (30 days) matches the content cache
  // and still corrects the year on the next deploy, or within a month.
  cacheLife("max");
  cacheTag("site-year");
  return yearInBeijing();
}
