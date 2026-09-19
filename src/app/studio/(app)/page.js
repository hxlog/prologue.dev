import Link from "next/link";

import { requireUser } from "../../../lib/auth/require";
import { queryMany, queryOne } from "../../../lib/db";
import {
  getOverview,
  getPostViews,
  getDailyViews,
  getTopPaths,
} from "../../../lib/studio/stats";
import {
  IconExternal,
  IconPencil,
  IconWarning,
} from "../../../components/studio/icons";
import { NewPostButton } from "../../../components/studio/new-post-button";

/**
 * The dashboard.
 *
 * Ghost's admin was the reference for what belongs on this screen, and the
 * answer is deliberately small: what just happened, what is in progress, and
 * one button to start writing. A dashboard that tries to be a control panel
 * costs the author more time than the four clicks it saves.
 *
 * ## View counts live here and nowhere else
 *
 * The user's requirement was explicit — view counts appear in /studio, never on
 * the public site. This page and the post editor are the only readers of
 * `src/lib/studio/stats.js`, and that module connects to a different database
 * from everything else in the app. The separation is structural, not a matter
 * of remembering.
 */
export const metadata = { title: "概览" };
export const instant = false;

export default async function DashboardPage() {
  const session = await requireUser();

  // One round of queries, all independent, so they run together. `getOverview`
  // and friends return null rather than throwing when analytics is unreachable,
  // which is why the UI below has to test for null and not just for zero.
  const [posts, draftCount, overview, views, daily, top] = await Promise.all([
    queryMany(
      `SELECT slug, title, status, published_at, updated_at, lastmod,
              (SELECT count(*)::int FROM post_revisions r WHERE r.post_id = p.id) AS revisions
         FROM posts p
        WHERE status <> 'archived'
        ORDER BY updated_at DESC
        LIMIT 12`
    ),
    queryOne(`SELECT count(*)::int AS n FROM posts WHERE status = 'draft'`),
    getOverview(),
    getPostViews(),
    getDailyViews({ days: 30 }),
    getTopPaths({ limit: 6, days: 30 }),
  ]);

  const totalPosts = await queryOne(
    `SELECT count(*)::int AS published FROM posts WHERE status = 'published'`
  );

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight text-foreground">
            概览
          </h1>
          <p className="mt-1 text-sm text-muted">
            {session.user.name ? `${session.user.name}，` : ""}欢迎回来。
          </p>
        </div>

        <NewPostButton />
      </header>

      {/* ── figures ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Figure label="已发布" value={totalPosts?.published ?? 0} />
        <Figure label="草稿" value={draftCount?.n ?? 0} />
        <Figure
          label="近 30 天阅读"
          value={overview ? overview.pageviews30d : null}
          hint={overview ? `累计 ${overview.pageviews}` : "分析不可用"}
        />
        <Figure
          label="近 30 天访客"
          value={overview ? overview.sessions30d : null}
          hint={overview ? `累计 ${overview.sessions}` : "分析不可用"}
        />
      </div>

      {!overview && (
        <p className="flex items-start gap-2 rounded-xl border border-border bg-surface px-4 py-3 text-xs text-muted">
          <IconWarning className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
          <span>
            无法读取阅读量。站点统计来自独立的 Umami 数据库，
            请在设置中检查连接。阅读量只在此处显示，不会出现在前台页面。
          </span>
        </p>
      )}

      {daily && daily.length > 0 && <Sparkline data={daily} />}

      <div className="grid gap-4 lg:grid-cols-2">
        {/* ── recent ──────────────────────────────────────────────── */}
        <section className="rounded-xl border border-border bg-surface">
          <header className="flex items-center justify-between border-b border-border px-4 py-3">
            <h2 className="text-sm font-medium text-foreground">最近编辑</h2>
            <Link href="/studio/posts" className="text-xs text-muted transition-colors hover:text-accent">
              全部
            </Link>
          </header>

          <ul className="divide-y divide-border">
            {posts.map((post) => {
              const path = `/blog/${post.slug}`;
              const stat = views?.get(path);

              return (
                <li key={post.slug}>
                  <Link
                    href={`/studio/posts/${post.slug}`}
                    className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-2"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-foreground">
                        {post.title || "未命名"}
                      </p>
                      <p className="mt-0.5 flex items-center gap-2 text-xs text-faint">
                        <Status status={post.status} />
                        <span>r{post.revisions}</span>
                        <span>{relativeTime(post.updated_at)}</span>
                      </p>
                    </div>

                    {stat ? (
                      <span
                        className="shrink-0 text-xs tabular-nums text-faint"
                        title={`近 30 天 ${stat.views_30d}`}
                      >
                        {stat.views}
                      </span>
                    ) : null}

                    <IconPencil className="h-4 w-4 shrink-0 text-faint" />
                  </Link>
                </li>
              );
            })}

            {posts.length === 0 && (
              <li className="px-4 py-8 text-center text-sm text-faint">
                还没有文章。
              </li>
            )}
          </ul>
        </section>

        {/* ── popular ─────────────────────────────────────────────── */}
        <section className="rounded-xl border border-border bg-surface">
          <header className="flex items-center justify-between border-b border-border px-4 py-3">
            <h2 className="text-sm font-medium text-foreground">近 30 天热门</h2>
            <span className="text-xs text-faint">阅读量</span>
          </header>

          {top && top.length > 0 ? (
            <ul className="divide-y divide-border">
              {top.map((row) => (
                <li key={row.path} className="flex items-center gap-3 px-4 py-3">
                  <a
                    href={row.path}
                    target="_blank"
                    rel="noreferrer"
                    className="min-w-0 flex-1 truncate font-mono text-xs text-muted transition-colors hover:text-accent"
                  >
                    {row.path}
                  </a>
                  <span className="shrink-0 text-xs tabular-nums text-faint">
                    {row.views}
                  </span>
                  <IconExternal className="h-3.5 w-3.5 shrink-0 text-faint" />
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-4 py-8 text-center text-sm text-faint">
              {top ? "近 30 天还没有访问记录。" : "分析不可用。"}
            </p>
          )}
        </section>
      </div>
    </div>
  );
}

function Figure({ label, value, hint }) {
  return (
    <div className="rounded-xl border border-border bg-surface px-4 py-3">
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums tracking-tight text-foreground">
        {/* An em dash, not a zero. See the header: null is "unknown". */}
        {value === null || value === undefined ? "—" : value.toLocaleString("zh-CN")}
      </p>
      {hint && <p className="mt-0.5 text-xs text-faint">{hint}</p>}
    </div>
  );
}

function Status({ status }) {
  if (status === "published") {
    return <span className="text-accent">已发布</span>;
  }
  return <span className="text-amber-600 dark:text-amber-500">草稿</span>;
}

/**
 * A 30-day sparkline.
 *
 * Hand-rolled SVG rather than a charting library: this is one polyline and a
 * filled area, and a charting dependency would be the largest thing in the
 * studio bundle to draw it. The `viewBox` is 0..100 wide and 0..100 tall with
 * `preserveAspectRatio="none"`, so the path scales to whatever width the card
 * has without any measurement in JavaScript.
 */
function Sparkline({ data }) {
  const max = Math.max(...data.map((d) => d.views), 1);
  const step = data.length > 1 ? 100 / (data.length - 1) : 100;

  const points = data.map((d, i) => [i * step, 100 - (d.views / max) * 100]);
  const line = points.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(" ");
  const area = `0,100 ${line} 100,100`;

  const total = data.reduce((n, d) => n + d.views, 0);

  return (
    <section className="rounded-xl border border-border bg-surface px-4 py-3">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-medium text-foreground">30 天趋势</h2>
        <span className="text-xs text-faint">{total.toLocaleString("zh-CN")} 次阅读</span>
      </div>

      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        className="mt-3 h-16 w-full"
        role="img"
        aria-label={`近 30 天共 ${total} 次阅读`}
      >
        <defs>
          <linearGradient id="spark" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.28" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <polygon points={area} fill="url(#spark)" />
        <polyline
          points={line}
          fill="none"
          stroke="var(--accent)"
          strokeWidth="1.5"
          vectorEffect="non-scaling-stroke"
          strokeLinejoin="round"
        />
      </svg>

      <div className="mt-2 flex justify-between text-[11px] text-faint">
        <span>{data[0]?.day}</span>
        <span>{Math.max(...data.map((d) => d.views))} 峰值</span>
        <span>{data[data.length - 1]?.day}</span>
      </div>
    </section>
  );
}

/**
 * "3 分钟前" / "2 天前".
 *
 * Relative rather than absolute, because the question this list answers is
 * "what have I been working on", and 2026-09-19 14:03 does not answer it. Falls
 * back to a date past a month, where "67 天前" stops being useful.
 */
function relativeTime(value) {
  if (!value) return "";
  const then = new Date(value).getTime();
  const seconds = Math.max(0, Math.floor((Date.now() - then) / 1000));

  if (seconds < 60) return "刚刚";
  if (seconds < 3600) return `${Math.floor(seconds / 60)} 分钟前`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} 小时前`;
  if (seconds < 86400 * 30) return `${Math.floor(seconds / 86400)} 天前`;
  return new Date(value).toISOString().slice(0, 10);
}
