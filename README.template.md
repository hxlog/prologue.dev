# Prologue Blog Template

[中文](#中文) · [English](#english)

---

## 中文

一个内容优先的博客模板，基于 **Next.js 16 App Router + React 19 + Tailwind CSS v4**。

这不是作者本人的站点，而是一个可以直接用的起点：内容、配置和所有静态资源都在 `data/` 下，用 Obsidian 或任何编辑器都能改。

在线示例：https://prologue-blog-demo.prologue.dev/

### 特性一览

- **Markdown 写作**，不需要数据库，也没有后台
- **KaTeX 公式**，行内与块级
- **Shiki 代码高亮**，跟随站点主题自动切换
- **Mermaid 图表**，网页端客户端渲染，RSS 阅读器里自动换成图片
- **图片灯箱**，点击放大，多图可左右滑动
- **GFM 表格、脚注、任务列表、删除线**
- **自适应深色模式**，切换时是圆形揭示动画
- **完整 SEO**：OpenGraph、JSON-LD、sitemap、robots
- **三种订阅格式**：RSS2 / Atom / JSON Feed，另有微博独立 feed
- **站内搜索**，Fuse.js，构建期生成精简索引
- **标签体系**，英文 slug + 可翻译的显示名
- **相关文章**、阅读进度条、目录、Giscus 评论

### 快速开始

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fhxlog%2Fprologue-blog-template)

或者用 GitHub 上的 **Use this template**，然后：

```bash
git clone https://github.com/hxlog/prologue-blog-template.git my-blog
cd my-blog
npm install
npm run dev
```

打开 `http://localhost:3000`。

改内容不需要重启开发服务器：保存文件，刷新页面即可。

![首页](./data/static/images/Index-Screenshot.jpg)

![文章页](./data/static/images/Post-Screenshot.jpg)

### 先改这五处

1. **`data/sitemetadata.js`** — `title`、`author`、`description`、`siteUrl`；以及 `github`、`siteRepo`、`repoid`、`categoryid`（Giscus 评论）
2. **`data/headerNavLinks.js`** — 导航栏链接
3. **`data/content/pages/about.md`** — 关于页
4. **`data/content/blog/hello-prologue.md`** — 第一篇文章
5. **`data/microblog.yaml`** 和 **`data/links.yaml`** — 微博与友链

配色、圆角、阴影都在 `src/app/globals.css` 的 `@theme inline` 里，改 CSS 变量即可换主题色。

### 用 Obsidian 写作

`data/` 目录本身就是一个 Obsidian vault：文章、页面、YAML 数据和**全部静态资源**都在里面，一个窗口就能编辑文章和它引用的图片。

设置方式见 [docs/CONTENT.md](https://github.com/hxlog/prologue.dev/blob/master/docs/CONTENT.md)。要点：

- 把 vault 根目录设为 **`data/`**（不是仓库根目录），这样 `/static/images/x.jpg` 这类链接才能解析到真实文件
- 附件目录设为 `static/images`
- **`draft` 和 `featured` 两个属性必须是 Checkbox 类型**，否则会写成字符串 `"false"`，构建会直接报错并指出文件和字段

不用 Obsidian 也完全没问题，VS Code、vim 编辑同一批文件效果一样。

### 常用命令

```bash
npm run dev            # 开发服务器
npm run build          # 生产构建
npm run start          # 本地跑生产版本
npm run lint           # ESLint
```

### 同步上游更新

```bash
git remote add upstream https://github.com/hxlog/prologue-blog-template.git
git fetch upstream
git merge upstream/master
```

如果你已经写了自己的内容，合并时保留本地的 `data/**`，只取上游的 `src/**` 和构建配置。

### 许可

发布前请自行添加适合你项目的 LICENSE。

---

## English

A content-first blog template built on **Next.js 16 App Router + React 19 + Tailwind CSS v4**.

This is not the author's personal site — it is a starting point you can use as-is. All content, configuration and static assets live under `data/`, and are editable in Obsidian or any text editor.

Live demo: https://prologue-blog-demo.prologue.dev/

### Features

- **Markdown authoring** — no database, no admin panel
- **KaTeX math**, inline and display
- **Shiki code highlighting** that follows the site theme
- **Mermaid diagrams**, rendered client-side on the web and swapped for hosted images in RSS readers
- **Image lightbox** — click to zoom, swipe between grouped images
- **GFM tables, footnotes, task lists, strikethrough**
- **Adaptive dark mode** with a circular reveal transition
- **Complete SEO** — OpenGraph, JSON-LD, sitemap, robots
- **Three feed formats** — RSS2 / Atom / JSON Feed, plus a separate microblog feed
- **Site-wide search** with Fuse.js over a slim build-time index
- **Tag taxonomy** — ASCII slugs with translatable display labels
- **Related posts**, reading progress, table of contents, Giscus comments

### Quick Start

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fhxlog%2Fprologue-blog-template)

Or use **Use this template** on GitHub, then:

```bash
git clone https://github.com/hxlog/prologue-blog-template.git my-blog
cd my-blog
npm install
npm run dev
```

Open `http://localhost:3000`.

Editing content does not need a server restart: save the file and reload.

![Index Screenshot](./data/static/images/Index-Screenshot.jpg)

![Post Screenshot](./data/static/images/Post-Screenshot.jpg)

### 5 Things To Change First

1. **`data/sitemetadata.js`** — `title`, `author`, `description`, `siteUrl`; and `github`, `siteRepo`, `repoid`, `categoryid` (Giscus comments)
2. **`data/headerNavLinks.js`** — navigation links
3. **`data/content/pages/about.md`** — the about page
4. **`data/content/blog/hello-prologue.md`** — your first post
5. **`data/microblog.yaml`** and **`data/links.yaml`** — microblog and friend links

Colours, radii and shadows are tokens in `src/app/globals.css` under `@theme inline` — change the CSS variables to re-theme the whole site.

### Writing with Obsidian

The `data/` directory is itself an Obsidian vault: posts, pages, the YAML data files and **every static asset** live inside it, so a post and the images it references are edited in one window.

Setup is documented in [docs/CONTENT.md](https://github.com/hxlog/prologue.dev/blob/master/docs/CONTENT.md). The essentials:

- Set the vault root to **`data/`** (not the repository root), so links like `/static/images/x.jpg` resolve to the real file
- Point the attachment folder at `static/images`
- **`draft` and `featured` must be Checkbox properties** — typed as text, Obsidian writes the string `"false"`, which fails the build with a message naming the file and the field

Obsidian is optional. Editing the same files in VS Code or vim works identically.

### Common Commands

```bash
npm run dev            # dev server
npm run build          # production build
npm run start          # serve the production build locally
npm run lint           # ESLint
```

### Keeping Your Fork Updated

```bash
git remote add upstream https://github.com/hxlog/prologue-blog-template.git
git fetch upstream
git merge upstream/master
```

If you already rewrote your own content, keep your local `data/**` and take upstream changes from `src/**` and the build config.

### License

Please add a license file suitable for your own project before public release.
