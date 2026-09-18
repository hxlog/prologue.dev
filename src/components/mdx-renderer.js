"use client";

import Link from "next/link";
import Image from "next/image";
import { useMemo } from "react";
import { evaluatePage } from "../lib/content/mdx-runtime";

/**
 * Renders a Page's compiled MDX.
 *
 * The evaluation is memoised on the code string: `new Function` on every render
 * would re-JIT the whole page body each time React commits, and the code only
 * changes when the author publishes.
 *
 * Where the code comes from, since that is the whole of the safety argument:
 * `page_revisions.html`, written at publish time by `compilePage()` on our own
 * server, from markdown the authenticated owner typed. It is never assembled
 * from a request parameter or a URL segment. If that ever changes, this
 * component is the wrong place to render it — a page whose bytecode could have
 * come from a reader belongs in server-rendered HTML, not `new Function` in a
 * visitor's browser. See src/lib/content/mdx-runtime.js.
 *
 * The `components` map mirrors what `MDXComponent` supplies today, so a page's
 * images keep the site's rounded card look and its links keep opening in a new
 * tab. It is module-scoped and therefore stable — a fresh object each render
 * would invalidate the memo and remount the subtree.
 */
const ResponsiveImage = (props) => (
  <Image
    alt={props.alt}
    src={props.src}
    loading="lazy"
    decoding="async"
    data-lightbox="true"
    className={`${props.className || ""} lightbox-image cursor-zoom-in rounded-lg mx-auto`.trim()}
    style={{ maxWidth: "100%", height: "auto" }}
    width={props.width ? Number(props.width) : 1920}
    height={props.height ? Number(props.height) : 1080}
    {...props}
  />
);

const ResponsiveLink = (props) => <Link target="_blank" {...props} />;

const COMPONENTS = {
  img: ResponsiveImage,
  a: ResponsiveLink,
};

export default function MDXRenderer({ code }) {
  // The component is produced by evaluating stored bytecode, not authored here,
  // so the "components created during render" rule does not apply: it is stable
  // per `code` (memoised), and `code` only changes when the author publishes.
  const Component = useMemo(() => evaluatePage(code), [code]);

  if (!Component) return null;

  // eslint-disable-next-line react-hooks/static-components
  return <Component components={COMPONENTS} />;
}
