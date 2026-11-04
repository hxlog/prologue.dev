import Link from "next/link";
import Image from "next/image";
import { getPosts } from "../lib/content";
import siteMetadata from "../../data/sitemetadata";

/**
 * Sidebar author card, shared by the homepage and the post page.
 *
 * Server component: the post/word counts come from the content loader at
 * render time. `getPosts()` is a function rather than an array precisely so
 * these numbers follow a content edit; see src/lib/content/load.js.
 */
export default function AboutMe() {
  const allPosts = getPosts();
  const POSTS_NUM = allPosts.filter((p) => p.draft !== true).length;
  const TOTAL_WORDS = allPosts
    .reduce((sum, post) => sum + (post.readingTime?.words ?? 0), 0)
    .toLocaleString();

  return (
    <div className="text-center">
      <h2 className="section-label">关于作者</h2>

      <Link href="/about" className="group mt-6 inline-block">
        <span className="ring-gradient block transition-transform duration-(--duration-base) ease-out-expo group-hover:scale-105">
          <Image
            src={siteMetadata.avatar}
            alt={siteMetadata.author}
            width={96}
            height={96}
            className="h-24 w-24 rounded-full object-cover ring-2 ring-background"
          />
        </span>
      </Link>

      <p className="mt-3 text-lg font-medium text-foreground">
        {siteMetadata.author}
      </p>

      <div className="mx-auto mt-4 grid grid-cols-2 divide-x divide-border">
        <div className="px-2">
          <Link
            href="/blog"
            className="block font-semibold text-foreground transition-colors duration-(--duration-fast) hover:text-accent"
          >
            {POSTS_NUM}
          </Link>
          <p className="mt-1 text-sm text-faint">文章</p>
        </div>
        <div className="px-2">
          <span className="block font-semibold text-foreground">
            {TOTAL_WORDS}
          </span>
          <p className="mt-1 text-sm text-faint">字数</p>
        </div>
      </div>

      <p className="mx-auto mt-4 text-sm leading-7 text-muted">
        {siteMetadata.authorDesc}
      </p>

      <Link href="/about" className="link mt-3 inline-block text-sm">
        了解更多 →
      </Link>
    </div>
  );
}
