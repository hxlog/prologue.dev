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
 */
export function ArticleSkeleton() {
  return (
    <div className="mx-auto w-full max-w-3xl py-8" aria-hidden="true">
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
    <div className="mx-auto w-full max-w-3xl py-8" aria-hidden="true">
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
    <div className="py-10" aria-hidden="true">
      <div className="h-8 w-48 rounded-control bg-surface-2" />
      <div className="mt-8 grid gap-4 md:grid-cols-2">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-44 rounded-card bg-surface-2" />
        ))}
      </div>
    </div>
  );
}
