"use client";

import { useEffect, useMemo, useState } from "react";
import { Tab, TabGroup, TabList, TabPanel, TabPanels } from "@headlessui/react";
import Card from "./card";
import { tagLabel } from "../../data/tagLabels";

const PAGE_SIZE = 8;

/**
 * Home article browser: Featured grid + Latest/top-tag tabs.
 *
 * Search is no longer a tab here. Site-wide search (including full post text)
 * lives in the navbar dialog and runs on the server, so the home page does not
 * carry a second search UI or download a search index.
 *
 * LCP notes: the first PAGE_SIZE cards render STATICALLY (no entrance
 * animation, no opacity gate) so they paint with the server HTML; only cards
 * added via "load more" animate in.
 */
export default function Articles({ articles, topTags = [] }) {
  const [tabIndex, setTabIndex] = useState(0);
  const [visible, setVisible] = useState(PAGE_SIZE);

  const featuredArticles = useMemo(
    () => articles.filter((a) => a.featured && !a.draft),
    [articles]
  );

  const latestArticles = useMemo(() => {
    const featuredSlugs = new Set(featuredArticles.map((a) => a.slug));
    return articles.filter((a) => !a.draft && !featuredSlugs.has(a.slug));
  }, [articles, featuredArticles]);

  const tagArticlesByTag = useMemo(
    () =>
      topTags.map((tag) =>
        latestArticles.filter((a) => (a.tags || []).includes(tag))
      ),
    [latestArticles, topTags]
  );

  // Tag #2 appears from tablet (md), tag #3 from desktop (lg) — the tab row
  // adapts to device width without JS resize handling.
  const tagTabVisibility = ["", "hidden md:inline-block", "hidden lg:inline-block"];

  // Reset paging when switching tabs. Deferred to a task so the reset does not
  // happen inside Headless UI's change event.
  useEffect(() => {
    const t = setTimeout(() => setVisible(PAGE_SIZE), 0);
    return () => clearTimeout(t);
  }, [tabIndex]);

  const loadMore = () => setVisible((prev) => prev + PAGE_SIZE);

  const cardGrid = (list, animate = false) => (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      {list.map((article) => (
        <div key={article.slug} className={animate ? "reveal-rise" : undefined}>
          <Card {...cardProps(article)} />
        </div>
      ))}
    </div>
  );

  const loadMoreButton = (total) =>
    total > visible ? (
      <div className="mt-8 flex justify-center">
        <button type="button" onClick={loadMore} className="btn btn-ghost">
          加载更多
        </button>
      </div>
    ) : null;

  return (
    <div className="w-full">
      {/* Featured */}
      {featuredArticles.length > 0 && (
        <section className="mb-10">
          <div className="mb-4 border-b border-border pb-2">
            <h2 className="text-title font-semibold tracking-tight text-foreground">
              Featured
            </h2>
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
        <TabList className="flex justify-between gap-2 border-b border-border pb-2">
          {[
            { label: "最新", vis: "" },
            ...topTags.map((tag, i) => ({
              label: tagLabel(tag),
              vis: tagTabVisibility[i] || "",
            })),
          ].map((tab, index) => (
            <Tab key={index} as="button" className={"z-10 nav-item " + tab.vis}>
              {tab.label}
            </Tab>
          ))}
        </TabList>

        <TabPanels className="mt-6">
          {/* Latest */}
          <TabPanel className="space-y-6">
            {cardGrid(latestArticles.slice(0, visible))}
            {loadMoreButton(latestArticles.length)}
          </TabPanel>

          {/* Top tags (responsive) */}
          {topTags.map((tag, i) => (
            <TabPanel key={tag} className="space-y-6">
              {tagArticlesByTag[i].length > 0 ? (
                <>
                  {cardGrid(tagArticlesByTag[i].slice(0, visible))}
                  {loadMoreButton(tagArticlesByTag[i].length)}
                </>
              ) : (
                <p className="py-8 text-center text-sm text-faint">暂无文章</p>
              )}
            </TabPanel>
          ))}
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
  };
}
