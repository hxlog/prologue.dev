"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";

export default function TableofContent({ headings }) {
  const [activeId, setActiveId] = useState("");
  const observer = useRef(null);
  const navRef = useRef(null);
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

    const elements = document.querySelectorAll("h2, h3, h4");
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
    const idx = headings.findIndex(
      (h) => h.id === activeId || slug(h.text) === activeId
    );
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
    <nav
      ref={navRef}
      className="relative flex flex-col gap-0.5"
      aria-label="Table of contents"
    >
      {headings.map((heading) => {
        const isActive =
          heading.id === activeId || slug(heading.text) === activeId;
        const isAncestor = activeAncestors.has(heading.id);

        const indent =
          heading.level === "three"
            ? "ml-3"
            : heading.level === "two"
              ? ""
              : "";

        const baseColor = isActive
          ? "text-foreground font-semibold"
          : isAncestor
            ? "text-foreground font-semibold"
            : "text-muted hover:text-foreground font-normal";

        return (
          <div key={heading.id + heading.text} className="relative">
            {isActive && (
              <motion.span
                layoutId="toc-pill"
                className="absolute inset-0 -z-10 rounded-md bg-accent-soft"
                transition={{
                  type: "spring",
                  stiffness: 350,
                  damping: 32,
                  mass: 0.6,
                }}
              />
            )}
            <Link
              data-level={heading.level}
              data-active={isActive ? "true" : undefined}
              data-ancestor={isAncestor ? "true" : undefined}
              href={`#${heading.text}`}
              className={`relative block ${indent} leading-7 rounded-md px-3 py-1 text-sm transition-colors duration-200 ${baseColor}`}
              onClick={(e) => {
                e.preventDefault();
                const target =
                  document.getElementById(heading.id) ||
                  document.getElementById(slug(heading.text));
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

function slug(text) {
  return text ? text.split(" ").join("-").toLowerCase() : "";
}
