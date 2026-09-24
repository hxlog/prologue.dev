---
title: 欢迎使用 Prologue
description: 模板的第一篇文章，从这里开始。
publishDate: 2026-05-31
lastmod: 2026-05-31
featured: true
draft: false
tags: ["starter", "hello"]
categories: ["guide"]
image: /static/photos/template-cover.svg
imageDesc: 封面图：把 data/static/photos/ 里的这张换成你自己的
---

这是你的第一篇文章。

在 `data/content/blog/` 里新建一个 `.md` 文件，写上前面的 frontmatter，它就会出现在站点上。

## 接下来去哪

- **[功能一览](/blog/feature-tour)** — 公式、代码、表格、脚注、图表、图片灯箱，模板支持的排版都在这一篇里。
- **[关于页面](/about)** — 把 `data/content/pages/about.md` 换成你自己的介绍。
- **[配置](/about)** — 站点标题、作者、域名、评论与统计的 ID 都在 `data/site.md`，改完运行 `npm run site-data`。

## 写完之后

```bash
npm run dev     # 本地预览，改完保存即可看到
npm run build   # 构建生产版本
```

内容改动不需要重启开发服务器：保存文件，刷新页面就能看到。
