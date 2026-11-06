"use client";

import { useState } from "react";
import Modal from "./modal";
import siteMetadata, { wechatofficialaccount } from "../../data/sitemetadata";
import { useCopy } from "../lib/use-copy";

const SITE = String(siteMetadata.siteUrl || "").replace(/\/+$/, "");

const FEEDS = [
  { key: "wechat", label: "博文", desc: "微信公众号", url: wechatofficialaccount, copied: "已复制微信公众号名称" },
  { key: "rss", label: "博文", desc: "RSS 2.0", url: `${SITE}/rss`, copied: "已复制 RSS 2.0 全文输出地址" },
  { key: "atom", label: "博文", desc: "Atom Feed", url: `${SITE}/atomfeed`, copied: "已复制 Atom 全文输出地址" },
  { key: "json", label: "博文", desc: "JSON Feed", url: `${SITE}/jsonfeed`, copied: "已复制 JSON Feed 全文输出地址" },
  { key: "microblog", label: "微博图文", desc: "RSS 2.0", url: `${SITE}/microblog/rss`, copied: "已复制微博图文 RSS 地址" },
];

export default function RssModalPanel({ open, onClose }) {
  const [copiedKey, setCopiedKey] = useState(null);
  const { state, copy } = useCopy();

  const copyFeed = (feed) => {
    copy(feed.url);
    setCopiedKey(feed.key);
  };

  return (
    <Modal open={open} onClose={onClose} title="订阅更新">
      <p className="text-sm leading-6 text-muted">
        文章订阅均为
        <span className="font-medium text-accent">全文输出</span>
        ，微博RSS包括日常含图文的随想，更新频率较高。点击右侧链接即可复制订阅地址，粘贴到你的 RSS 阅读器。
      </p>

      <ul className="mt-4 space-y-2.5">
        {FEEDS.map((feed) => (
          <li key={feed.key}>
            <button
              type="button"
              onClick={() => copyFeed(feed)}
              className="group flex w-full items-center justify-between gap-3 rounded-control border border-border bg-surface px-4 py-3 text-left transition-[transform,border-color,box-shadow] duration-(--duration-fast) ease-out-expo hover:-translate-y-px hover:border-accent hover:shadow-card-hover"
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
                className={`shrink-0 rounded-md px-2 py-1 text-xs font-medium transition-colors duration-(--duration-fast) ${
                  state === "copied" && copiedKey === feed.key
                    ? "bg-accent-soft text-accent"
                    : "bg-surface-2 text-muted group-hover:bg-accent-strong group-hover:text-on-accent"
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
  );
}
