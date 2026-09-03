"use client";

import { useEffect, useMemo, useState } from "react";
import { Tab, TabGroup, TabList, TabPanel, TabPanels } from "@headlessui/react";
import { AnimatePresence, motion } from "framer-motion";
import Card from "./card";
import { usePostSearch } from "../lib/use-post-search";
import { tagLabel } from "../../data/tagLabels";

const PAGE_SIZE = 8;

/**
 * Home article browser: Featured grid + Latest/tag/Search tabs.
 *
 * LCP notes: the first PAGE_SIZE cards render STATICALLY (no entrance
 * animation, no opacity gate) so they paint with the server HTML; only cards
 * added via "load more" or search results animate in. Search runs over the
 * shared build-time Fuse index (src/lib/use-post-search.js).
 */
export default function Articles({ articles, mostCommonTag }) {
  const [tabIndex, setTabIndex] = useState(0);
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [results, setResults] = useState([]);
  const [loadedFor, setLoadedFor] = useState("");
  const [visible, setVisible] = useState(PAGE_SIZE);
  const { search } = usePostSearch();

  const featuredArticles = useMemo(
    () => articles.filter((a) => a.featured && !a.draft),
    [articles]
  );

  const latestArticles = useMemo(() => {
    const featuredSlugs = new Set(featuredArticles.map((a) => a.slug));
    return articles.filter((a) => !a.draft && !featuredSlugs.has(a.slug));
  }, [articles, featuredArticles]);

  const tagArticles = useMemo(
    () =>
      latestArticles.filter(
        (a) => (a.tags || []).includes(mostCommonTag)
      ),
    [latestArticles, mostCommonTag]
  );

  // Reset search + paging when switching tabs.
  useEffect(() => {
    const t = setTimeout(() => {
      setVisible(PAGE_SIZE);
      if (tabIndex !== 2) {
        setQuery("");
        setDebounced("");
      }
    }, 0);
    return () => clearTimeout(t);
  }, [tabIndex]);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 150);
    return () => clearTimeout(t);
  }, [query]);

  const isSearching = debounced.length >= 2;
  const searching = isSearching && loadedFor !== debounced;

  useEffect(() => {
    if (!isSearching) return;
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
  }, [debounced, isSearching, search]);

  const loadMore = () => setVisible((prev) => prev + PAGE_SIZE);

  const cardGrid = (list, animate = false) => (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      {animate ? (
        <AnimatePresence initial={false}>
          {list.map((article) => (
            <motion.div
              key={article.slug}
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
            >
              <Card {...cardProps(article)} />
            </motion.div>
          ))}
        </AnimatePresence>
      ) : (
        list.map((article) => <Card key={article.slug} {...cardProps(article)} />)
      )}
    </div>
  );

  const loadMoreButton = (total) =>
    total > visible ? (
      <div className="mt-8 flex justify-center">
        <button
          type="button"
          onClick={loadMore}
          className="rounded-full border border-border bg-surface px-6 py-2 text-sm font-medium text-muted transition-all duration-200 hover:-translate-y-px hover:border-accent hover:text-accent hover:shadow-card-hover"
        >
          加载更多
        </button>
      </div>
    ) : null;

  const searchList = results.slice(0, visible);

  return (
    <div className="w-full">
      {/* Featured */}
      {featuredArticles.length > 0 && (
        <section className="mb-10">
          <div className="mb-4 flex items-baseline justify-between border-b border-border pb-2">
            <h2 className="text-xl font-semibold tracking-tight text-foreground">
              精选
            </h2>
            <span className="text-xs text-faint">Featured</span>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {featuredArticles.map((article) => (
              <Card key={article.slug} {...cardProps(article)} />
            ))}
          </div>
        </section>
      )}

      {/* Tabs */}
      <TabGroup selectedIndex={tabIndex} onChange={setTabIndex}>
        <TabList className="flex justify-between border-b border-border pb-2">
          {["最新", mostCommonTag ? tagLabel(mostCommonTag) : "推荐", "搜索"].map(
            (label, index) => (
              <Tab
                key={index}
                as="button"
                className={({ selected }) =>
                  `relative z-10 rounded-md px-3 py-2 text-sm transition-colors duration-200 ${
                    selected
                      ? "bg-accent-soft font-semibold text-accent"
                      : "text-muted hover:bg-surface-2 hover:text-foreground"
                  }`
                }
              >
                {label}
              </Tab>
            )
          )}
        </TabList>

        <TabPanels className="mt-6">
          {/* Latest */}
          <TabPanel className="space-y-6">
            {cardGrid(latestArticles.slice(0, visible))}
            {loadMoreButton(latestArticles.length)}
          </TabPanel>

          {/* mostCommonTag */}
          <TabPanel className="space-y-6">
            {tagArticles.length > 0 ? (
              <>
                {cardGrid(tagArticles.slice(0, visible))}
                {loadMoreButton(tagArticles.length)}
              </>
            ) : (
              <p className="py-8 text-center text-sm text-faint">暂无文章</p>
            )}
          </TabPanel>

          {/* Search */}
          <TabPanel className="min-h-[50vh] space-y-4">
            <div className="relative">
              <input
                type="text"
                aria-label="搜索文章"
                placeholder="搜索文章、标签…"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setVisible(PAGE_SIZE);
                }}
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

            {isSearching && searching ? (
              <p className="py-8 text-center text-sm text-faint">搜索中…</p>
            ) : isSearching && searchList.length > 0 ? (
              <>
                {cardGrid(searchList, true)}
                {loadMoreButton(results.length)}
              </>
            ) : isSearching ? (
              <p className="py-8 text-center text-sm text-muted">
                没有找到与「{debounced}」相关的文章
              </p>
            ) : (
              <p className="py-8 text-center text-sm text-faint">
                输入关键词，全文搜索标题、简介与标签
              </p>
            )}
          </TabPanel>
        </TabPanels>
      </TabGroup>
    </div>
  );
}

function cardProps(article) {
  return {
    slug: article.slug,
    title: article.title,
    description: article.description,
    publishDate: article.publishDate || article.date,
    tags: article.tags,
    readingTime: article.readingTime,
    featured: article.featured,
  };
}
