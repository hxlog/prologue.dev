/**
 * Page actions: what the page editor screen calls.
 *
 * Mirrors actions/posts.js, with the three differences a page forces:
 *
 *  - **Compiling replaces rendering.** `renderMarkdown` is still called — for
 *    the search index, which wants plain text rather than a component — but the
 *    artifact that goes into `page_revisions.html` is MDX bytecode. So unlike a
 *    post, a page's save cannot hand its stored artifact back to the client as
 *    markup; the editor previews from a *recompile* of the source, which is the
 *    same code path that produced the stored value.
 *
 *  - **A compile error is an authoring error.** A page whose MDX does not parse
 *    must fail while the author is looking at the line, not at publish time,
 *    and must not take the editor down with it — the unsaved text is still in
 *    the browser and one line of it needs fixing.
 *
 *  - **Slug changes are real.** A post gets its path when it is created; a page
 *    IS its path, and people type it. Renaming one leaves a redirect behind.
 */

"use server";

import { revalidatePath } from "next/cache";

import { requireUser } from "../../../lib/auth/require";
import {
  changePageSlug,
  createPage,
  deletePage,
  getPageForEdit,
  getPageRevision,
  listPageRevisions,
  publishPage,
  restorePageRevision,
  savePage,
  unpublishPage,
} from "../../../lib/studio/pages-write";
import { compilePage } from "../../../lib/content/mdx";
import { renderMarkdown } from "../../../lib/markdown/render";
import {
  invalidatePage,
  invalidateNav,
  invalidateRedirects,
} from "../../../lib/studio/cache-tags";
import { indexPage, unindex } from "../../../lib/studio/search-write";
import { readMeta } from "../../../lib/studio/frontmatter-doc";
import { diffDocuments } from "../../../lib/studio/diff";
import { setRedirect } from "../../../lib/studio/redirects";

/**
 * Compile the document for the preview pane.
 *
 * Returning BYTECODE rather than markup, because that is what a reader's
 * browser is handed and therefore the only honest preview of a page. The
 * component is not evaluated here — `MDXRenderer` evaluates it in the browser,
 * exactly as the public route does.
 */
export async function renderPagePreview(markdown) {
  await requireUser();
  const source = String(markdown ?? "");
  try {
    return { ok: true, code: String(await compilePage(source)) };
  } catch (err) {
    return { ok: false, message: compileMessage(err) };
  }
}

/** Autosave, mirroring `autosavePost`. */
export async function autosavePage(slug, { markdown, meta, settings, revision }) {
  const session = await requireUser();

  const current = await getPageForEdit(slug);
  if (!current) return { ok: false, reason: "not_found" };

  // Same optimistic-concurrency rule as posts: a conflict is only reported when
  // the write would actually lose something. `>` rather than `!==` because a
  // restore moves the number forward too, and an author who restored a revision
  // and then typed should not be told they conflict with themselves.
  if (
    typeof revision === "number" &&
    current.revision_number > revision &&
    current.draft_revision_id !== current.published_revision_id
  ) {
    return { ok: false, reason: "conflict", serverRevision: current.revision_number };
  }

  let result;
  try {
    result = await savePage(slug, {
      markdown,
      meta,
      settings,
      userId: session.user.id,
    });
  } catch (err) {
    return { ok: false, reason: "invalid", message: compileMessage(err) };
  }

  if (!result.ok) return result;

  if (result.changed) {
    invalidatePage(slug);
    revalidatePath(`/studio/pages/${slug}`);
  }

  // Separate from `changed`: a save that toggled "显示在导航栏" without touching
  // a byte of the document still has to rebuild the header, and a save that
  // rewrote the whole page while leaving the switch alone must not.
  if (result.navChanged) invalidateNav();

  return {
    ok: true,
    changed: result.changed,
    navChanged: result.navChanged === true,
    revisionNumber: result.revisionNumber,
    markdown: result.markdown,
  };
}

/** Create a page and hand back its slug. */
export async function createPageAction(input) {
  await requireUser();
  const result = await createPage(input ?? {});
  if (result.ok) {
    invalidatePage(result.slug);
    revalidatePath("/studio/pages");
  }
  return result;
}

/**
 * Publish.
 *
 * The title check is the one that matters. For a post, "untitled" is a title
 * like any other; for a page the title is the `<h1>`, the metadata title and
 * the nav label, so a page without one is a nameless entry in the header and an
 * empty string in a browser tab. The write refuses, and the screen says why.
 */
export async function publishPageAction(slug) {
  const session = await requireUser();
  const result = await publishPage(slug, { userId: session.user.id });
  if (!result.ok) return result;

  invalidatePage(slug);
  revalidatePath(`/studio/pages/${slug}`);
  revalidatePath(`/${slug}`);

  // Reindexed on publish, not on save: only a published page is searchable, and
  // indexing a draft would put a URL in the index that 404s.
  await reindexPage(slug);

  return result;
}

