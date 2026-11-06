"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useState } from "react";
import { scheduleIdlePreload } from "../lib/idle-preload";

let panelPromise = null;
function loadPanel() {
  if (!panelPromise) {
    panelPromise = import("./rss-modal-panel").catch((error) => {
      panelPromise = null;
      throw error;
    });
  }
  return panelPromise;
}

const Panel = dynamic(loadPanel, { ssr: false });

/**
 * Lightweight RSS trigger. The Headless UI dialog (and its chunk) is loaded
 * only when the reader asks for the feed list; the document-level /rss link
 * interception stays here so links in content keep opening the modal.
 */
export default function RssModal() {
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const preload = useCallback(() => {
    loadPanel().catch(() => {});
  }, []);

  useEffect(() => scheduleIdlePreload(() => preload()), [preload]);

  const openPanel = useCallback(() => {
    preload();
    setOpen(true);
    loadPanel()
      .then(() => setLoaded(true))
      .catch(() => setOpen(false));
  }, [preload]);

  useEffect(() => {
    const openFromAbout = (event) => {
      const link = event.target.closest?.('a[href="/rss"]');
      if (!link) return;
      event.preventDefault();
      openPanel();
    };

    document.addEventListener("click", openFromAbout);
    return () => document.removeEventListener("click", openFromAbout);
  }, [openPanel]);

  return (
    <>
      <button
        type="button"
        onClick={openPanel}
        onPointerEnter={preload}
        onFocus={preload}
        aria-label="RSS 订阅"
        title="RSS 订阅"
        className="btn-icon"
      >
        <svg
          className="h-5 w-5 fill-current"
          fill="currentColor"
          viewBox="0 0 800 800"
          aria-hidden="true"
        >
          <path
            d="M493 652H392c0-134-111-244-244-244V307c189 0 345 156 345 345zm71 0c0-228-188-416-416-416V132c285 0 520 235 520 520z"
            clipRule="evenodd"
          />
          <circle cx="219" cy="581" r="71" />
        </svg>
      </button>

      {loaded ? <Panel open={open} onClose={() => setOpen(false)} /> : null}
    </>
  );
}
