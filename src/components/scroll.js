"use client";

import { useEffect, useState } from "react";

const ScrollTopAndComment = () => {
  const [show, setShow] = useState(false);

  useEffect(() => {
    const handleWindowScroll = () => {
      setShow(window.scrollY > 50);
    };
    handleWindowScroll();
    window.addEventListener("scroll", handleWindowScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleWindowScroll);
  }, []);

  const handleScrollTop = () => window.scrollTo({ top: 0, behavior: "smooth" });
  const handleScrollToComment = () =>
    document.getElementById("comments")?.scrollIntoView({ behavior: "smooth" });

  const btn =
    "rounded-full bg-surface p-2 text-muted shadow-card transition-all duration-200 hover:-translate-y-0.5 hover:text-accent hover:shadow-card-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent";

  return (
    <div
      className={`fixed bottom-8 right-8 flex-col gap-3 transition-all duration-300 ${
        show ? "flex opacity-100" : "pointer-events-none flex opacity-0 translate-y-2"
      }`}
    >
      <button aria-label="Scroll To Comment" type="button" onClick={handleScrollToComment} className={btn}>
        <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
          <path
            fillRule="evenodd"
            d="M18 10c0 3.866-3.582 7-8 7a8.841 8.841 0 01-4.083-.98L2 17l1.338-3.123C2.493 12.767 2 11.434 2 10c0-3.866 3.582-7 8-7s8 3.134 8 7zM7 9H5v2h2V9zm8 0h-2v2h2V9zM9 9h2v2H9V9z"
            clipRule="evenodd"
          />
        </svg>
      </button>

      <button aria-label="Scroll To Top" type="button" onClick={handleScrollTop} className={btn}>
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
