import { requireUser } from "../../../../lib/auth/require";
import { countMedia, listMedia } from "../../../../lib/media/library";
import { blobConfigured } from "../../../../lib/media/blob";
import { MediaLibrary } from "./media-library";

/**
 * The media library.
 *
 * ## It reads the database, not the store
 *
 * Every object in the private store has a row here, and the row is what this
 * screen shows — alt text, captions, the name the file arrived with. A listing
 * from Blob would be a file browser: it can show `9f3c1a2b.jpg` and nothing
 * about what is in it, and it cannot say which of the objects anything actually
 * links to. `scripts/studio/media-reconcile.mjs` is the one thing that reads the
 * store, and its whole job is to find the rows and blobs that disagree.
 *
 * Read uncached. It is a screen one person opens to move a file or fix a caption,
 * it changes on every upload, and caching it would add an invalidation to reason
 * about in exchange for saving a query nobody would wait for. See
 * `src/lib/media/library.js` for the one read that IS cached — the
 * published-media answer the /api/img proxy uses — and why.
 */
export const metadata = { title: "媒体" };
export const instant = false;

export default async function MediaPage() {
  await requireUser();

  const configured = blobConfigured();
  const [items, total] = configured
    ? await Promise.all([listMedia({ limit: 120 }), countMedia()])
    : [[], 0];

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-lg font-semibold tracking-tight text-foreground">媒体</h1>
        <p className="mt-1 text-xs text-faint">
          {configured
            ? `${total} 个文件 · 存放在私有 Blob，通过 /api/img 读取`
            : "未配置 Blob 存储"}
        </p>
      </header>

      <MediaLibrary initial={items} total={total} configured={configured} />
    </div>
  );
}
