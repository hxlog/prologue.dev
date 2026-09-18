# Prologue Blog

Next.js 16 + React 19 + Tailwind CSS v4 + PostgreSQL

A content-first personal blog that serves its content from a self-hosted database, with a `/studio` admin area for writing, version history and collections.

**Prologue 是一个面向内容创作者的博客与发布平台：支持 Markdown/MDX、公式、Mermaid、Feed、SEO、全站中文全文搜索与暗黑模式。**

博客链接：https://prologue.dev

## Preview

![首页与文章页](./public/static/images/ss_pc.png)

首页与文章页

![文章搜索与评论功能](./public/static/images/ss_search_comment.png)

文章搜索与评论功能

![手机端首页、个人页、友链页](./public/static/images/ss_phone.png)

手机端首页、个人页、友链页


## Features

- Content stored in PostgreSQL, with a full revision history per post and page
- Markdown source editing with a preview rendered by the *same* function that publishes
- Adaptive dark mode
- Full SEO: OpenGraph, JSON-LD, RSS, Atom, JSON Feed
- Site-wide full-text search that actually works for Chinese (see `db/README.md`)
- Mermaid diagrams, KaTeX math, syntax highlighting
- Collections — microblog, friend links, and any other structured list — defined in `/studio` with custom fields

- 内容存储在 PostgreSQL，每篇文章和页面都有完整的版本历史
- 直接编辑 Markdown 源码，预览与发布使用**同一个**渲染函数
- 自适应黑暗模式
- 完整的 SEO 支持：OpenGraph、JSON-LD、RSS、Atom、JSON Feed
- 全站中文全文搜索
- 支持 mermaid 渲染、KaTeX 公式、代码高亮
- Collections：微博、友链等结构化内容可在 `/studio` 中自定义字段

## Architecture

| area | where |
|---|---|
| markdown pipeline | `src/lib/markdown/render.js` — the single renderer used by publishing, preview and import |
| database access | `src/lib/db/index.js` (pool), `src/lib/content/*` (queries) |
| schema & migrations | `db/migrations/*.sql`, applied by `scripts/db/migrate.mjs` |
| feeds | `src/lib/feed/*` |
| admin | `src/app/studio/*` |

Content lives in `posts` / `post_revisions` and `pages` / `page_revisions`. Publishing a post moves `posts.published_revision_id` to a new revision; nothing is ever overwritten, so every edit is restorable and diffable.

The markdown files under `data/content` are the **import source**, not the runtime source. Editing one has no effect until `scripts/db/import-posts.mjs` runs.

## Commands

```bash
npm run dev            # next dev --turbopack
npm run build          # next build --turbopack
npm run start          # serve production build
npm run lint           # eslint

node --env-file=.env.local scripts/db/migrate.mjs --status
node --env-file=.env.local scripts/db/import-posts.mjs
node --env-file=.env.local scripts/db/import-pages.mjs
node --env-file=.env.local scripts/db/import-collections.mjs
```

Copy `.env.example` to `.env.local` and fill it in first. See `db/README.md` for the database's roles, connection paths and pooling constraints, and `CLAUDE.md` for the parts of this codebase that are easy to get wrong.


## Configuration

Post Frontmatter

```yaml
---
title: title
description: description
publishDate: 2022-11-13
(required)

lastmod: 2023-07-02
featured: true
tags: ["tag1","tag2"]
image: /static/photos/06.jpg
imageDesc: This is a static file
(optional)
---
```

Page Frontmatter

```yaml
title: title
description: description
(required)
```

推荐配合 Obsidian 在 `data/` 打开 Vault 编辑，YAML 和 FrontMatter 会以结构化表格形式渲染，方便作为知识库进行交互。导入脚本读取的就是这些文件。
