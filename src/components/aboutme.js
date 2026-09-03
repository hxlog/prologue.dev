import Link from "next/link";
import Image from "next/image";
import { allPosts } from "contentlayer/generated";
import siteMetadata from "../../data/sitemetadata";

const POSTS_NUM = allPosts.filter((p) => p.draft !== true).length;
const TOTAL_WORDS = allPosts
  .reduce((sum, post) => sum + (post.readingTime?.words ?? 0), 0)
  .toLocaleString();

export default function AboutMe() {
  return (
    <>
      <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted">
        <span
          className="inline-block h-3 w-1 rounded-full"
          style={{ background: "var(--gradient-brand)" }}
          aria-hidden="true"
        />
        关于作者
      </h2>
      <Link href="/about">
        <Image
          src={siteMetadata.avatar}
          alt="Avatar"
          width="100"
          height="100"
          className="mx-auto mt-6 max-w-md rounded-full drop-shadow-sm ring-2 ring-border transition-all duration-300 hover:scale-105 hover:ring-accent"
        />
      </Link>
      <p className="pt-4 text-center text-lg font-medium text-foreground">
        {siteMetadata.author}
      </p>

      <div className="mx-auto grid grid-cols-2 divide-x divide-border py-4">
        <div className="grid grid-rows-2 px-2 text-center">
          <Link
            href="/blog"
            className="font-semibold text-foreground transition-colors duration-200 hover:text-accent"
          >
            {POSTS_NUM}
          </Link>
          <p className="pt-1 text-sm text-faint">文章</p>
        </div>

        <div className="grid grid-rows-2 px-2 text-center">
          <span className="font-semibold text-foreground">{TOTAL_WORDS}</span>
          <p className="pt-1 text-sm text-faint">字数</p>
        </div>
      </div>
      <p className="mx-auto mb-2 py-2 text-center leading-7 text-muted">
        {siteMetadata.authorDesc}
      </p>
      <Link href="/about" passHref>
        <p className="pt-2 text-right text-sm text-muted transition-colors duration-300 hover:text-accent hover:underline">
          了解更多 →
        </p>
      </Link>
    </>
  );
}
