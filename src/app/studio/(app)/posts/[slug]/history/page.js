/**
 * Revision history, as a page.
 *
 * The list is a Server Component: revisions come from the database, the diff is
 * computed on the server, and only the *selection* of which two to compare is
 * client state. That split keeps two whole documents out of the browser bundle
 * — a post with sixty revisions would otherwise ship half a megabyte of text to
 * draw a list of dates.
 *
 * ## Why the default comparison is "this revision vs the one before it"
 *
 * The question the author arrives with is almost never "compare r7 to r23". It
 * is "what did I change, and can I get the old one back" — and the answer to
 * the first half is always the adjacent pair. So the page opens with the newest
 * revision selected against its predecessor, and the two selects exist for the
 * cases where that is not the question.
 */

import Link from "next/link";
import { requireUser } from "../../../../../../lib/auth/require";
import {
  getPostForEdit,
  getRevision,
  listRevisions,
} from "../../../../../../lib/studio/posts-write";
import { diffDocuments } from "../../../../../../lib/studio/diff";
import { IconBack } from "../../../../../../components/studio/icons";
import HistoryView from "./history-view";

export const instant = false;

export async function generateMetadata(props) {
  const params = await props.params;
  return { title: `历史 ${params.slug}` };
}

export default async function HistoryPage(props) {
  const params = await props.params;
  await requireUser();

  const slug = params.slug;
  const row = await getPostForEdit(slug);

  if (!row) {
    return (
      <div>
        <BackLink slug={slug} />
        <div className="rounded-xl border border-border bg-surface px-6 py-16 text-center">
          <p className="text-sm text-foreground">找不到这篇文章</p>
          <p className="mt-1.5 font-mono text-xs text-faint">{slug}</p>
          <Link
            href="/studio/posts"
            className="mt-6 inline-block rounded-lg border border-border px-4 py-2 text-sm text-muted transition-colors hover:bg-surface-2 hover:text-accent"
          >
            返回文章列表
          </Link>
        </div>
      </div>
    );
  }

  const revisions = await listRevisions(row.id);

  // The newest against its predecessor. With one revision there is nothing to
  // compare against, so the diff is null and the view says so rather than
  // rendering an empty box.
  const newest = revisions[0] ?? null;
  const previous = revisions[1] ?? null;

  let initial = null;
  if (newest && previous) {
    const [to, from] = await Promise.all([
      getRevision(row.id, newest.id),
      getRevision(row.id, previous.id),
    ]);
    // Diffed in the direction time moves — older on the left — because a diff
    // read backwards is a diff read twice.
    initial = {
      fromId: from.id,
      toId: to.id,
      diff: diffDocuments(from.markdown, to.markdown),
    };
  }

  return (
    <div>
      <BackLink slug={slug} />

      <header className="mb-4">
        <h1 className="text-lg font-semibold tracking-tight text-foreground">
          历史版本
        </h1>
        <p className="mt-1 font-mono text-xs text-faint">{slug}</p>
        <p className="mt-2 text-sm text-muted">
          共 {revisions.length} 个版本。
          {row.status === "published"
            ? "恢复某个版本会创建新的草稿，不会改动已发布的内容。"
            : "恢复某个版本会成为当前草稿。"}
        </p>
      </header>

      <HistoryView
        slug={slug}
        revisions={revisions}
        initial={initial}
        currentRevisionId={row.draft_revision_id}
        publishedRevisionId={row.published_revision_id}
      />
    </div>
  );
}

function BackLink({ slug }) {
  return (
    <Link
      href={`/studio/posts/${slug}`}
      className="mb-3 inline-flex items-center gap-1.5 text-xs text-faint transition-colors hover:text-accent"
    >
      <IconBack className="h-3.5 w-3.5" />
      返回编辑
    </Link>
  );
}
