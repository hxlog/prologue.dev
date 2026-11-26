"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { tagLabel } from "../../data/tagLabels";

/**
 * Active tag slug from a /tags/<slug> pathname (null elsewhere).
 *
 * The tag list is a closed English-slug taxonomy, but decodeURIComponent is kept
 * so a percent-encoded href can never produce a different active pill than the
 * one the router matched.
 */
function activeTagFromPathname(pathname) {
  const prefix = "/tags/";
  if (!pathname || !pathname.startsWith(prefix)) return null;
  const rest = pathname.slice(prefix.length).replace(/\/+$/, "");
  if (!rest) return null;
  try {
    return decodeURIComponent(rest);
  } catch {
    return rest;
  }
}

/**
 * Persistent tag sidebar for /tags/*.
 *
 * A Client Component only because the active pill has to follow the pathname:
 * the sidebar now lives in src/app/tags/layout.js, which survives a tag switch,
 * so the route can no longer pass `activeTag` down as a prop the way
 * PostsLayout does for /blog. The markup is exactly what PostsLayout rendered
 * (same classes, labels, counts, prefetch={false}) so /blog and /tags stay
 * visually identical.
 */
export default function TagSidebar({ sortedTags = [], tagCounts = {} }) {
  const pathname = usePathname();
  const activeTag = activeTagFromPathname(pathname);

  return (
    <nav
      aria-label="标签"
      className="sticky-below-nav flex flex-wrap gap-1.5 lg:flex-col lg:gap-1"
      data-tag-sidebar="true"
    >
      {sortedTags.map((tag) => {
        const active = tag === activeTag;
        return (
          <Link
            key={tag}
            href={`/tags/${tag}`}
            // 15 sidebar links: prefetching them all competes with the
            // article/card prefetches that actually predict a click.
            prefetch={false}
            aria-current={active ? "page" : undefined}
            data-active={active ? "true" : undefined}
            className="nav-item justify-between gap-1 px-3"
            aria-label={`${tagLabel(tag)}，${tagCounts[tag]} 篇文章`}
          >
            <span>{tagLabel(tag)}</span>
            <span className="text-xs text-faint">{tagCounts[tag]}</span>
          </Link>
        );
      })}
    </nav>
  );
}
