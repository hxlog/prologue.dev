/**
 * Suspense fallbacks for the catch-all routes.
 *
 * These only appear when a navigation resolves before its content does: the
 * routes are statically prerendered per path, so a normal in-app navigation has
 * the data already. They exist because Cache Components requires a boundary
 * around the params read, not because a spinner is desirable.
 *
 * Deliberately static -- no pulse, no shimmer. A skeleton that animates draws
 * the eye to the one thing the reader cannot use yet, and it would run on every
 * cold paint for no benefit.
 *
 * ALL THREE RESERVE A VIEWPORT OF HEIGHT, AND THAT IS A CLS FIX, NOT PADDING.
 * A prerendered route ships the shell with the fallback in place and the real
 * content in a hidden streamed div that inline JS moves into position on
 * hydration. The footer sits directly under <main>, so a skeleton shorter than
 * the viewport leaves the footer *visible* during that swap: it then drops
 * ~20 000px, and Chrome scores exactly that as one layout shift (measured 0.207
 * on an article page, footer going from y=464 to below the fold). Reserving a
 * viewport height keeps the footer below the fold for the whole swap, so the
 * movement is off-screen and scores 0.
 */
export function ArticleSkeleton() {
  return (
    <div
      className="mx-auto min-h-dvh w-full max-w-3xl py-8"
      aria-hidden="true"
      data-testid="article-skeleton"
    >
      <div className="h-3 w-40 rounded-pill bg-surface-2" />
      <div className="mt-6 h-9 w-4/5 rounded-control bg-surface-2" />
      <div className="mt-3 h-9 w-3/5 rounded-control bg-surface-2" />
      <div className="mt-8 space-y-3">
        <div className="h-4 w-full rounded-control bg-surface-2" />
        <div className="h-4 w-11/12 rounded-control bg-surface-2" />
        <div className="h-4 w-4/5 rounded-control bg-surface-2" />
        <div className="h-4 w-full rounded-control bg-surface-2" />
        <div className="h-4 w-2/3 rounded-control bg-surface-2" />
      </div>
    </div>
  );
}

export function PageSkeleton() {
  return (
    <div
      className="mx-auto min-h-dvh w-full max-w-3xl py-8"
      aria-hidden="true"
      data-testid="page-skeleton"
    >
      <div className="h-9 w-1/2 rounded-control bg-surface-2" />
      <div className="mt-6 space-y-3">
        <div className="h-4 w-full rounded-control bg-surface-2" />
        <div className="h-4 w-10/12 rounded-control bg-surface-2" />
        <div className="h-4 w-full rounded-control bg-surface-2" />
        <div className="h-4 w-3/4 rounded-control bg-surface-2" />
      </div>
    </div>
  );
}

export function ArchiveSkeleton() {
  return (
    <div className="min-h-dvh py-10" aria-hidden="true" data-testid="archive-skeleton">
      <div className="h-8 w-48 rounded-control bg-surface-2" />
      <div className="mt-8 grid gap-4 md:grid-cols-2">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-44 rounded-card bg-surface-2" />
        ))}
      </div>
    </div>
  );
}
