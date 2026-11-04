"use client";

/**
 * Floating "back to top" / "jump to comments" actions.
 *
 * The reveal is a CSS scroll-driven animation (`.scroll-actions`, globals.css):
 * no scroll listener, no React state, no re-render per scroll event — the
 * compositor drives it. Browsers without `animation-timeline` simply show the
 * buttons at all times; the control is never missing, only never hidden.
 *
 * The handlers stay smooth-scroll unless the reader asked for reduced motion.
 */
const ScrollTopAndComment = () => {
  const scrollTo = (target) => {
    const behavior = window.matchMedia("(prefers-reduced-motion: reduce)")
      .matches
      ? "auto"
      : "smooth";
    if (target === "top") {
      window.scrollTo({ top: 0, behavior });
    } else {
      document.getElementById("comments")?.scrollIntoView({ behavior });
    }
  };

  return (
    <div className="scroll-actions">
      <button
        aria-label="Scroll To Comment"
        type="button"
        onClick={() => scrollTo("comments")}
        className="btn-icon h-9 w-9 bg-surface shadow-card"
      >
        <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
          <path
            fillRule="evenodd"
            d="M18 10c0 3.866-3.582 7-8 7a8.841 8.841 0 01-4.083-.98L2 17l1.338-3.123C2.493 12.767 2 11.434 2 10c0-3.866 3.582-7 8-7s8 3.134 8 7zM7 9H5v2h2V9zm8 0h-2v2h2V9zM9 9h2v2H9V9z"
            clipRule="evenodd"
          />
        </svg>
      </button>

      <button
        aria-label="Scroll To Top"
        type="button"
        onClick={() => scrollTo("top")}
        className="btn-icon h-9 w-9 bg-surface shadow-card"
      >
        <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
          <path
            fillRule="evenodd"
            d="M3.293 9.707a1 1 0 010-1.414l6-6a1 1 0 011.414 0l6 6a1 1 0 01-1.414 1.414L11 5.414V17a1 1 0 11-2 0V5.414L4.707 9.707a1 1 0 01-1.414 0z"
            clipRule="evenodd"
          />
        </svg>
      </button>
    </div>
  );
};

export default ScrollTopAndComment;
