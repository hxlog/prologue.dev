import Link from "next/link";

import { requireUser } from "../../../../../lib/auth/require";
import { getPostForEdit, listRevisions } from "../../../../../lib/studio/posts-write";
import { readMeta } from "../../../../../lib/studio/frontmatter-doc";
import { renderMarkdown } from "../../../../../lib/markdown/render";
import { getAllTags } from "../../../../../lib/content/tags";
import { blobConfigured } from "../../../../../lib/media/blob";
import Editor from "./editor";
import { IconBack } from "../../../../../components/studio/icons";

/**
 * The post editor page.
 *
 * A Server Component that loads everything the editor needs in one round and
 * hands it to one Client Component. The split is deliberate: the document, the
 * taxonomy and the initial rendered HTML are all server work, and the client
 * only owns the interactive buffer.
 *
 * ## The initial HTML
 *
 * Rendered here — by the same `renderMarkdown` the publish path calls — rather
 * than shipped as raw markdown for the client to render. That is what makes the
 * preview "exactly what will be published" instead of "whatever the client's
 * markdown library produces", and it is the property the whole editor choice
 * was made for. It also means the first paint of the preview needs no
 * JavaScript at all.
 */
export const instant = false;

export async function generateMetadata(props) {
  const params = await props.params;
  return { title: `编辑 ${params.slug}` };
}

export default async function EditPostPage(props) {
  const params = await props.params;
  await requireUser();

  const slug = params.slug;
  const row = await getPostForEdit(slug);

  /*
    An inline "no such post" panel rather than `notFound()`.

    Two reasons, one of which is a framework constraint worth recording.

    The constraint: this page sets `instant = false` — it has to, because it
    reads a session — which makes the route one that is ALLOWED TO BLOCK. Next
    answers such a route by sending an empty static shell with a 200 while the
    real render runs, then streaming the result into that already-committed
    response. A `notFound()` thrown during that render arrives after the status
    line is on the wire, so it cannot become a 404; React renders the nearest
    error boundary into a 200 body instead. The public `/blog/[...slug]` route
    returns a real 404 from the same `notFound()` call precisely because it is
    not a blocking route.

    The design reason: a 404 page is the wrong answer here even when the status
    is right. The author is not a stranger who mistyped a URL — they are a
    signed-in person who followed a stale link, and what they need is a way back
    to the list. This says so, in the studio's own chrome, with the slug shown
    so they can see which one missed.

    Verified: an unknown slug renders this panel with a 200, and `/studio/posts`
    is one click away from it.
  */
  if (!row) {
    return (
      <div>
        <Link
          href="/studio/posts"
          className="mb-3 inline-flex items-center gap-1.5 text-xs text-faint transition-colors hover:text-accent"
        >
          <IconBack className="h-3.5 w-3.5" />
          文章
        </Link>

        <div className="rounded-xl border border-border bg-surface px-6 py-16 text-center">
          <p className="text-sm text-foreground">找不到这篇文章</p>
          <p className="mt-1.5 font-mono text-xs text-faint">{slug}</p>
          <p className="mt-4 text-xs text-muted">
            它可能已被删除，或者链接来自更早的版本。
          </p>
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

  const [tags, rendered] = await Promise.all([
    getAllTags(),
    // Re-rendered rather than read from the stored `html` column: this is the
    // preview, and the stored value is what the LAST save produced. If the
    // renderer has changed since (a `RENDERER_VERSION` bump), showing the
    // stored HTML would preview a pipeline that no longer exists.
    renderMarkdown(row.markdown ?? ""),
  ]);

  const initial = {
    slug: row.slug,
    status: row.status,
    revisionNumber: row.revision_number ?? 1,
    markdown: row.markdown ?? "",
    html: rendered.html,
    meta: readMeta(row.markdown ?? ""),
  };

  return (
    <div>
      <Link
        href="/studio/posts"
        className="mb-3 inline-flex items-center gap-1.5 text-xs text-faint transition-colors hover:text-accent"
      >
        <IconBack className="h-3.5 w-3.5" />
        文章
      </Link>

      <Editor initial={initial} tags={tags} mediaConfigured={blobConfigured()} />
    </div>
  );
}
