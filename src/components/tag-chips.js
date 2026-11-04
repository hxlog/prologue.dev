"use client";

import Link from "next/link";
import { useState } from "react";
import { tagLabel } from "../../data/tagLabels";

/**
 * Tag chip row with responsive "+N" overflow.
 * - Desktop shows up to 3 chips, mobile up to 2 (two rendered groups).
 * - Clicking "+N" expands the collapsed chips IN PLACE; the expanded chips
 *   are normal links to their tag pages.
 */
export default function TagChips({ tags, className = "" }) {
  const [expanded, setExpanded] = useState(false);

  if (!tags?.length) return null;

  // prefetch={false} on purpose. A tag row is not a "read this next" signal,
  // and every chip used to be prefetch={true}: a page of eight cards issued up
  // to 24 tag-page prefetches for links the reader is unlikely to click.
  const renderChips = (list) =>
    list.map((tag) => (
      <Link key={tag} href={`/tags/${tag}`} prefetch={false} className="chip" title={tag}>
        {tagLabel(tag)}
      </Link>
    ));

  const renderMore = (visibleCount) => {
    const hidden = tags.length - visibleCount;
    if (hidden <= 0 || expanded) return null;
    return (
      <button
        type="button"
        className="chip-more"
        aria-label={`展开其余 ${hidden} 个标签`}
        aria-expanded={expanded}
        onClick={(event) => {
          // The card title's stretched link covers the whole card; a click on
          // +N must expand the chips, not navigate.
          event.preventDefault();
          event.stopPropagation();
          setExpanded(true);
        }}
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
