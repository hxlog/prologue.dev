# 2026-11-06 初始加载、SEO 与 GEO 审计

## 结论

本轮把导航相关的可选弹层从所有路由的同步客户端 bundle 中拆出，修复了搜索状态、带点路径 404、移动菜单可访问性，并补齐了 SEO/GEO 输出。没有改变页面颜色、排版、间距、字体、卡片或正文标题的视觉。

- 初始 JS/CSS（首页，生产构建、压缩传输）：255.3 KB -> 223.5 KB（-31.8 KB，约 -12.5%）。
- Analyzer 归属的 bootstrap + render-dependent 初始成本：
  - 首页：265.5 KB -> 225.4 KB（-40.1 KB）
  - /blog：254.3 KB -> 202.7 KB（-51.6 KB）
  - /microblog：259.9 KB -> 208.3 KB（-51.6 KB）
  - /links：263.0 KB -> 208.7 KB（-54.3 KB）
  - /ui：268.3 KB -> 217.5 KB（-50.8 KB）
  - 文章页：269.2 KB -> 215.1 KB（-54.1 KB）
  - tag 页：254.3 KB -> 202.7 KB（-51.6 KB）
- 搜索/RSS/邮件/移动菜单的 chunk 移到首屏之后 idle 预取；它们不会进入首屏关键路径，但首屏后会补下载。
- SEO：sitemap 85 个 URL 全部通过 200、canonical、非 noindex、至少一个 h1、JSON-LD 解析检查。
- 未知动态路径（/blog/does-not-exist、/tags/NotATag、/blog/page/2、/tags/Web3、/missing-page）以及带点路径（/foo.txt、/blog/foo.bar）现在返回真 404。
- 两篇文章正文仍保留作者原始 h1 视觉；多 h1 作为内容层事实记录，没有为了 SEO 改变排版。
- 新增 /llms.txt、/llms-full.txt；检索型 AI bot 允许抓取，训练型 bot 在 robots 中限制。

## 测量方法

- Next.js 16.4.4，Turbopack，生产构建。
- Bundle 快照：before audit-initial-load-20261106，after audit-after-20261106；通过 next analyze --output 捕获，按 bootstrap/render-dependent 归属比较。
- 传输字节：本机生产服务器上的 curl --compressed。
- 浏览器指标：Playwright Chromium，生产模式，记录 FCP/LCP、DOMContentLoaded、资源数和 transfer bytes；CI 机器速度有波动，不设脆弱阈值。
- 最终 19 个 e2e 中的 performance spec 记录（同一浏览器会话，非字段数据；首路由受构建/服务冷启动影响）：
  - /：FCP 848 ms / LCP 1096 ms / 40 resources
  - /blog：FCP 264 ms / LCP 264 ms / 41 resources
  - 文章页：FCP 268 ms / LCP 268 ms / 37 resources
  - /microblog：FCP 404 ms / LCP 404 ms / 31 resources
  - 后续路由命中浏览器缓存，transfer bytes 明显下降；报告以首路由与构建归属为准。

## 实施内容

### 初始加载与交互

- 搜索：search-dialog.js 只保留 trigger/快捷键；search-dialog-panel.js 按需加载；每次打开重建 panel，修复 Ctrl/Cmd+K 关闭后旧查询残留。
- RSS：保留 trigger 和 a[href="/rss"] 拦截，rss-modal-panel.js 按需加载。
- 邮件：保留 trigger，email-modal-panel.js 按需加载。
- 移动菜单：轻量 trigger + mobile-nav-panel.js；补齐 focus trap、方向键、Home/End、Escape、焦点返回、Enter/退出过渡，沿用 modal-panel 和现有 motion token，颜色/尺寸/定位不变。
- 首屏后 idle 预取四个 panel；idle 不可用时 setTimeout 回退；Save-Data 跳过。
- Mermaid：恢复挂载即加载，图表出现时机与改动前一致；仍保留异步 chunk 和 classic look。
- 静态导航只保留必要的 prefetch={true}；文章卡片和上一篇/下一篇保留 true。

### Cache Components / Partial Prefetching

- 已启用 cacheComponents: true 与 partialPrefetching: true；没有关闭或降级任何页面。
- 所有页面路由保持 instant = true / ensureStatic = "shell"。
- 新增生产模式 @next/playwright 测试，覆盖静态页、文章卡片、/about、文章壳和 tag 壳。
- 没有用 instant = false 绕过任何阻塞问题。

### SEO 与 GEO

- src/proxy.js + generated data/route-manifest.js 在渲染前拒绝未知页面路径；manifest 包含 posts/pages/tags、静态路由和 public 根文件；常规 next build 可直接使用。
- 按确认选择不添加旧路径 308；/blog/page/*、/tags/Web3 与其它未知路径一样返回 404。
- proxy matcher 不再排除所有带点路径；/foo.txt、/blog/foo.bar 返回 404，/llms*.txt、/robots.txt、/sitemap.xml 等已知文件放行。
- 增加显式 robots：index/follow、max-image-preview、max-snippet、max-video-preview；移除 /og 的 disallow。
- 增加检索型 AI bot 允许规则（ChatGPT-User、OAI-SearchBot、PerplexityBot、Claude-User），限制训练型 bot（GPTBot、ClaudeBot、Google-Extended、CCBot、Bytespider、Meta-ExternalAgent、cohere-ai）。
- 新增 /llms.txt 与 /llms-full.txt：索引 + 全部已发布文章、页面、微博正文；不加入 sitemap。
- 为 /blog、/tags/*、/microblog、/links 的 CollectionPage 增加 ItemList；修正 /microblog 的 about 语义。
- 两篇正文的 h1 保持原视觉；SEO e2e 不再强制全站单 h1。

## 验证

- yarn lint：通过。
- yarn build：103 个页面生成，路由类型保持 ○ / ◐；proxy 正常注册；/llms.txt 与 /llms-full.txt 为 ○。
- yarn test:e2e：19 passed。
  - instant 导航：静态页、/about、文章卡片、直接文章壳、tag 壳。
  - SEO：sitemap 全量、dotted 404、llms 内容、ItemList、robots/feeds。
  - 弹层：搜索、搜索状态重置、RSS、邮件、移动菜单焦点/方向键/Tab trap/Escape。
  - 性能：FCP/LCP/资源数记录。
- next-dev-loop 前置检查：
  - agent-browser 0.41.2 已安装。
  - /_next/mcp tools/list、get_compilation_issues、get_routes 正常；compilation issues 为 0。
  - dev 首页 console 无错误；React tree 正常；avatar LCP 警告已通过 loading="eager" 修复。
- 冒烟检查：未知动态/带点路径 404；有效路由 200；/sitemap.xml、/rss、/static、/llms*.txt 正常。

## 说明与后续

- 全站严格 404 使用 Node proxy，接受每页一层轻量 Set 查找的 TTFB 取舍；若未来要移除 proxy，需要接受 noindex 200。
- /llms-full.txt 约 343 KB，静态输出；由全部已发布文章、页面、微博组成。
- 正文中的多 h1 是内容层事实，不做视觉降级；如未来要统一语义，需要单独的内容改写与视觉回归测试。
- 按确认选择不 commit、不 push、不同步 template；所有改动保留在工作区。
