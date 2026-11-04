"use client";

import { useEffect } from "react";

/**
 * Cursor-following spotlight for every `.card-spotlight` on the page.
 *
 * One delegated `pointermove` listener on `document`, registered once, instead
 * of a listener (and React handler) per card. The cards are mostly server
 * components rendered inside client trees, so per-card JS would either ship a
 * client wrapper for every card or force the effect down into each one; a
 * single document-level listener also keeps working for cards that a client
 * component mounts later (search results, "load more" batches) with no
 * re-registration.
 *
 * Why write style properties rather than state: this runs on every pointer
 * move at 60–120 Hz. A React state update per move would re-render the tree
 * under the pointer. Writing two CSS custom properties goes straight to the
 * style engine, and `@property` (see globals.css) makes them typed and
 * interpolable, so the glow eases to the pointer instead of teleporting.
 *
 * Coordinates are percentages relative to the card, so the gradient works at
 * any card size and needs no resize recalculation.
 *
 * THE BUG THIS FILE USED TO HAVE: an `if (card === current) return` guard meant
 * the position was written once, on the first move after entering a card, and
 * every later move inside that same card was dropped -- the glow froze where
 * the pointer had crossed the edge. `current` now only tracks which card owns
 * the cached rect, never whether to update.
 *
 * The hover state itself is CSS (`.card-spotlight:hover { --spot-a: 1 }`);
 * this script only positions the light.
 */
export default function Spotlight() {
  useEffect(() => {
    if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) {
      return;
    }

    let current = null;
    let rect = null;
    let frame = 0;
    let pendingX = 0;
    let pendingY = 0;

    const paint = () => {
      frame = 0;
      if (!current) return;
      current.style.setProperty("--spot-x", `${pendingX.toFixed(2)}%`);
      current.style.setProperty("--spot-y", `${pendingY.toFixed(2)}%`);
    };

    const onPointerMove = (event) => {
      const card = event.target.closest?.(".card-spotlight");
      if (!card) {
        current = null;
        rect = null;
        return;
      }

      if (card !== current) {
        current = card;
        rect = card.getBoundingClientRect();
      }

      if (!rect || rect.width === 0 || rect.height === 0) return;

      pendingX = ((event.clientX - rect.left) / rect.width) * 100;
      pendingY = ((event.clientY - rect.top) / rect.height) * 100;

      // One write per frame at most; the pointer can move several times
      // between paints and only the last position is visible anyway.
      if (!frame) frame = requestAnimationFrame(paint);
    };

    // The cached rect goes stale when the page scrolls or the viewport
    // resizes, so it is dropped rather than recomputed on every move (a
    // getBoundingClientRect per move forces a layout read).
    const invalidate = () => {
      rect = null;
    };

    document.addEventListener("pointermove", onPointerMove, { passive: true });
    window.addEventListener("scroll", invalidate, { passive: true });
    window.addEventListener("resize", invalidate, { passive: true });
    // pointerout with no relatedTarget means the pointer left the window.
    document.documentElement.addEventListener("pointerleave", invalidate);

    return () => {
      if (frame) cancelAnimationFrame(frame);
      document.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("scroll", invalidate);
      window.removeEventListener("resize", invalidate);
      document.documentElement.removeEventListener("pointerleave", invalidate);
    };
  }, []);

  return null;
}
