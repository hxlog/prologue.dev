import Link from "next/link";

import { requireUser } from "../../../../../lib/auth/require";
import { getPageForEdit } from "../../../../../lib/studio/pages-write";
import { readMeta } from "../../../../../lib/studio/frontmatter-doc";
import { compilePage } from "../../../../../lib/content/mdx";
import { IconBack } from "../../../../../components/studio/icons";
import PageEditor from "./editor";

/**
 * The page editor page.
 *
 * A Server Component that loads everything in one round and hands it to one
 * Client Component, mirroring the post editor. The one structural difference is
 * what "everything" includes: for a page the initial preview is COMPILED
 * bytecode rather than rendered HTML, because that is the artifact a reader's
 * browser receives. `MDXRenderer` evaluates it on both sides, so the preview
 * here and the public page are the same code path.
 *
 * `instant = false` because the page reads a session, which makes this a
 * blocking route — and that in turn is why an unknown slug renders a panel
 * instead of calling `notFound()`. A blocking route commits its status line
 * before the render finishes, so a `notFound()` thrown afterwards cannot become
 * a 404. See the identical note in the post editor.
 */
export const instant = false;

export async function generateMetadata(props) {
  const params = await props.params;
  return { title: `编辑 /${params.slug}` };
}

export default async function EditPagePage(props) {
  const params = await props.params;
  await requireUser();

  const slug = params.slug;
  const row = await getPageForEdit(slug);

  if (!row) {
    return (
      <div>
        <BackLink />
        <div className="rounded-xl border border-border bg-surface px-6 py-16 text-center">
          <p className="text-sm text-foreground">找不到这个页面</p>
          <p className="mt-1.5 font-mono text-xs text-faint">/{slug}</p>
          <p className="mt-4 text-xs text-muted">
            它可能已被删除，或者链接来自更早的版本。
          </p>
          <Link
            href="/studio/pages"
            className="mt-6 inline-block rounded-lg border border-border px-4 py-2 text-sm text-muted transition-colors hover:bg-surface-2 hover:text-accent"
          >
            返回页面列表
          </Link>
        </div>
      </div>
    );
  }

  // Compiled from the CURRENT source rather than read from the stored `html`
  // column, for the same reason the post editor re-renders: the stored value is
  // what the last save produced, and if the pipeline or the compiler has moved
  // on since (a `RENDERER_VERSION` bump), previewing it would show a build that
  // no longer exists. A page that does not compile yet still opens — the error
  // goes to the preview pane rather than to the error boundary, because the
  // author needs the cursor in the file, not a stack trace.
  let code = null;
  let compileError = null;
  try {
    code = String(await compilePage(row.markdown ?? ""));
  } catch (err) {
    compileError = String(err?.message ?? err ?? "").split("\n").slice(0, 6).join("\n");
  }

  const initial = {
    slug: row.slug,
    status: row.status,
    revisionNumber: row.revision_number ?? 1,
    markdown: row.markdown ?? "",
    meta: readMeta(row.markdown ?? ""),
    // Null when the document does not compile, in which case the editor opens
    // on the compile error instead of a preview — see the note above.
    code,
    compileError,
    settings: {
      giscusEnabled: row.giscus_enabled !== false,
      customCss: row.custom_css ?? "",
      showInNav: row.show_in_nav === true,
      navLabel: row.nav_label ?? "",
    },
  };

  return (
    <div>
      <BackLink />
      <PageEditor initial={initial} />
    </div>
  );
}

function BackLink() {
  return (
    <Link
      href="/studio/pages"
      className="mb-3 inline-flex items-center gap-1.5 text-xs text-faint transition-colors hover:text-accent"
    >
      <IconBack className="h-3.5 w-3.5" />
      页面
    </Link>
  );
}
