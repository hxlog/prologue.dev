"use client";

import { useState } from "react";
import Card from "./card";

const PAGE_SIZE = 8;

/**
 * Card grid + "load more" for /blog and /tags/*.
 *
 * Receives SLIM post objects from a server component (never full content
 * documents) so the RSC payload stays small. Search used to live here too; it
 * is now the navbar dialog (server-side, full text), so this grid is display
 * only and no longer downloads a search index.
 */
export default function PostGrid({ posts, className = "" }) {
  const [visible, setVisible] = useState(PAGE_SIZE);
  const list = posts.slice(0, visible);

  const loadMore = () => setVisible((prev) => prev + PAGE_SIZE);

  return (
    <div className={className}>
      <div className="min-h-[40vh]">
        {list.length > 0 ? (
          <div className="grid gap-4 md:grid-cols-2">
            {list.map((post) => (
              <Card
                key={post.slug}
                slug={post.slug}
                title={post.title}
                description={post.description}
                publishDate={post.publishDate || post.date}
                tags={post.tags}
                readingTime={post.readingTime}
              />
            ))}
          </div>
        ) : (
          <p className="py-10 text-center text-sm text-muted">暂无文章</p>
        )}
      </div>

      {posts.length > visible && (
        <div className="mt-8 flex justify-center">
          <button type="button" onClick={loadMore} className="btn btn-ghost">
            加载更多
          </button>
        </div>
      )}
    </div>
  );
}
