import Link from "next/link";
import PostGrid from "../../components/post-grid";
import RouteTransition from "../../components/route-transition";
import { tagLabel } from "../../../data/tagLabels";
import { readingTimeLabel } from "../../lib/date";

/**
 * Shared archive layout for /blog and /tags/[...slug].
 * Server component: maps full content docs to slim objects before they cross
 * into the client <PostGrid>, keeping the RSC payload small.
 *
 * No active-link state is needed here — the tag sidebar receives `activeTag`
 * as a prop from the route, so nothing reads the pathname.
 */
export default function PostsLayout({
  posts,
  tagCounts = {},
  sortedTags = [],
  activeTag = null,
  title = "归档",
  subtitle,
}) {
  const slimPosts = posts
    .filter((post) => post.draft !== true)
    .map((post) => ({
      slug: post.slug,
      title: post.title,
      description: post.description || "",
      publishDate: post.publishDate,
      tags: post.tags || [],
      readingTime: readingTimeLabel(post.readingTime),
    }));

  return (
    <RouteTransition>
      <div className="page-enter">
        <header className="pt-12">
          {/* The count is the label: on an archive it is the one fact the
              reader wants before scrolling. */}
          <p className="eyebrow">{slimPosts.length} 篇文章</p>
          <h1 className="mt-2 text-h1 font-semibold tracking-tight text-foreground">
            {title}
            {activeTag ? (
              <span className="text-gradient"> · {tagLabel(activeTag)}</span>
            ) : null}
          </h1>
          {subtitle ? (
            <p className="mt-2 text-sm text-muted">{subtitle}</p>
          ) : null}
        </header>

        <div className="mt-8 lg:grid lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-10">
          {sortedTags.length > 0 && (
            <aside className="mb-8 lg:mb-0">
              <nav
                aria-label="标签"
                className="sticky-below-nav flex flex-wrap gap-1.5 lg:flex-col lg:gap-1"
              >
                {sortedTags.map((tag) => {
                  const active = tag === activeTag;
                  return (
                    <Link
                      key={tag}
                      href={`/tags/${tag}`}
                      // 15 sidebar links: prefetching them all competes with the
                      // article/card prefetches that actually predict a click.
                      prefetch={false}
                      aria-current={active ? "page" : undefined}
                      data-active={active ? "true" : undefined}
                      className="nav-item justify-between px-3"
                    >
                      <span>{tagLabel(tag)}</span>
                      <span className="text-xs text-faint">
                        {tagCounts[tag]}
                      </span>
                    </Link>
                  );
                })}
              </nav>
            </aside>
          )}

          <div className="min-w-0">
            <PostGrid posts={slimPosts} />
          </div>
        </div>
      </div>
    </RouteTransition>
  );
}
