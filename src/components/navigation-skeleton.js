"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

/**
 * Client-navigation skeleton overlay.
 *
 * Every page of the static export is already in the browser, but clicking an
 * internal link still means the App Router has to fetch that route's small RSC
 * payload and swap the tree. Prefetched routes settle in a frame; an uncached
 * one can take a moment, and a click with no feedback reads as a dead click.
 *
 * This used to be "fixed" by navigation-watchdog, which waited 4 s and then
 * forced a *document* navigation — i.e. the whole tab reloaded, which is the
 * bug this file replaces. Nothing here ever issues a document request: it is
 * purely a paint-only overlay.
 *
 * Behaviour:
 * - Capture-phase click listener on document; only a plain left click on a
 *   same-origin anchor that changes the pathname qualifies (no target/download/
 *   modifier/hash-only/same-pathname links).
 * - The overlay is shown after ~140 ms, so the common instant navigation never
 *   flashes it. It is hidden by the same render that paints the next route (the
 *   pathname stops matching the page the click started on), or immediately on
 *   popstate, and it also self-clears after MAX_VISIBLE_MS in case a click never
 *   turns into a navigation (e.g. an anchor whose click a modal swallows).
 * - The server render is null, so the exported HTML contains no skeleton marker
 *   and hydration cannot flash one; the overlay is fixed-position, so covering
 *   and uncovering the page can never shift layout.
 * - When both the current and the target pathname are under /tags, this overlay
 *   stays out of the way: the tag layout is persistent, so TagPendingProvider
 *   paints in-flow title/card skeletons instead of hiding the whole page.
 * - `pointer-events: none` keeps the overlay from eating the reader's next
 *   click (a second click can start a different navigation) and `aria-hidden`
 *   keeps it out of the accessibility tree.
 */
const SHOW_DELAY_MS = 140;
const MAX_VISIBLE_MS = 8000;

function normalizePath(pathname) {
  const trimmed = pathname.replace(/\/+$/, "");
  return trimmed || "/";
}

function isTagPath(pathname) {
  return pathname === "/tags" || pathname.startsWith("/tags/");
}

function navigationTarget(event) {
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

  // A control nested inside a link is not navigation. The card's "+N" tag
  // expander is a <button> inside the stretched card link and calls
  // preventDefault; it must not arm the skeleton.
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
  // Same pathname covers hash-only anchors and query tweaks. This overlay is
  // for page navigations, not for in-page state.
  if (next === current) return null;

  // /tags has its own persistent layout: a tag -> tag switch only replaces the
  // title and the card column, so the in-flow skeletons from
  // src/components/tag-pending.js own that feedback. This fixed overlay covers
  // the whole viewport below the navbar, including the sidebar the reader is
  // still using.
  if (isTagPath(current) && isTagPath(next)) return null;

  return next;
}

export default function NavigationSkeleton() {
  const pathname = usePathname();
  // The pathname the click happened on, i.e. "this overlay is only valid while
  // the router still shows that route". Any commit hides it, whatever the
  // destination ended up being.
  const [pendingFrom, setPendingFrom] = useState(null);
  const timerRef = useRef(null);

  useEffect(() => {
    const onClick = (event) => {
      const next = navigationTarget(event);
      if (!next) return;

      const startPath = normalizePath(window.location.pathname);
      window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        // The router pushes the new URL and renders the new tree together; if
        // the URL already moved, the navigation is not pending any more.
        if (normalizePath(window.location.pathname) !== startPath) return;
        // A modal can swallow an internal link click instead of navigating (the
        // /rss link in /about opens the RSS dialog). An open dialog means the
        // click was handled in-page, so there is no route change to wait for.
        if (document.querySelector('[aria-modal="true"], [role="dialog"]')) {
          return;
        }
        setPendingFrom(startPath);
      }, SHOW_DELAY_MS);
    };

    document.addEventListener("click", onClick, true);
    return () => {
      window.clearTimeout(timerRef.current);
      document.removeEventListener("click", onClick, true);
    };
  }, []);

  // The route committed: the render below already stops painting the overlay
  // (the pathname moved off the one the click started on), so this only clears
  // the stale value a tick later. A zero timeout keeps the setState out of the
  // effect body, where the hooks lint rule forbids it.
  useEffect(() => {
    window.clearTimeout(timerRef.current);
    timerRef.current = null;
    const timeout = window.setTimeout(() => setPendingFrom(null), 0);
    return () => window.clearTimeout(timeout);
  }, [pathname]);

  // Back/forward moves the URL before the router restores the tree, so a
  // pending overlay would be covering the page for the wrong reason.
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
  // overlay forever.
  useEffect(() => {
    if (pendingFrom === null) return;
    const timeout = window.setTimeout(
      () => setPendingFrom(null),
      MAX_VISIBLE_MS,
    );
    return () => window.clearTimeout(timeout);
  }, [pendingFrom]);

  // The route committed: hide in the same render that paints the new page.
  if (pendingFrom === null || normalizePath(pathname) !== pendingFrom) {
    return null;
  }

  return (
    <div className="nav-skeleton" data-nav-skeleton="true" aria-hidden="true">
      <div className="shell nav-skeleton-inner">
        <div className="nav-skeleton-line nav-skeleton-line--eyebrow" />
        <div className="nav-skeleton-line nav-skeleton-line--title" />
        <div className="nav-skeleton-line nav-skeleton-line--title nav-skeleton-line--short" />
        <div className="nav-skeleton-line nav-skeleton-line--body" />
        <div className="nav-skeleton-line nav-skeleton-line--body nav-skeleton-line--narrow" />
        <div className="nav-skeleton-cards">
          <div className="nav-skeleton-card" />
          <div className="nav-skeleton-card" />
          <div className="nav-skeleton-card" />
        </div>
      </div>
    </div>
  );
}