export async function unpublishPageAction(slug) {
  await requireUser();
  const result = await unpublishPage(slug);
  if (!result.ok) return result;

  await unindex(`page:${slug}`);
  invalidatePage(slug);
  revalidatePath(`/studio/pages/${slug}`);
  revalidatePath(`/${slug}`);
  return result;
}

/**
 * Delete.
 *
 * A page is a URL, so deleting one leaves a hole where a URL used to be. The
 * nav entry and the search row go with it (see `deletePage`); the caller is
 * handed the slug so it can offer to leave a redirect.
 */
export async function deletePageAction(slug) {
  await requireUser();
  const result = await deletePage(slug);
  if (!result.ok) return result;

  await unindex(`page:${slug}`);
  invalidatePage(slug);
  // The page's nav row went with it (see `deletePage`), so the header has to be
  // rebuilt — otherwise the site's own navigation keeps linking to a 404.
  invalidateNav();
  revalidatePath("/studio/pages");
  revalidatePath(`/${slug}`);
  return result;
}

/**
 * Rename a page, retiring the old path.
 *
 * `setRedirect` is what makes this safe rather than destructive. Without it a
 * rename is a 404 for every reader who follows a link they already had — which
 * for a page is most of them, because pages are the parts of a site people link
 * to and bookmark.
 */
export async function renamePageAction(slug, nextSlug) {
  await requireUser();
  const result = await changePageSlug(slug, nextSlug);
  if (!result.ok || result.unchanged) return result;

  await setRedirect(`/${result.previous}`, `/${result.slug}`, { permanent: true });
  invalidateRedirects();
  await reindexPage(result.slug);

  invalidatePage(result.previous);
  invalidatePage(result.slug);
  // The rename moved the page's nav row (`changePageSlug` updates both its href
  // and its `page_slug` pointer), so the header is stale until this runs.
  invalidateNav();
  revalidatePath("/studio/pages");
  revalidatePath(`/${result.previous}`);
  revalidatePath(`/${result.slug}`);
  return result;
}

/* ── history ─────────────────────────────────────────────────────────────── */

export async function loadPageRevisionsAction(slug) {
  await requireUser();
  const row = await getPageForEdit(slug);
  if (!row) return { ok: false, reason: "not_found" };
  return { ok: true, revisions: await listPageRevisions(row.id) };
}

/**
 * A line diff between two revisions.
 *
 * Computed on the server: an MDX page is a few kilobytes of JSX, and shipping
 * two whole documents to the browser to compute the diff there would send
 * roughly what the diff itself contains, multiplied by the number of revisions
 * being compared.
 */
export async function diffPageRevisions(slug, fromId, toId) {
  await requireUser();
  const row = await getPageForEdit(slug);
  if (!row) return { ok: false, reason: "not_found" };

  const [from, to] = await Promise.all([
    getPageRevision(row.id, fromId),
    getPageRevision(row.id, toId),
  ]);
  if (!from || !to) return { ok: false, reason: "not_found" };

  return { ok: true, diff: diffDocuments(from.markdown, to.markdown) };
}

export async function restorePageRevisionAction(slug, revisionId) {
  const session = await requireUser();
  const result = await restorePageRevision(slug, revisionId, {
    userId: session.user.id,
  });
  if (!result.ok) return result;

  invalidatePage(slug);
  revalidatePath(`/studio/pages/${slug}`);
  return result;
}

/* ── helpers ─────────────────────────────────────────────────────────────── */

/**
 * Put a page into the search index, from its current draft.
 *
 * The index wants plain text, which is why `renderMarkdown` is called here even
 * though the page itself renders from bytecode: the searchable text of a page
 * is its prose, and asking a compiled component for that is not possible.
 */
async function reindexPage(slug) {
  const row = await getPageForEdit(slug);
  if (!row || row.status !== "published") return;

  const { html } = await renderMarkdown(row.markdown ?? "");
  await indexPage({
    pageId: row.id,
    slug,
    title: row.title ?? "",
    description: row.description ?? null,
    html,
    publishedAt: row.published_at,
  });
}

/**
 * Turn a compiler exception into something an author can act on.
 *
 * `@mdx-js/mdx` throws a VFileMessage whose `message` is already the useful
 * part — the offending character and the line and column — followed by the
 * contents of that line. The stack is the parts of the MDX toolchain the author
 * did not invoke, so it is dropped rather than shown under a wall of `at …`
 * frames.
 */
function compileMessage(err) {
  const message = String(err?.message ?? err ?? "").trim();
  if (!message) return "页面无法编译，请检查 MDX 语法。";
  return message.split("\n").slice(0, 6).join("\n");
}
