"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useState } from "react";
import AgentMark from "./agent-mark";
import { scheduleIdlePreload } from "../lib/idle-preload";

let panelPromise = null;
function loadPanel() {
  if (!panelPromise) {
    panelPromise = import("./agent-entry-panel").catch((error) => {
      panelPromise = null;
      throw error;
    });
  }
  return panelPromise;
}

const Panel = dynamic(loadPanel, { ssr: false });

/**
 * Agent/MCP entry in the icon toolbar, between search and RSS. The panel
 * (Headless UI dialog plus copy/config code) is lazy-loaded on intent and
 * retired on close, so the navbar shell does not ship it on every route.
 */
export default function AgentEntry() {
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
        aria-label="Agent 接入（MCP / A2A）"
        title="Agent 接入（MCP / A2A）"
        aria-haspopup="dialog"
        className="btn-icon group"
      >
        <AgentMark variant="node" />
      </button>

      {loaded ? <Panel open={open} onClose={() => setOpen(false)} /> : null}
    </>
  );
}
