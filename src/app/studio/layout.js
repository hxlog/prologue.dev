/**
 * The studio's outermost layout.
 *
 * Almost empty, and that is the point. Two layouts exist under /studio because
 * the shell needs a signed-in user and the sign-in page does not:
 *
 *   /studio/login      — this layout, and nothing else.
 *   /studio/(app)/*    — this layout, then the shell from (app)/layout.js.
 *
 * Putting the shell check here would be circular: requiring a session to render
 * the page whose job is to create one means the author can never reach it.
 *
 * `robots` is set again here rather than relying on the root layout's rule.
 * /studio is the one part of the site that must not be indexed under any
 * circumstance, and an explicit local rule survives someone later narrowing the
 * global one.
 */

export const metadata = {
  title: {
    default: "Studio",
    template: "%s · Prologue Studio",
  },
  robots: { index: false, follow: false },
};

export default function StudioLayout({ children }) {
  return children;
}
