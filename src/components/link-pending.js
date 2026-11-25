"use client";

import { useLinkStatus } from "next/link";

/**
 * Fixed-size "navigating" hint rendered inside a <Link>. Dynamic static-export
 * routes are not fully prefetched, so a click can wait for the RSC payload; this
 * gives that short wait an intentional UI instead of a dead click.
 */
export default function LinkPending() {
  const { pending } = useLinkStatus();
  return (
    <span
      className="link-pending"
      data-pending={pending ? "true" : undefined}
      aria-hidden="true"
    />
  );
}
