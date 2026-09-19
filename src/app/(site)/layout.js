import dynamic from "next/dynamic";
import Navbar from "../../components/navbar";
import Footer from "../../components/footer";
import UmamiAnalytics from "../../components/umami-analytics";
import { getSiteYear } from "../../lib/site-year";

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
 */
export default async function SiteLayout({ children }) {
  // Read here, not in <Footer>: the footer is a client component and cannot
  // open a 'use cache' boundary, and the year is an unstable value that must
  // not be read directly during prerender. See src/lib/site-year.js.
  const year = await getSiteYear();

  return (
    <>
      <Navbar />
      <div className="max-w-7xl mx-auto px-6">
        <main>{children}</main>
        <Footer year={year} />
      </div>
      <ImageLightbox />
      <UmamiAnalytics />
    </>
  );
}
