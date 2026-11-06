"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useState } from "react";
import { scheduleIdlePreload } from "../lib/idle-preload";

let panelPromise = null;
function loadPanel() {
  if (!panelPromise) {
    panelPromise = import("./email-modal-panel").catch((error) => {
      panelPromise = null;
      throw error;
    });
  }
  return panelPromise;
}

const Panel = dynamic(loadPanel, { ssr: false });

export default function EmailModal() {
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

  return (
    <>
      <button
        type="button"
        onClick={openPanel}
        onPointerEnter={preload}
        onFocus={preload}
        aria-label="Email"
        className="btn-icon"
      >
        <svg
          className="h-6 w-6 fill-current"
          fill="currentColor"
          viewBox="0 0 20 20"
          aria-hidden="true"
        >
          <path
            fillRule="evenodd"
            d="M2.003 5.884 10 9.882l7.997-3.998A2 2 0 0 0 16 4H4a2 2 0 0 0-1.997 1.884z"
          />
          <path
            d="m18 8.118-8 4-8-4V14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8.118z"
            clipRule="evenodd"
          />
        </svg>
      </button>

      {loaded ? <Panel open={open} onClose={() => setOpen(false)} /> : null}
    </>
  );
}
