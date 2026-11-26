"use client";

import { usePathname } from "next/navigation";
import { tagLabel } from "../../data/tagLabels";
import { useTagPending } from "./tag-pending";

/** Current tag slug from a /tags/<slug> pathname (null elsewhere). */
function tagFromPathname(pathname) {
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
 * Persistent tag-page header for /tags/*.
 *
 * The header lives in the shared src/app/tags/layout.js, so it cannot receive
 * the active slug through params/props; it derives the slug, label and count
 * from usePathname() instead. Client Component hooks are resolved during the
 * per-route build, so the exported HTML already carries the real title (same
 * mechanism as the navbar's aria-current), and hydration has nothing to change.
 *
 * While a tag switch is pending the real header stays mounted and an opaque
 * skeleton overlay is painted on top of it. The overlay is absolutely
 * positioned, so it cannot shift layout either when it appears or when it is
 * removed by the same render that commits the new title.
 */
export default function TagHeader({ tagCounts = {} }) {
  const pathname = usePathname();
  const slug = tagFromPathname(pathname);
  const label = slug ? tagLabel(slug) : "";
  const count = slug ? (tagCounts[slug] ?? 0) : 0;
  const pending = useTagPending();

  return (
    <header className="relative pt-12" data-tag-header="true">
      {/* The count is the label: on an archive it is the one fact the reader
          wants before scrolling. */}
      <p className="eyebrow">{count} 篇文章</p>
      <h1 className="mt-2 text-h1 font-semibold tracking-tight text-foreground">
        标签
        {slug ? <span className="text-gradient"> · {label}</span> : null}
      </h1>
      <p className="mt-2 text-sm text-muted">
        「{label}」下共有 {count} 篇文章
      </p>
      {pending ? (
        <div
          className="tag-header-skeleton"
          data-tag-header-skeleton="true"
          aria-hidden="true"
        >
          <div className="tag-header-skeleton-line tag-header-skeleton-line--eyebrow" />
          <div className="tag-header-skeleton-line tag-header-skeleton-line--title" />
          <div className="tag-header-skeleton-line tag-header-skeleton-line--subtitle" />
        </div>
      ) : null}
    </header>
  );
}
