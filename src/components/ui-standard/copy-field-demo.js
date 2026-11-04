"use client";

import siteMetadata from "../../../data/sitemetadata";
import { useCopy } from "../../lib/use-copy";

/**
 * Working copy field, the same `.copy-field` + useCopy() pair the RSS modal
 * uses. Shows the idle / copied / error states without a clipboard stub.
 */
export default function CopyFieldDemo() {
  const { state, copy } = useCopy();
  const value = String(siteMetadata.siteUrl || "https://prologue.dev").replace(/\/+$/, "") + "/rss";

  return (
    <div className="copy-field">
      <span className="min-w-0 flex-1 truncate">{value}</span>
      <button
        type="button"
        className="btn btn-ghost h-7 shrink-0 px-2 text-caption"
        onClick={() => copy(value)}
      >
        {state === "copied" ? "已复制" : state === "error" ? "复制失败" : "复制"}
      </button>
    </div>
  );
}
