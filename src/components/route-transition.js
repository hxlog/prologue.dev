import { ViewTransition } from "react";

/**
 * Route-change motion.
 *
 * Every page on this site is static and prefetched, so a navigation resolves
 * in the same commit as the click: the old tree is replaced by the new one
 * with no gap to fill. That rules out `loading.js` as a transition mechanism —
 * and argues against it outright: per the Next 16 docs (prefetching.md:59-62) a
 * route *with* a `loading.js` prefetches only "layout to first loading
 * boundary" with the client cache TTL "off by default", where a route without
 * one prefetches the "entire page" for 5 minutes. Adding one would cancel the
 * prefetch that makes these navigations instant, then hide the round-trip it
 * creates behind a skeleton. (Measured here too: a `loading.js` for /blog moved
 * the real page into a `<div hidden>` behind JavaScript, +1.0 KB gzipped per
 * page, with no `<noscript>` fallback.)
 *
 * What is worth animating is the swap itself, and `<ViewTransition>` is the
 * documented tool for it (view-transitions.md:112: "The morph plays when the
 * destination content renders in the same commit as the navigation, which is
 * the case with prefetched (cached) pages").
 *
 * Both halves are named, and they are deliberately asymmetric:
 *
 *   exit  — `.page-exit`, 150 ms. A route change is something the reader asked
 *           for and is already waiting on, so the old page gets out of the way
 *           briskly rather than lingering.
 *   enter — `.page-enter-fade`, 260 ms with a 6 px rise. Longer than the exit,
 *           which is what makes the handoff read as a crossfade instead of a
 *           wash: at the midpoint only the incoming page is mid-opacity, where
 *           equal durations leave *both* layers at ~50% and the page background
 *           shows through two translucent copies at once.
 *
 * Naming BOTH halves is also the part that makes the enter reliable. Until this
 * change the incoming page faded in only via the `.page-enter` CSS animation on
 * mount, which a transition does not guarantee: React can reuse an element of
 * the same type in the same position, and CSS does not restart an animation on a
 * node that was never removed, so on those navigations the outgoing page faded
 * while the incoming one appeared instantly. A `::view-transition-new` snapshot
 * exists on every transition by construction, so this half cannot be skipped.
 * `.page-enter` stays for the *first paint*, which is not a Transition and so
 * gets no view-transition snapshot at all.
 *
 * `default="none"` keeps this quiet during transitions it has nothing to do
 * with — most importantly the theme toggle, which runs its own view transition
 * and would otherwise drag a page fade along with the colour swap.
 *
 * Put this in a `page.js`, never a `layout.js`: layouts persist across
 * navigations, so their exit never fires. (The Next docs say the same at
 * view-transitions.md:268.)
 *
 * The chrome is deliberately outside all of this. Snapshots only cover what is
 * inside this wrapper, and the navbar and footer live in `layout.js` around
 * `<main>`, so they hold still while the content beneath them crossfades — the
 * same division of labour nextjs.org uses, where the header is the stable frame
 * and only the content area moves.
 *
 * No feature detection is needed. A browser without the View Transitions API,
 * and a reader with `prefers-reduced-motion`, both render the same tree with
 * the animation skipped.
 */
export default function RouteTransition({ children }) {
  return (
    <ViewTransition exit="page-exit" enter="page-enter-fade" default="none">
      {children}
    </ViewTransition>
  );
}
