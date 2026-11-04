"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { slugify } from "../lib/content/slug";

/**
 * Post/page table of contents.
 *
 * The observer targets only the article's own headings (`article h2/h3/h4`)
 * rather than every heading in the document. Under Cache Components React's
 * <Activity> can keep a hidden route mounted, so a document-wide query can
 * pick up headings belonging to a page the reader cannot see — those never
 * intersect, but they inflate the observer and can leave the active pill
 * pointing at a stale id.
 */
export default function TableofContent({ headings }) {
  const [activeId, setActiveId] = useState("");
  const observer = useRef(null);
  const ignoreObserverRef = useRef(false);
  const releaseTimerRef = useRef(null);

  useEffect(() => {
    if (!headings || headings.length === 0) return;

    const handleObserver = (entries) => {
      if (ignoreObserverRef.current) return;
      const visible = entries.filter((e) => e.isIntersecting);
      if (visible.length === 0) return;
      visible.sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
      setActiveId(visible[0].target.id);
    };

    observer.current = new IntersectionObserver(handleObserver, {
      rootMargin: "0px 0px -40% 0px",
      threshold: 0.4,
    });

    const scope = document.querySelector("main article") ?? document;
    const elements = scope.querySelectorAll("h2, h3, h4");
    elements.forEach((elem) => observer.current.observe(elem));

    return () => observer.current?.disconnect();
  }, [headings]);

  useEffect(() => {
    return () => {
      if (releaseTimerRef.current) clearTimeout(releaseTimerRef.current);
    };
  }, []);

  const activeAncestors = useMemo(() => {
    if (!activeId) return new Set();
    const idx = headings.findIndex((h) => h.id === activeId);
    if (idx === -1) return new Set();
    const active = headings[idx];
    const ancestors = new Set();
    if (active.level === "three") {
      for (let i = idx - 1; i >= 0; i--) {
        if (headings[i].level === "two") {
          ancestors.add(headings[i].id);
          break;
        }
      }
    }
    return ancestors;
  }, [activeId, headings]);

  if (!headings || headings.length === 0) return null;

  return (
    <nav className="relative flex flex-col gap-0.5" aria-label="Table of contents">
      {headings.map((heading) => {
        const isActive = heading.id === activeId;
        const isAncestor = activeAncestors.has(heading.id);

        const indent = heading.level === "three" ? "ml-3" : "";

        return (
          <div key={heading.id + heading.text} className="relative">
            {/* The active marker used to be a framer-motion layoutId pill that
                slid between rows. Rows have variable heights (headings wrap), so
                a single sliding element needs layout measurement to stay
                aligned; the fade-in marker gets the same "you are here"
                affordance from CSS alone, and the library stays out of the
                bundle. */}
            {isActive && (
              <span className="toc-pill absolute inset-0 -z-10 rounded-control bg-accent-soft" />
            )}
            <Link
              data-level={heading.level}
              data-active={isActive || isAncestor ? "true" : undefined}
              href={`#${heading.id}`}
              className={`relative block rounded-control px-3 py-1 text-sm leading-7 transition-colors duration-fast ${
                isActive || isAncestor
                  ? "font-semibold text-foreground"
                  : "font-normal text-muted hover:text-foreground"
              } ${indent}`}
              onClick={(e) => {
                e.preventDefault();
                const target =
                  document.getElementById(heading.id) ||
                  document.getElementById(slugify(heading.text));
                if (!target) return;
                ignoreObserverRef.current = true;
                setActiveId(target.id);
                target.scrollIntoView({ behavior: "smooth", block: "start" });
                const release = () => {
                  ignoreObserverRef.current = false;
                };
                if (releaseTimerRef.current) {
                  clearTimeout(releaseTimerRef.current);
                  releaseTimerRef.current = null;
                }
                if ("onscrollend" in window) {
                  window.addEventListener("scrollend", release, { once: true });
                } else {
                  releaseTimerRef.current = setTimeout(release, 700);
                }
              }}
            >
              {heading.text}
            </Link>
          </div>
        );
      })}
    </nav>
  );
}
