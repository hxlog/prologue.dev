const siteMetadata = {
  title: "My Prologue Blog",
  siteName: "Prologue",
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
  zhihu: "",
  copyright: "CC BY-NC-SA 4.0",
  copyrightUrl: "https://creativecommons.org/licenses/by-nc-sa/4.0/",
  feedEmail: "hello@example.com",
  feedGenerator: "Prologue feed pipeline",
  blogLabel: "Blog",
  microblogFeedGenerator: "Prologue microblog feed",
  tenYears: null,

  // Optional self-hosted analytics. Delete this block to ship none.
  umami: {
    scriptUrl: "https://REPLACE_WITH_YOUR_UMAMI_HOST/script.js",
    recorderUrl: "https://REPLACE_WITH_YOUR_UMAMI_HOST/recorder.js",
    websiteId: "REPLACE_WITH_UMAMI_WEBSITE_ID",
    domains: "example.com",
  },

  pages: {
    archive: {
      title: "Archive",
      description: "All posts in one place.",
    },
    microblog: {
      title: "Microblog",
      heading: "Microblog",
      description: "Short notes, images and everyday fragments.",
    },
    links: {
      title: "Friend Links",
      heading: "Friend Links",
      description: "A small collection of sites worth reading.",
    },
    ui: {
      title: "UI Standard",
      heading: "Design system and UI standard",
      description:
        "The site color, type, shape, motion and component standard, read directly from the running CSS.",
      projects: [
        {
          name: "Example Project",
          description: "Replace this with your own open-source project.",
          repo: "example/project",
          stars: "0",
          forks: "0",
        },
      ],
    },
    llms: {
      description:
        "A content-first blog built on Next.js App Router and Markdown.",
    },
  },
};

export const siteRepo = siteMetadata.siteRepo;
export const wechatofficialaccount = siteMetadata.wechatofficialaccount;
export default siteMetadata;
