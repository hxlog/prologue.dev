import Link from "next/link";
import SearchGrid from "../../components/search-grid";
import { tagLabel } from "../../../data/tagLabels";

/**
 * Shared archive layout for /blog and /tags/[...slug].
 * Server component: maps full contentlayer docs to slim objects before they
 * cross into the client <SearchGrid>, keeping the RSC payload small.
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
      readingTime: post.readingTime?.text,
      featured: Boolean(post.featured),
    }));

  return (
    <div className="page-enter max-w-6xl">
      <header className="pt-12">
        <p className="eyebrow">Archive</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-foreground">
          {title}
          {activeTag ? (
            <span className="text-gradient"> · {tagLabel(activeTag)}</span>
          ) : null}
        </h1>
        {subtitle ? (
          <p className="mt-2 text-sm text-muted">{subtitle}</p>
        ) : null}
      </header>

      <div className="mt-8 lg:grid lg:grid-cols-6 lg:gap-10">
        {sortedTags.length > 0 && (
          <aside className="mb-8 lg:col-span-1 lg:mb-0">
            <nav
              aria-label="标签"
              className="flex flex-wrap gap-2 lg:sticky lg:flex-col lg:gap-1 lg:pt-1"
              style={{ top: "calc(var(--nav-height) + 1rem)" }}
            >
              {sortedTags.map((tag) => {
                const active = tag === activeTag;
                return (
                  <Link
                    key={tag}
                    href={`/tags/${tag}`}
                    aria-current={active ? "page" : undefined}
                    className={`rounded-lg px-3 py-1.5 text-sm transition-all duration-200 ${
                      active
                        ? "bg-accent-soft font-semibold text-accent shadow-[inset_0_0_0_1px_var(--accent)]"
                        : "text-muted hover:bg-surface-2 hover:text-foreground"
                    }`}
                  >
                    {tagLabel(tag)}
                    <span className="ml-1 text-xs text-faint">
                      {tagCounts[tag]}
                    </span>
                  </Link>
                );
              })}
            </nav>
          </aside>
        )}

        <div className={sortedTags.length > 0 ? "lg:col-span-5" : "lg:col-span-6"}>
          <SearchGrid posts={slimPosts} />
        </div>
      </div>
    </div>
  );
}
