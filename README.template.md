# Prologue Blog Template

A ready-to-use, content-first blog **template** powered by Next.js 16 + Contentlayer2.

This is **not** the author's personal blog. It ships a minimal demo so you can Use this template / Deploy and start writing by editing only `/data` and `/public`.

Live demo: https://prologue-blog-demo.prologue.dev/

## Features

- Content Focused, Contentlayer + MD/MDX
- Adaptive dark mode
- Full SEO, Opengraph + JSON-LD + RSS
- Lightweight search engine, powered by Fuse.js
- Mermaid diagrams

- 专注于内容创作，支持 markdown/mdx
- 自适应黑暗模式
- 完整的 SEO 支持，支持 Opengraph、JSON-LD 和 RSS
- 轻量级的搜索引擎，Fuse.js 实现全文搜索和模糊搜索
- 支持 mermaid 渲染

![Index Screenshot](./data/static/images/Index-Screenshot.jpg)

![Post Screenshot](./data/static/images/Post-Screenshot.jpg)

## Quick Start

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fhxlog%2Fprologue-blog-template)

Or use **Use this template** on GitHub, then:

```bash
git clone https://github.com/hxlog/prologue-blog-template.git my-blog
cd my-blog
npm install
npm run dev
```

Open `http://localhost:3000`.

You can customize this site by editing `/data` — config and posts, plus every static asset under `/data/static`.

你可以很容易自定义网站：配置与文章，以及全部静态资源，都在 `/data` 下。

## 5 Things To Change First

1. `data/sitemetadata.js`
   - `title`, `author`, `description`, `siteUrl`
   - `github`, `siteRepo`, `repoid`, `categoryid` (for Giscus)
2. `data/headerNavLinks.js`
3. `data/content/pages/about.md`
4. `data/content/blog/hello-prologue.md`
5. `data/microblog.yaml` and `data/links.yaml`

## Common Commands

```bash
npm run dev
npm run build
npm run start
npm run build:content
```

## Keeping Your Fork Updated

Engine updates are published to this template repo from [prologue.dev](https://github.com/hxlog/prologue.dev).

```bash
git remote add upstream https://github.com/hxlog/prologue-blog-template.git
git fetch upstream
git merge upstream/master
```

If you already rewrote your own content:

- Keep your local `data/**` and `public/**`
- Take upstream updates from `src/**` and build config

## License

Please add a license file suitable for your own project before public release.
