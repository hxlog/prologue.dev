const siteMetadata = {
  title: "My Prologue Blog",
  author: "Your Name",
  authorDesc: "Write a short bio here",
  publishName: "Prologue",
  headerTitle: "What's past is prologue",
  description: "A content-first blog built on Next.js App Router and Markdown.",
  language: "en-US",
  keywords: ["blog", "nextjs", "markdown"],
  siteUrl: "https://prologue-blog-demo.prologue.dev/",
  siteRepo: "my-blog",
  // Giscus comments. Create the repo's Discussions, install the Giscus app,
  // then copy both IDs from https://giscus.app. Leave them as-is to disable.
  repoid: "REPLACE_WITH_GISCUS_REPO_ID",
  categoryid: "REPLACE_WITH_GISCUS_CATEGORY_ID",
  favicon: "/favicon.svg",
  avatar: "/static/favicons/avatar-template.svg",
  cover: "/static/favicons/cover-template.svg",
  email: "hello@example.com",
  github: "your-github-id",

  // Optional self-hosted analytics. Delete this block to ship none.
  umami: {
    scriptUrl: "https://REPLACE_WITH_YOUR_UMAMI_HOST/script.js",
    recorderUrl: "https://REPLACE_WITH_YOUR_UMAMI_HOST/recorder.js",
    websiteId: "REPLACE_WITH_UMAMI_WEBSITE_ID",
    domains: "example.com",
  },
};

module.exports = siteMetadata;
