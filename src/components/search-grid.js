"use client";

import { useEffect, useMemo, useState } from "react";
import Card from "./card";
import { usePostSearch } from "../lib/use-post-search";

const PAGE_SIZE = 8;

/**
 * Shared search + card grid for /blog and /tags/* (and pagination).
 * Receives SLIM post objects from a server component (never full contentlayer
 * docs) so the RSC payload stays small. Search runs over the build-time
 * Fuse index (src/lib/use-post-search.js) — identical behavior site-wide.
 */
export default function SearchGrid({ posts, className = "" }) {
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [results, setResults] = useState([]);
  const [loadedFor, setLoadedFor] = useState("");
  const [visible, setVisible] = useState(PAGE_SIZE);
  const { search } = usePostSearch();

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query.trim()), 150);
    return () => clearTimeout(timer);
  }, [query]);

  const isSearching = debounced.length >= 2;
  const searching = isSearching && loadedFor !== debounced;

  useEffect(() => {
    if (debounced.length < 2) return;
    let cancelled = false;
    search(debounced).then((items) => {
      if (!cancelled) {
        setResults(items);
        setLoadedFor(debounced);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [debounced, search]);

  const list = useMemo(() => {
    if (isSearching) return (searching ? [] : results).slice(0, visible);
    return posts.slice(0, visible);
  }, [isSearching, searching, results, posts, visible]);

  const total = isSearching ? results.length : posts.length;

  const loadMore = () => setVisible((prev) => prev + PAGE_SIZE);

  return (
    <div className={className}>
      <div className="relative">
        <input
          aria-label="搜索文章"
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setVisible(PAGE_SIZE);
          }}
          placeholder="搜索文章、标签…"
          className="block w-full rounded-xl border border-border bg-surface px-4 py-2.5 pr-10 text-sm text-foreground shadow-card transition-all duration-200 placeholder:text-faint focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
        />
        <svg
          className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint"
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
          />
        </svg>
      </div>

      <div className="mt-6 min-h-[40vh]">
        {isSearching && searching ? (
          <p className="py-10 text-center text-sm text-faint">搜索中…</p>
        ) : list.length > 0 ? (
          <div className="grid gap-4 md:grid-cols-2">
            {list.map((post) => (
              <Card
                key={post.slug}
                slug={post.slug}
                title={post.title}
                description={post.description}
                publishDate={post.publishDate || post.date}
                tags={post.tags}
                readingTime={post.readingTime}
                featured={post.featured}
              />
            ))}
          </div>
        ) : (
          <p className="py-10 text-center text-sm text-muted">
            {isSearching ? `没有找到与「${debounced}」相关的文章` : "暂无文章"}
          </p>
        )}
      </div>

      {total > visible && (
        <div className="mt-8 flex justify-center">
          <button
            type="button"
            onClick={loadMore}
            className="rounded-full border border-border bg-surface px-6 py-2 text-sm font-medium text-muted transition-all duration-200 hover:-translate-y-px hover:border-accent hover:text-accent hover:shadow-card-hover"
          >
            加载更多
          </button>
        </div>
      )}
    </div>
  );
}
