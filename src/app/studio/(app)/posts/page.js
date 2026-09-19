import Link from "next/link";

import { requireUser } from "../../../../lib/auth/require";
import { queryMany } from "../../../../lib/db";
import { getPostViews } from "../../../../lib/studio/stats";
import { IconPencil, IconPlus, IconWarning } from "../../../../components/studio/icons";
import { NewPostButton } from "../../../../components/studio/new-post-button";

/**
 * The post list.
 *
 * A table above `sm`, stacked rows below it. A six-column table on a phone is
 * either horizontally scrollable — which nobody does — or unreadable, and the
 * two things this screen is for are "find a post" and "see what state it is
 * in", both of which survive the stacked form.
 *
 * ## Why there is no search box
 *
 * The blog has 63 posts and one author who wrote all of them. A search field
 * here would be a filter over a list that fits on two screens; the author's
 * real question is "which one did I just edit", and that is the default sort.
 * If the corpus ever grows past a few hundred this is the thing to add — not
 * before, because an empty search box is a control that teaches the reader the
 * page is more complicated than it is.
 */
export const metadata = { title: "文章" };
export const instant = false;

const FILTERS = [
  { key: "all", label: "全部", where: `p.status <> 'archived'` },
  { key: "published", label: "已发布", where: `p.status = 'published'` },
  { key: "draft", label: "草稿", where: `p.status = 'draft'` },
];

