"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import { scheduleIdlePreload } from "../lib/idle-preload";

let panelPromise = null;
function loadPanel() {
  if (!panelPromise) {
    panelPromise = import("./mobile-nav-panel").catch((error) => {
      panelPromise = null;
      throw error;
    });
  }
  return panelPromise;
}

const Panel = dynamic(loadPanel, { ssr: false });

/**
 * Mobile nav trigger. The menu panel (and its chunk) loads on first intent or
 * after the first paint; the wrapper owns outside-click handling. Keyboard and
 * focus management live in the panel so it can match the visual motion tokens.
 */
const MobileNav = () => {
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const boxRef = useRef(null);
  const buttonRef = useRef(null);
  const wasOpen = useRef(false);

  const preload = useCallback(() => {
    loadPanel().catch(() => {});
  }, []);

  useEffect(() => scheduleIdlePreload(() => preload()), [preload]);

  const close = useCallback(() => setOpen(false), []);

  const openPanel = useCallback(() => {
    preload();
    setOpen(true);
    loadPanel()
      .then(() => setLoaded(true))
      .catch(() => setOpen(false));
  }, [preload]);

  useEffect(() => {
    if (wasOpen.current && !open) buttonRef.current?.focus({ preventScroll: true });
    wasOpen.current = open;
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;

    const onPointerDown = (event) => {
      if (!boxRef.current?.contains(event.target)) close();
    };
    const onKeyDown = (event) => {
      if (event.key === "Escape") close();
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [close, open]);

  return (
    <div ref={boxRef} className="relative inline-block text-left sm:hidden">
      <button
        ref={buttonRef}
        type="button"
        className="btn-icon"
        aria-label="Navigation"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls="mobile-nav-menu"
        onClick={() => (open ? close() : openPanel())}
        onPointerEnter={preload}
        onFocus={preload}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={1.5}
          stroke="currentColor"
          className="h-5 w-5"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M3.75 9h16.5m-16.5 6.75h16.5"
          />
        </svg>
      </button>

      {loaded ? <Panel open={open} onClose={close} /> : null}
    </div>
  );
};

export default MobileNav;
