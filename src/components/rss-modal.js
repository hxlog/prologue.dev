"use client";

import { useState } from "react";
import Modal from "./modal";
import siteMetadata from "../../data/sitemetadata";
import { useCopy } from "../lib/use-copy";

const SITE = String(siteMetadata.siteUrl || "").replace(/\/+$/, "");

const FEEDS = [
  { key: "rss", label: "RSS 2.0", desc: "全文输出", url: `${SITE}/rss`, copied: "已复制 RSS 2.0 全文输出地址" },
  { key: "atom", label: "Atom", desc: "全文输出", url: `${SITE}/atomfeed`, copied: "已复制 Atom 全文输出地址" },
  { key: "json", label: "JSON Feed", desc: "全文输出", url: `${SITE}/jsonfeed`, copied: "已复制 JSON Feed 全文输出地址" },
];

/**
 * Navbar RSS modal. Instead of a dropdown that navigates to raw XML, each
 * feed is a row whose link copies the feed URL to the clipboard (readers
 * subscribe by URL). All three formats are full-text feeds.
 */
export default function RssModal() {
  const [open, setOpen] = useState(false);
  const [copiedKey, setCopiedKey] = useState(null);
  const { state, copy } = useCopy();

  const copyFeed = (feed) => {
    copy(feed.url);
    setCopiedKey(feed.key);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="RSS 订阅"
        title="RSS 订阅"
        className="flex h-9 w-9 items-center justify-center rounded-full text-muted transition-colors duration-200 hover:bg-surface-2 hover:text-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
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

      <Modal open={open} onClose={() => setOpen(false)} title="订阅更新">
        <p className="text-sm leading-6 text-muted">
          三种订阅格式均为
          <span className="font-medium text-accent">全文输出</span>
          。点击右侧链接即可复制订阅地址，粘贴到你的 RSS 阅读器。
        </p>

        <ul className="mt-4 space-y-2.5">
          {FEEDS.map((feed) => (
            <li key={feed.key}>
              <button
                type="button"
                onClick={() => copyFeed(feed)}
                className="group flex w-full items-center justify-between gap-3 rounded-xl border border-border bg-surface px-4 py-3 text-left transition-all duration-200 hover:-translate-y-px hover:border-accent hover:shadow-card-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
              >
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-foreground group-hover:text-accent">
                    {feed.label} · {feed.desc}
                  </span>
                  <span className="mt-0.5 block truncate font-mono text-xs text-faint">
                    {feed.url}
                  </span>
                </span>
                <span
                  className={`shrink-0 rounded-md px-2 py-1 text-xs font-medium transition-colors duration-150 ${
                    state === "copied" && copiedKey === feed.key
                      ? "bg-accent-soft text-accent"
                      : "bg-surface-2 text-muted group-hover:bg-accent group-hover:text-white"
                  }`}
                >
                  {state === "copied" && copiedKey === feed.key ? "已复制 ✓" : "复制"}
                </span>
              </button>
            </li>
          ))}
        </ul>

        {state === "error" && (
          <p className="mt-3 text-xs text-secondary">
            浏览器拒绝了自动复制，请手动复制上方地址。
          </p>
        )}
      </Modal>
    </>
  );
}