export default async function PostsPage(props) {
  await requireUser();
  const search = await props.searchParams;
  const filter = FILTERS.find((f) => f.key === search?.filter) ?? FILTERS[0];

  const [posts, views] = await Promise.all([
    queryMany(
      `SELECT p.slug, p.title, p.status, p.featured, p.published_at, p.updated_at,
              (SELECT count(*)::int FROM post_revisions r WHERE r.post_id = p.id) AS revisions,
              coalesce(
                (SELECT array_agg(t.slug ORDER BY pt.position)
                   FROM post_tags pt JOIN tags t ON t.id = pt.tag_id
                  WHERE pt.post_id = p.id),
                '{}'
              ) AS tags
         FROM posts p
        WHERE ${filter.where}
        ORDER BY p.updated_at DESC`,
      []
    ),
    getPostViews(),
  ]);

  const counts = await queryMany(
    `SELECT status, count(*)::int AS n FROM posts GROUP BY status`
  );
  const byStatus = Object.fromEntries(counts.map((c) => [c.status, c.n]));
  const total = Object.values(byStatus).reduce((a, b) => a + b, 0);

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight text-foreground">文章</h1>
          <p className="mt-1 text-xs text-faint">
            {byStatus.published ?? 0} 篇已发布
            {byStatus.draft ? ` · ${byStatus.draft} 篇草稿` : ""}
            {total ? ` · 共 ${total} 篇` : ""}
          </p>
        </div>
        <NewPostButton />
      </header>

      <nav className="flex gap-1 rounded-lg bg-surface-2 p-1">
        {FILTERS.map((f) => {
          const active = f.key === filter.key;
          return (
            <Link
              key={f.key}
              href={f.key === "all" ? "/studio/posts" : `/studio/posts?filter=${f.key}`}
              aria-current={active ? "page" : undefined}
              className={`flex-1 rounded-md px-3 py-1.5 text-center text-sm transition-colors sm:flex-none ${
                active
                  ? "bg-surface font-medium text-foreground shadow-sm"
                  : "text-muted hover:text-accent"
              }`}
            >
              {f.label}
            </Link>
          );
        })}
      </nav>

      {!views && (
        <p className="flex items-start gap-2 rounded-xl border border-border bg-surface px-3 py-2 text-xs text-muted">
          <IconWarning className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
          <span>阅读量不可用（分析数据库未连接）。</span>
        </p>
      )}

      {posts.length === 0 ? (
        <p className="rounded-xl border border-border bg-surface px-4 py-12 text-center text-sm text-faint">
          {filter.key === "all" ? "还没有文章。" : "这个筛选下没有文章。"}
        </p>
      ) : (
        <>
          {/* ── desktop table ───────────────────────────────────────── */}
          <div className="hidden overflow-hidden rounded-xl border border-border bg-surface sm:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-faint">
                  <th className="px-4 py-2 font-medium">标题</th>
                  <th className="px-3 py-2 font-medium">状态</th>
                  <th className="hidden px-3 py-2 font-medium md:table-cell">标签</th>
                  <th className="hidden px-3 py-2 text-right font-medium lg:table-cell">
                    阅读
                  </th>
                  <th className="px-3 py-2 text-right font-medium">更新</th>
                  <th className="w-10 px-3 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {posts.map((post) => {
                  const stat = views?.get(`/blog/${post.slug}`);
                  return (
                    <tr key={post.slug} className="transition-colors hover:bg-surface-2">
                      <td className="max-w-0 px-4 py-2.5">
                        <Link
                          href={`/studio/posts/${post.slug}`}
                          className="block truncate text-foreground transition-colors hover:text-accent"
                        >
                          {post.title || "未命名"}
                        </Link>
                        <span className="mt-0.5 block truncate font-mono text-[11px] text-faint">
                          {post.slug}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5">
                        <StatePill status={post.status} featured={post.featured} />
                      </td>
                      <td className="hidden px-3 py-2.5 md:table-cell">
                        <TagList tags={post.tags} />
                      </td>
                      <td className="hidden px-3 py-2.5 text-right text-xs tabular-nums text-faint lg:table-cell">
                        {stat ? stat.views : "—"}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-right text-xs text-faint">
                        {shortDate(post.updated_at)}
                      </td>
                      <td className="px-3 py-2.5">
                        <Link
                          href={`/studio/posts/${post.slug}`}
                          aria-label={`编辑 ${post.title || post.slug}`}
                          className="flex h-7 w-7 items-center justify-center rounded-full text-faint transition-colors hover:bg-surface-3 hover:text-accent"
                        >
                          <IconPencil className="h-3.5 w-3.5" />
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* ── phone list ──────────────────────────────────────────── */}
          <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface sm:hidden">
            {posts.map((post) => {
              const stat = views?.get(`/blog/${post.slug}`);
              return (
                <li key={post.slug}>
                  <Link
                    href={`/studio/posts/${post.slug}`}
                    className="block px-4 py-3 transition-colors active:bg-surface-2"
                  >
                    <p className="truncate text-sm text-foreground">
                      {post.title || "未命名"}
                    </p>
                    <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-faint">
                      <StatePill status={post.status} featured={post.featured} />
                      <span>{shortDate(post.updated_at)}</span>
                      {stat ? <span>{stat.views} 阅读</span> : null}
                    </p>
                  </Link>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}

function StatePill({ status, featured }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
          status === "published"
            ? "bg-accent-soft text-accent"
            : "bg-surface-3 text-muted"
        }`}
      >
        {status === "published" ? "已发布" : "草稿"}
      </span>
      {featured && (
        <span className="rounded-full bg-secondary-soft px-2 py-0.5 text-[11px] font-medium text-secondary-strong">
          推荐
        </span>
      )}
    </span>
  );
}

function TagList({ tags }) {
  if (!tags?.length) return <span className="text-xs text-faint">—</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {tags.slice(0, 3).map((tag) => (
        <span
          key={tag}
          className="rounded-full bg-surface-3 px-2 py-0.5 font-mono text-[10px] text-muted"
        >
          {tag}
        </span>
      ))}
      {tags.length > 3 && (
        <span className="text-[10px] text-faint">+{tags.length - 3}</span>
      )}
    </span>
  );
}

function shortDate(value) {
  if (!value) return "—";
  return new Date(value).toISOString().slice(0, 10);
}
