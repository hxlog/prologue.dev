/**
 * On-mount entrance for page content. Implemented as a pure CSS animation
 * (`.page-enter` in globals.css) that runs at first paint — no JavaScript and
 * no hydration gate. This keeps the LCP element visible from the moment the
 * static HTML arrives instead of waiting for the framer-motion bundle to
 * hydrate (the previous implementation server-rendered `opacity: 0` and only
 * revealed content after hydration, which gated LCP/FCP on ~360KB of JS).
 *
 * Intentionally opacity-only (no transform/filter): those create a CSS
 * containing block that would break `position: sticky` descendants such as
 * the homepage's pinned search bar.
 */
export default function PageTransition({ children, className }) {
  return (
    <div className={`page-enter ${className || ""}`.trim()}>{children}</div>
  );
}
