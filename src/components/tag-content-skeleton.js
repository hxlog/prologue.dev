"use client";

import { useTagPending } from "./tag-pending";

// One page of cards (PostGrid's PAGE_SIZE). Filling the column with the same
// number of blocks the real first page shows keeps the skeleton's footprint
// close to the content it replaces on every tag page.
const SKELETON_CARDS = 8;

/**
 * Card skeleton for the /tags content column.
 *
 * Only shown while a tag → tag navigation is pending; absent from the static
 * HTML. It is a skeleton of the *cards*, not of the page: the sidebar, navbar
 * and footer live outside the content column and are never covered.
 */
export default function TagContentSkeleton() {
  return (
    <div className="tag-content-skeleton-grid" aria-hidden="true">
      {Array.from({ length: SKELETON_CARDS }, (_, index) => (
        <div key={index} className="tag-skeleton-card">
          <div className="tag-skeleton-line tag-skeleton-line--meta" />
          <div className="tag-skeleton-line tag-skeleton-line--title" />
          <div className="tag-skeleton-line tag-skeleton-line--title tag-skeleton-line--short" />
          <div className="tag-skeleton-line tag-skeleton-line--body" />
          <div className="tag-skeleton-line tag-skeleton-line--body tag-skeleton-line--narrow" />
        </div>
      ))}
    </div>
  );
}

/**
 * Content-column wrapper for the tag layout.
 *
 * The page slot (`children`) is the router's child segment, so it must stay
 * mounted across a tag switch — unmounting it would unmount the router's child
 * LayoutRouter. The skeleton is therefore a sibling painted above the live
 * content, not a replacement for it. During SSR the pending flag is false, so
 * the exported HTML contains the real cards and no skeleton marker.
 */
export function TagContent({ children }) {
  const pending = useTagPending();

  return (
    <div className="relative" data-tag-content="true">
      {children}
      {pending ? (
        <div
          className="tag-content-skeleton"
          data-tag-content-skeleton="true"
          aria-hidden="true"
        >
          <TagContentSkeleton />
        </div>
      ) : null}
    </div>
  );
}
