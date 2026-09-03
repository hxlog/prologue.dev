"use client";

/**
 * Reading progress bar — pure CSS, zero JS. Uses scroll-driven animations
 * (animation-timeline: scroll()) where supported; in other browsers the bar
 * simply stays hidden (progressive enhancement). See globals.css.
 */
export default function ReadingProgress() {
  return <div className="reading-progress" aria-hidden="true" />;
}
