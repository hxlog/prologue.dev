"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import { scheduleIdlePreload } from "../lib/idle-preload";

let panelPromise = null;
function loadPanel() {
  if (!panelPromise) {
    panelPromise = import("./search-dialog-panel").catch((error) => {
      panelPromise = null;
      throw error;
    });
  }
  return panelPromise;
}

const Panel = dynamic(loadPanel, { ssr: false });

/**
 * Site-wide search trigger.
 *
 * The dialog and its Headless UI dependency are loaded only when the reader
 * asks for search; the keyboard shortcuts and the trigger button stay in this
 * light shell so the initial chunk on every route stays small. The panel is
 * preloaded on pointer/focus intent, not on page load.
 */
export default function SearchDialog() {
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [panelKey, setPanelKey] = useState(0);
  const openRef = useRef(false);

  const preload = useCallback(() => {
    loadPanel().catch(() => {});
  }, []);

  useEffect(() => scheduleIdlePreload(() => preload()), [preload]);

  const openDialog = useCallback(() => {
    preload();
    setPanelKey((key) => key + 1);
    setOpen(true);
    openRef.current = true;
    loadPanel()
      .then(() => setLoaded(true))
      .catch(() => {
        openRef.current = false;
        setOpen(false);
      });
  }, [preload]);

  const close = useCallback(() => {
    setOpen(false);
    openRef.current = false;
  }, []);

  /* Open shortcuts. "/" is ignored while typing so it stays a character in the
     search box and in the Giscus iframe's text fields. */
  useEffect(() => {
    const onKeyDown = (event) => {
      const target = event.target;
      const typing =
        target instanceof Element &&
        target.closest(
          "input, textarea, select, [contenteditable='true'], [contenteditable='']"
        );
      const key = event.key.toLowerCase();

      if (key === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        if (openRef.current) close();
        else openDialog();
        return;
      }
      if (
        event.key === "/" &&
        !typing &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey
      ) {
        event.preventDefault();
        openDialog();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [close, openDialog]);

  return (
    <>
      <button
        type="button"
        className="btn-icon"
        aria-label="搜索全站（⌘K）"
        aria-haspopup="dialog"
        onClick={openDialog}
        onPointerEnter={preload}
        onFocus={preload}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={1.7}
          stroke="currentColor"
          className="h-[18px] w-[18px]"
          aria-hidden="true"
        >
          <circle cx="10.5" cy="10.5" r="6.5" />
          <path strokeLinecap="round" d="m16 16 4.5 4.5" />
        </svg>
      </button>

      {loaded ? <Panel key={panelKey} open={open} onClose={close} /> : null}
    </>
  );
}
