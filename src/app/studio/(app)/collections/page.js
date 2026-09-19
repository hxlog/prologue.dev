import Link from "next/link";

import { requireUser } from "../../../../lib/auth/require";
import { listCollections } from "../../../../lib/studio/collections-write";
import { IconBack, IconCollections } from "../../../../components/studio/icons";

/**
 * The collection list.
 *
 * Two things are true of a collection and both are on the row, because they are
 * the reasons the author opens this screen at all: how many entries it has, and
 * how many fields it is made of. A collection of zero entries with four fields
 * is one somebody set up and never used.
 *
 * There is no "new collection" button. The two collections that exist are read
 * by two PAGES — `/microblog` renders the microblog and `/links` renders the
 * friend links — with components written for their exact shape, so creating a
 * third collection would produce data nothing renders. Adding a collection is a
 * deliberate act that includes writing its page, and a button here would imply
 * otherwise. The note at the bottom says so rather than leaving the absence to
 * be puzzled over.
 */
export const metadata = { title: "集合" };
export const instant = false;

export default async function CollectionsPage() {
  await requireUser();
  const collections = await listCollections();

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-lg font-semibold tracking-tight text-foreground">集合</h1>
        <p className="mt-1 text-xs text-faint">
          集合是可自定义字段的内容类型，由页面读取后渲染
        </p>
      </header>

      <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
        {collections.map((collection) => (
          <li key={collection.slug} className="transition-colors hover:bg-surface-2">
            <Link
              href={`/studio/collections/${collection.slug}`}
              className="flex items-center gap-3 px-4 py-3"
            >
              <IconCollections className="h-4 w-4 shrink-0 text-faint" />

              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-foreground">{collection.name}</p>
                <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-faint">
                  <span className="font-mono">{collection.slug}</span>
                  <span className="rounded-full bg-surface-3 px-2 py-0.5 text-[11px] text-muted">
                    {collection.entry_count} 条
                  </span>
                  {collection.published_count !== collection.entry_count && (
                    <span>
                      {collection.published_count} 条已发布
                    </span>
                  )}
                  <span>{collection.field_count} 个字段</span>
                  <span>
                    {collection.ordering === "date" ? "按日期排序" : "手动排序"}
                  </span>
                </p>
              </div>

              <IconBack className="h-3.5 w-3.5 shrink-0 rotate-180 text-faint" />
            </Link>
          </li>
        ))}
      </ul>

      <p className="rounded-xl border border-border bg-surface px-3 py-2 text-xs text-muted">
        集合没有自己的公开地址——页面读取集合数据后用自己的组件渲染。
        因此新增集合需要同时写一个页面，这里只提供编辑器。
      </p>
    </div>
  );
}
