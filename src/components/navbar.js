import Link from "next/link";
import siteMetadata from "../../data/sitemetadata";
import ThemeSwitch from "./themeswitch";
import MobileNav from "./mobilenav";
import RssModal from "./rss-modal";
import SearchDialog from "./search-dialog";
import NavLinks from "./nav-links";

/**
 * Sticky glass header.
 *
 * Server component. The active-link highlight lives in the client <NavLinks>
 * list; the static export prerenders it per route, so no Suspense boundary is
 * involved.
 *
 * The scroll-elevate shadow is CSS-only (`animation-timeline: scroll()`), not
 * a scroll listener — see `.glass-header` in globals.css.
 */
export default function Navbar() {
  return (
    <header
      className="glass-header sticky top-0 z-40 border-b"
      style={{ height: "var(--nav-height)" }}
    >
      <div className="shell flex h-full items-center justify-between gap-4">
        <Link
          href="/"
          aria-label={siteMetadata.publishName}
          className="select-none rounded-control px-1 py-1"
        >
          <span className="text-gradient text-lg font-semibold tracking-tight">
            {siteMetadata.publishName}
          </span>
        </Link>

        <nav className="hidden items-center gap-0.5 sm:flex">
          <NavLinks />
        </nav>

        {/* Icon toolbar: every button shares the same 36px box and 20px icon
            so heights and baselines line up on one horizontal axis. */}
        <div className="flex items-center gap-0.5 leading-5">
          <SearchDialog />
          <RssModal />
          <MobileNav />
          <ThemeSwitch />
        </div>
      </div>
    </header>
  );
}