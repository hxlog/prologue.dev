import Link from "next/link";
import Image from "next/image";
import Comments from "./comments";

/**
 * Friend links. A Server Component on purpose: the list arrives already ordered
 * from the page (src/lib/rotation.js rotates it once per day inside a cache
 * scope), so there is no mount-time shuffle. The old version picked a random
 * seed in an effect and re-sorted the grid after paint -- that is a CLS event
 * by definition (measured 0.099 on /links, a single shift, source = the card
 * link) and it also made the markup differ between the server render and the
 * hydrated one. Sending this from the server also drops the component's hooks
 * and the PRNG from the client bundle.
 */
export default function FriendLinks({ friends }) {
  return (
    <div className="py-12">
      <p className="eyebrow mx-auto w-fit">Friends</p>
      <h1 className="pt-2 text-center text-h1 font-semibold tracking-tight text-foreground">
        友情链接
      </h1>
      <p className="pb-12 pt-3 text-center text-sm text-muted">
        但愿十年后的某天，这些链接仍存活，与各位作者共勉。
      </p>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {(friends || []).map((friend) => (
          <Link
            key={friend.name}
            href={friend.blog_url}
            target="_blank"
            rel="noopener noreferrer"
            className="card card-interactive card-spotlight group p-6 text-center"
          >
            <span className="ring-gradient mx-auto mb-4 inline-block">
              {/* SVG/ICO avatars 400 through /_next/image when
                  dangerouslyAllowSVG is off (the site never enables it), so
                  they are served as-is instead of through the optimizer. */}
              <Image
                src={friend.avatar}
                height={80}
                width={80}
                alt=""
                unoptimized={/\.svg$/i.test(friend.avatar)}
                className="h-20 w-20 rounded-full object-cover"
              />
            </span>
            <h2 className="card-title text-lg font-semibold text-foreground transition-colors duration-(--duration-fast)">
              {friend.name}
            </h2>
            <p className="pt-1 text-sm text-muted">{friend.description}</p>
          </Link>
        ))}
      </div>

      <p className="mt-8 py-8 text-center text-sm text-muted">
        如有意交换友链，请
        <Link className="link mx-1" href="https://github.com/hxlog/prologue.dev/edit/master/data/links.yaml">
          在Github上编辑links.yaml提PR
        </Link>
        或在评论区告知：）
      </p>
      <Comments />
    </div>
  );
}
