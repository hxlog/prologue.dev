import { cacheLife } from "next/cache";

/**
 * Daily rotation offset for the friend-link grid.
 *
 * The grid used to be shuffled in an effect after mount ("so every friend gets
 * the top slots sometimes"). That reordered the DOM *after* paint, which is a
 * layout shift by construction: /links measured CLS 0.099 (one shift, ~3.1 s,
 * source node = the card link) and the entries jumped under the reader's
 * cursor. Rotating on the server keeps the fairness, costs no client JS,
 * cannot disagree with the hydration pass, and shifts nothing.
 *
 * Date.now() is synchronous IO under Cache Components, so the read lives
 * inside a `'use cache'` scope -- the same shape as getSiteYear(). The offset
 * therefore changes once per cache window, which is exactly the behaviour
 * wanted here: stable within a visit, different the next day.
 */
export async function getRotationOffset(total) {
  "use cache";
  cacheLife("days");
  const day = Math.floor(Date.now() / 86_400_000);
  const n = Math.max(1, total);
  return ((day % n) + n) % n;
}
