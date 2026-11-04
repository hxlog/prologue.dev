"use client";

import Giscus from "@giscus/react";
import { useTheme } from "next-themes";
import siteMetadata from "../../data/sitemetadata";

// Split out of comments.js so the @giscus/react chunk is only requested once
// the reader is near the comment section (see comments.js). Keeping the
// third-party widget behind a dynamic import is the whole point of the split:
// a static import here would put the library back in the article's initial JS.
export default function GiscusEmbed() {
  const { resolvedTheme } = useTheme();
  const commentsTheme = resolvedTheme === "dark" ? "transparent_dark" : "light";

  return (
    <Giscus
      repo={`${siteMetadata.github}/${siteMetadata.siteRepo}`}
      repoId={siteMetadata.repoid}
      category="Announcements"
      categoryId={siteMetadata.categoryid}
      mapping="pathname"
      reactionsEnabled="1"
      inputPosition="top"
      theme={commentsTheme}
      lang="en"
    />
  );
}
