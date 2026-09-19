import Link from "next/link";

import { requireUser } from "../../../../lib/auth/require";
import { listPagesForStudio } from "../../../../lib/studio/pages-write";
import { IconExternal, IconPages, IconPencil } from "../../../../components/studio/icons";
import { NewPageButton } from "../../../../components/studio/new-page-button";

/**
 * The page list.
 *
 * Short by construction — this site has one page — so it is a list rather than
 * a table with columns. The four facts this screen answers are on each row: is
 * it live, does it have edits waiting, does it take comments, and is it in the
 * navigation. Those are the settings an author changes, and putting them on the
 * row means the answer does not require opening the editor.
 *
 * ## The distinction that matters
 *
 * "草稿" and "有未发布的改动" are different states and the row shows both. A
 * published page with a newer draft is what the author sees for the whole time
 * between opening /about and pressing publish — often hours — and collapsing
 * that into one badge would report a live page as a draft, or a page with
 * pending edits as live.
 */
export const metadata = { title: "页面" };
export const instant = false;

export default async function PagesPage() {
  await requireUser();
  const pages = await listPagesForStudio();

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight text-foreground">页面</h1>
          <p className="mt-1 text-xs text-faint">
            {pages.length} 个页面 · 页面路径就是网址本身
          </p>
        </div>
        <NewPageButton />
      </header>

      {pages.length === 0 ? (
        <p className="rounded-xl border border-border bg-surface px-4 py-12 text-center text-sm text-faint">
          还没有页面。
        </p>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
          {pages.map((page) => (
            <li key={page.slug} className="transition-colors hover:bg-surface-2">
              <div className="flex items-center gap-3 px-4 py-3">
                <IconPages className="hidden h-4 w-4 shrink-0 text-faint sm:block" />

                <Link href={`/studio/pages/${page.slug}`} className="min-w-0 flex-1">
                  <p className="truncate text-sm text-foreground">
                    {page.title || "未命名"}
                  </p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-faint">
                    <span className="font-mono">/{page.slug}</span>
                    <StatusPill page={page} />
                    {page.giscus_enabled === false && <span>评论关闭</span>}
                    {page.has_custom_css && <span>自定义 CSS</span>}
                    {page.show_in_nav && (
                      <span>导航：{page.nav_label || page.title || page.slug}</span>
                    )}
                    <span className="text-faint/70">{shortDate(page.updated_at)}</span>
                    {page.revisions > 1 && <span>{page.revisions} 个版本</span>}
                  </p>
                </Link>

                <a
                  href={`/${page.slug}`}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={`查看 /${page.slug}`}
                  className="hidden h-7 w-7 shrink-0 items-center justify-center rounded-full text-faint transition-colors hover:bg-surface-3 hover:text-accent sm:flex"
                >
                  <IconExternal className="h-3.5 w-3.5" />
                </a>

                <Link
                  href={`/studio/pages/${page.slug}`}
                  aria-label={`编辑 ${page.title || page.slug}`}
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-faint transition-colors hover:bg-surface-3 hover:text-accent"
                >
                  <IconPencil className="h-3.5 w-3.5" />
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Two facts, not one.
 *
 * A page can be published AND have an unpublished draft — which is the state it
 * is in from the moment the author opens it until they press publish. Showing
 * only one of the two would either report a live page as a draft or hide the
 * fact that there are edits waiting.
 */
function StatusPill({ page }) {
  if (page.status !== "published") {
    return (
      <span className="rounded-full bg-surface-3 px-2 py-0.5 text-[11px] font-medium text-muted">
        草稿
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-medium text-accent">
        已发布
      </span>
      {page.pending && (
        <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-medium text-amber-600 dark:text-amber-500">
          有未发布的改动
        </span>
      )}
    </span>
  );
}

function shortDate(value) {
  if (!value) return "—";
  return new Date(value).toISOString().slice(0, 10);
}
