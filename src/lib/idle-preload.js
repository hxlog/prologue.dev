/**
 * Load an optional interaction panel after the first paint without competing
 * with the initial route. The callback is the same module promise the trigger
 * uses, so the actual click is usually a cache hit.
 *
 * requestIdleCallback is not available in every browser (notably older Safari)
 * and can be starved by a busy page; the timeout/setTimeout fallback keeps the
 * preload predictable. Save-Data requests skip it entirely.
 */
export function scheduleIdlePreload(callback) {
  if (typeof window === "undefined") return () => {};
  if (navigator.connection?.saveData) return () => {};

  if (typeof window.requestIdleCallback === "function") {
    const id = window.requestIdleCallback(callback, { timeout: 2000 });
    return () => window.cancelIdleCallback?.(id);
  }

  const id = window.setTimeout(callback, 1500);
  return () => window.clearTimeout(id);
}
