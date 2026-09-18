"use client";

import Link from "next/link";
import { useState } from "react";
import { tagLabel } from "../../data/tagLabels";

/**
 * Tag chip row with responsive "+N" overflow.
 * - Desktop shows up to 3 chips, mobile up to 2 (two rendered groups).
 * - Clicking "+N" expands the collapsed chips IN PLACE; the expanded chips
 *   are normal links to their tag pages.
 *
 * `labels` comes from the server (the `tags` table, editable in /studio). It
 * falls back to the static map in data/tagLabels.js, which matters because this
 * is a client component rendered inside another client component's tree — a
 * caller that forgets the prop gets the built-in labels rather than raw English
 * slugs on the page.
 */
export default function TagChips({ tags, className = "", labels }) {
  const [expanded, setExpanded] = useState(false);

  if (!tags?.length) return null;

  const label = (tag) => labels?.[tag] || tagLabel(tag);

  const renderChips = (list) =>
    list.map((tag) => (
      <Link key={tag} href={`/tags/${tag}`} className="pill" title={tag}>
        {label(tag)}
      </Link>
    ));

  const renderMore = (visibleCount) => {
    const hidden = tags.length - visibleCount;
    if (hidden <= 0 || expanded) return null;
    return (
      <button
        type="button"
        className="pill-more"
        aria-label={`展开其余 ${hidden} 个标签`}
        onClick={() => setExpanded(true)}
      >
        +{hidden}
      </button>
    );
  };

  return (
    <span className={`inline-flex flex-wrap items-center gap-1.5 ${className}`}>
      {/* Desktop: 3 visible */}
      <span className="hidden items-center gap-1.5 sm:inline-flex">
        {expanded ? renderChips(tags) : renderChips(tags.slice(0, 3))}
        {renderMore(3)}
      </span>
      {/* Mobile: 2 visible */}
      <span className="inline-flex items-center gap-1.5 sm:hidden">
        {expanded ? renderChips(tags) : renderChips(tags.slice(0, 2))}
        {renderMore(2)}
      </span>
    </span>
  );
}
