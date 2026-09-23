import { ViewTransition } from "react";

/**
 * Route-change motion.
 *
 * Every page on this site is static and prefetched, so a navigation resolves
 * in the same commit as the click: the old tree is replaced by the new one
 * with no gap to fill. That rules out `loading.js` — measured on this codebase,
 * a `loading.js` for /blog moved the real page into a `<div hidden>` behind
 * JavaScript (+8.2 KB raw, +1.0 KB gzipped per page, and a JS-less reader got
 * skeletons instead of the article), while the fallback could never actually
 * show because there is nothing to suspend on.
 *
 * What is worth animating is the swap itself, and that is what `<ViewTransition>`
 * does. This wrapper supplies the exit half only: the outgoing page fades out
 * over 0.45 s (see `::view-transition-old(.page-exit)` in globals.css) while
 * the incoming page runs its own `.page-enter` fade. The two overlap into a
 * crossfade.
 *
 * `exit` and not `enter` is the point. `.page-enter` already fades every page
 * in on first paint, and a first paint is not a Transition, so a
 * `<ViewTransition enter=...>` would not run there — adding one would mean two
 * competing fade-ins on navigation and still none on load. Playing only the
 * exit keeps exactly one animation per direction, and keeps the LCP behaviour
 * that `.page-enter` was introduced for.
 *
 * `default="none"` keeps this quiet during transitions it has nothing to do
 * with — most importantly the theme toggle, which runs its own view transition
 * and would otherwise drag a page fade along with the colour swap.
 *
 * Put this in a `page.js`, never a `layout.js`: layouts persist across
 * navigations, so their exit never fires.
 *
 * No feature detection is needed. A browser without the View Transitions API,
 * and a reader with `prefers-reduced-motion`, both render the same tree with
 * the animation skipped.
 */
export default function RouteTransition({ children }) {
  return (
    <ViewTransition exit="page-exit" default="none">
      {children}
    </ViewTransition>
  );
}
