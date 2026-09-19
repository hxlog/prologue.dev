import Link from "next/link";

import { requireUser } from "../../../../../lib/auth/require";
import {
  getCollectionForEdit,
  listEntries,
} from "../../../../../lib/studio/collections-write";
import { IconBack } from "../../../../../components/studio/icons";
import CollectionEditor from "./collection-editor";

/**
 * One collection: its fields and its entries.
 *
 * A blocking route (it reads a session), which is why an unknown slug renders a
 * panel rather than calling `notFound()` — the same constraint and the same
 * reasoning as the post and page editors. Next commits the status line before a
 * blocking render finishes, so a `notFound()` thrown afterwards cannot become a
 * 404.
 *
 * Both the schema and the entries are loaded here and handed down together,
 * because the entries tab renders a form FROM the schema. Fetching the entries
 * on tab switch would mean the entries tab could not render a single row until
 * a second round trip.
 */
export const instant = false;

export async function generateMetadata(props) {
  const params = await props.params;
  return { title: `集合 ${params.slug}` };
}

export default async function CollectionPage(props) {
  const params = await props.params;
  await requireUser();

  const slug = params.slug;
  const collection = await getCollectionForEdit(slug);

  if (!collection) {
    return (
      <div>
        <BackLink />
        <div className="rounded-xl border border-border bg-surface px-6 py-16 text-center">
          <p className="text-sm text-foreground">找不到这个集合</p>
          <p className="mt-1.5 font-mono text-xs text-faint">{slug}</p>
          <Link
            href="/studio/collections"
            className="mt-6 inline-block rounded-lg border border-border px-4 py-2 text-sm text-muted transition-colors hover:bg-surface-2 hover:text-accent"
          >
            返回集合列表
          </Link>
        </div>
      </div>
    );
  }

  const entries = await listEntries(collection.id);

  return (
    <div className="space-y-4">
      <BackLink />

      <header>
        <h1 className="text-lg font-semibold tracking-tight text-foreground">
          {collection.name}
        </h1>
        <p className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-faint">
          <span className="font-mono">{collection.slug}</span>
          <span>{collection.ordering === "date" ? "按日期排序" : "手动排序"}</span>
          {collection.description && <span>{collection.description}</span>}
        </p>
      </header>

      <CollectionEditor slug={slug} collection={collection} entries={entries} />
    </div>
  );
}

function BackLink() {
  return (
    <Link
      href="/studio/collections"
      className="inline-flex items-center gap-1.5 text-xs text-faint transition-colors hover:text-accent"
    >
      <IconBack className="h-3.5 w-3.5" />
      集合
    </Link>
  );
}
