const siteName = "槐序的序章";
const siteUrl = "https://prologue.dev";
const siteHost = new URL(siteUrl).hostname;

/**
 * Agent discovery metadata. The shared identity fields above are reused rather
 * than duplicated: names are derived from siteName, and only the values that
 * cannot be inferred (the client-config key and the public signing key) live
 * here. The private Web Bot Auth key is never committed.
 */
const agent = {
  mcpClientName: "prologue_blog",
  mcpServerName: siteName + " MCP Content Server",
  a2aName: siteName + " Content Agent",
  apiTitle: siteName + " content API",
  mcpServerSlug: siteHost.split(".").reverse().join(".") + "/content-agent",
  credentialType:
    "urn:" +
    siteHost.replace(/[^a-z0-9]+/gi, "-").toLowerCase() +
    ":anonymous-agent-credential",
  webBotAuthKey: {
    kty: "OKP",
    crv: "Ed25519",
    x: "Kl1jYRrmzreg3FqwngTEqUMJfbIwV058ua1wWVRhAFw",
  },
};

const siteMetadata = {
  siteName,
  author: "槐序",
  authorDesc: "00后/INFJ/少数派/梦想成为自由职业者",
  headerTitle: "What's past is prologue",
  description: "对当下的反思和批判",
  language: "zh-CN",
  keywords: ["prologue", "序章", "槐序", "槐序的序章"],
  siteUrl,
  siteRepo: "prologue.dev",
  repoid: "R_kgDOHl4HGg",
  categoryid: "DIC_kwDOHl4HGs4CP_Jc",
  favicon: "/static/favicons/favicon.ico",
  avatar: "/static/favicons/avatar.png",
  cover: "/static/favicons/cover.png",
  email: "xingyuliu@outlook.sg",
  github: "hxlog",
  zhihu: "https://www.zhihu.com/people/xingyu7",
  copyright: "CC BY-NC-SA 4.0",
  copyrightUrl: "https://creativecommons.org/licenses/by-nc-sa/4.0/",
  // Rendered by the footer; the template overrides it with its own host.
  hosting: { label: "Cloudflare", href: "https://www.cloudflare.com/" },
  feedEmail: "hello@prologue.dev",
  feedGenerator: "prologue.dev feed pipeline",
  blogLabel: "博客",
  microblogFeedGenerator: "prologue.dev microblog feed",

  // optional
  wechatofficialaccount: "槐序的序章",
  tenYears: {
    url: "https://www.foreverblog.cn/go.html",
    label: "十年之约 · 虫洞",
    description:
      "随机去一位十年之约成员博客看看。每一次点击，都是一次真实的到访。",
    cta: "开始漫游",
    title: "随机访问一位十年之约成员博客",
  },
  agent,

  // Page-level copy and labels. Runtime routes read these instead of carrying
  // owner-specific strings in code; template data supplies its own values.
  pages: {
    archive: {
      title: "归档",
      description: "All posts here! 所有文章在这里！",
    },
    microblog: {
      title: "微博 Microblog",
      heading: "微博",
      description: "槐序的微博：碎片化的思考、图文与随想。",
    },
    links: {
      title: "友情链接 Friend Links",
      heading: "友情链接",
      description: "但愿十年后的某天，这些链接仍存活，与各位作者共勉。",
    },
    ui: {
      title: "UI 标准 / UI Standard",
      heading: "设计系统与 UI 标准",
      description:
        "本站的颜色、字体、形状、动效与组件标准：本页直接读取生产 CSS，与实际站点同源。",
      projects: [
        {
          name: "Balanced Portfolio",
          description:
            "机构级投资管理工具：全天候风险平价组合与回测、股指期货统计看板、场外期权定价。",
          repo: "hxlog/balanced-portfolio",
          stars: "48",
          forks: "25",
        },
        {
          name: "Prologue",
          description: "这个站点本身：内容优先的 Next.js 博客。",
          repo: "hxlog/prologue.dev",
          stars: "41",
          forks: "10",
        },
        {
          name: "DSH MCP Tools",
          description: "DeepSeek Harness 的 MCP 管理器。",
          repo: "hxlog/dsh-mcp-tools",
          stars: "3",
          forks: "0",
        },
      ],
    },
    llms: {
      description:
        "A personal blog about economics, sociology, technology and ordinary life.",
    },
  },
};

export const siteRepo = siteMetadata.siteRepo;
export const wechatofficialaccount = siteMetadata.wechatofficialaccount;
export default siteMetadata;
