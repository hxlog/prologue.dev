"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";

/**
 * Pending state for tag → tag navigations.
 *
 * /tags has a persistent layout, so switching tags only replaces the title and
 * the card column. That makes the global fixed NavigationSkeleton (which covers
 * the whole viewport under the navbar) the wrong feedback here: it hides the
 * sidebar the reader is still using. This provider instead arms the in-flow
 * skeletons rendered by tag-header.js and tag-content-skeleton.js, and
 * navigation-skeleton.js hands tag → tag clicks off to it.
 *
 * Behaviour, mirroring NavigationSkeleton because the same edge cases apply:
 * - Capture-phase click listener; only a plain left click on a same-origin
 *   anchor that moves between two /tags/* pathnames qualifies (no target/
 *   download/modifier clicks, and not the same pathname/hash-only).
 * - The skeleton is armed after ~140 ms, so a prefetched, instant swap never
 *   flashes it.
 * - The provider itself renders no skeleton markup, so the exported HTML has no
 *   pending marker and hydration cannot flash one.
 * - The pending flag is derived from usePathname() during render: the render
 *   that commits the new route already drops the skeleton, so new content can
 *   never appear under a stale skeleton for a frame. The effects only clear the
 *   stale state value and handle back/forward.
 * - popstate/pageshow hide immediately (the URL moves before the tree is
 *   restored), and an 8 s safety valve keeps a swallowed click from pinning it.
 */
const SHOW_DELAY_MS = 140;
const MAX_VISIBLE_MS = 8000;

const TagPendingContext = createContext(false);

/**
 * True while a /tags/<a> → /tags/<b> client navigation has been pending for
 * more than ~140 ms. False during SSR, so nothing skeleton-shaped is exported.
 */
export function useTagPending() {
  return useContext(TagPendingContext);
}

function normalizePath(pathname) {
  const trimmed = (pathname || "").replace(/\/+$/, "");
  return trimmed || "/";
}

function isTagPath(pathname) {
  return pathname === "/tags" || pathname.startsWith("/tags/");
}

function tagNavigationTarget(event) {
  if (event.defaultPrevented || event.button !== 0) return null;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
    return null;
  }

  const target = event.target;
  const anchor = target instanceof Element ? target.closest("a[href]") : null;
  if (!anchor) return null;
  if (anchor.hasAttribute("download")) return null;

  const anchorTarget = anchor.getAttribute("target");
  if (anchorTarget && anchorTarget !== "_self") return null;

  // A control nested inside a link is not navigation (the card's "+N" tag
  // expander is a <button> inside the stretched card link and calls
  // preventDefault; without this it would arm the skeleton).
  if (target instanceof Element) {
    const control = target.closest(
      "button, input, select, textarea, [role='button']",
    );
    if (control && control !== anchor && anchor.contains(control)) return null;
  }

  let url;
  try {
    url = new URL(anchor.getAttribute("href"), window.location.href);
  } catch {
    return null;
  }
  if (url.origin !== window.location.origin) return null;
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;

  const current = normalizePath(window.location.pathname);
  const next = normalizePath(url.pathname);
  // Both ends must be tag pages: this provider only owns the tag-to-tag swap.
  if (!isTagPath(current) || !isTagPath(next)) return null;
  // Same pathname covers hash-only anchors and query tweaks.
  if (next === current) return null;

  return next;
}

export default function TagPendingProvider({ children }) {
  const pathname = usePathname();
  // The pathname the qualifying click started on, i.e. "this skeleton is only
  // valid while the router still shows that route".
  const [pendingFrom, setPendingFrom] = useState(null);
  const timerRef = useRef(null);

  useEffect(() => {
    const onClick = (event) => {
      if (!tagNavigationTarget(event)) return;

      const startPath = normalizePath(window.location.pathname);
      window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        // The router pushes the URL and renders the new tree together; if the
        // URL already moved, the navigation is not pending any more.
        if (normalizePath(window.location.pathname) !== startPath) return;
        setPendingFrom(startPath);
      }, SHOW_DELAY_MS);
    };

    document.addEventListener("click", onClick, true);
    return () => {
      window.clearTimeout(timerRef.current);
      document.removeEventListener("click", onClick, true);
    };
  }, []);

  // The route committed: the derived flag below already stops painting the
  // skeletons in that render, so this only clears the stale value a tick later.
  // The timeout keeps the setState out of the effect body, where the hooks lint
  // rule forbids it (NavigationSkeleton does the same).
  useEffect(() => {
    window.clearTimeout(timerRef.current);
    timerRef.current = null;
    const timeout = window.setTimeout(() => setPendingFrom(null), 0);
    return () => window.clearTimeout(timeout);
  }, [pathname]);

  // Back/forward moves the URL before the router restores the tree, so a pending
  // skeleton would be covering the page for the wrong reason.
  useEffect(() => {
    const hide = () => {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
      setPendingFrom(null);
    };
    window.addEventListener("popstate", hide);
    window.addEventListener("pageshow", hide);
    return () => {
      window.removeEventListener("popstate", hide);
      window.removeEventListener("pageshow", hide);
    };
  }, []);

  // Safety valve: a click that never becomes a navigation must not pin the
  // skeleton forever.
  useEffect(() => {
    if (pendingFrom === null) return;
    const timeout = window.setTimeout(
      () => setPendingFrom(null),
      MAX_VISIBLE_MS,
    );
    return () => window.clearTimeout(timeout);
  }, [pendingFrom]);

  // Derived during render on purpose: the commit that changes the pathname
  // paints the new page and drops the skeleton in the same frame.
  const pending =
    pendingFrom !== null && normalizePath(pathname) === pendingFrom;

  return (
    <TagPendingContext.Provider value={pending}>
      {children}
    </TagPendingContext.Provider>
  );
}
