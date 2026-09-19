/**
 * Request helpers for the auth routes.
 *
 * Kept separate from the modules that do the work so those stay testable in
 * plain Node. Everything here touches Next's request-scoped APIs, which cannot
 * be called outside a request.
 */

/**
 * The client's IP, as far as we can tell.
 *
 * `x-forwarded-for` is a list, and the FIRST entry is the client — but only
 * because Vercel's edge proxy appends rather than replaces. Behind a different
 * proxy the last entry would be the client, and any of them can be forged by
 * the sender if the proxy does not strip them.
 *
 * This matters less than it looks, and it is worth being explicit about why:
 * the IP is one of TWO throttle keys, and the other one is the account. An
 * attacker who forges a fresh IP per request defeats the IP limit, but still
 * hits the account limit, which is the one that actually protects the
 * password. The IP key exists to slow down enumeration across many accounts,
 * and a determined attacker with a proxy pool can defeat it. That is accepted,
 * not overlooked.
 *
 * Returns null when no header is present, which makes the caller skip the IP
 * counter rather than bucket every anonymous client together under a single
 * key — that would let one attacker lock out everyone.
 */
export function clientIp(request) {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0].trim();
    if (first) return first;
  }
  const real = request.headers.get("x-real-ip");
  if (real) return real.trim();

  // Unknown. Not "0.0.0.0": a synthetic value would put every such client in
  // one bucket and let a single attacker burn the IP limit for all of them.
  return null;
}

/** The user agent, truncated. Stored for the session list, never rendered raw. */
export function userAgent(request) {
  const ua = request.headers.get("user-agent");
  return ua ? ua.slice(0, 300) : null;
}

/**
 * Coarse geolocation hints Vercel injects, for the session list.
 *
 * Best-effort and non-authoritative — this is here so the author can recognise
 * their own sessions ("Shanghai, Chrome") and spot one that is not theirs.
 */
export function requestHints(request) {
  return {
    city: request.headers.get("x-vercel-ip-city") || null,
    country: request.headers.get("x-vercel-ip-country") || null,
  };
}
