import dynamic from "next/dynamic";
import Navbar from "../../components/navbar";
import Footer from "../../components/footer";
import UmamiAnalytics from "../../components/umami-analytics";
import { getSiteYear } from "../../lib/site-year";
import { getNavItems } from "../../lib/content/nav";

const ImageLightbox = dynamic(() => import("../../components/ImageLightbox"));

/**
 * Everything a *reader* sees and nothing an author needs.
 *
 * The theme provider lives in the root layout, not here, because /studio uses
 * the same design tokens and must honour the same light/dark choice.
 *
 * `dynamic()` on the lightbox keeps it out of the initial bundle on every
 * public page. It is mounted here rather than in the root layout so that
 * /studio never downloads it: the admin area has no lightbox-enabled images,
 * and mounting a DOM scanner there would do nothing but cost bytes.
 *
 * Umami is likewise reader-only. Loading the analytics script inside the
 * admin area would have the author's own editing session counted as traffic,
 * and /studio is where view counts are *read* — the two must not be the same
 * surface.
 *
 * ## Why the nav is fetched HERE
 *
 * `Navbar` is a Client Component — it tracks scroll position and the current
 * path — so it cannot read the database. The header's links live in
 * `nav_items` (the author reorders them from /studio), so the read happens in
 * this Server Component and is passed down. The alternative, a Route Handler
 * the navbar fetches on mount, would render a header with no links in the first
 * HTML every reader receives.
 *
 * `getNavItems` is cached and tagged `nav`, so this costs one query per cache
 * window rather than one per request — and the layout is where that matters
 * most, since it wraps every route on the site.
 */
export default async function SiteLayout({ children }) {
  // Read here, not in <Footer>: the footer is a client component and cannot
  // open a 'use cache' boundary, and the year is an unstable value that must
  // not be read directly during prerender. See src/lib/site-year.js.
  const [year, navItems] = await Promise.all([getSiteYear(), getNavItems()]);

  return (
    <>
      <Navbar items={navItems} />
      <div className="max-w-7xl mx-auto px-6">
        <main>{children}</main>
        <Footer year={year} />
      </div>
      <ImageLightbox />
      <UmamiAnalytics />
    </>
  );
}
