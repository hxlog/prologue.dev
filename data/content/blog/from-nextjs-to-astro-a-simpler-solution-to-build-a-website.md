---
title: 从Next.js到Astro：更简单的网站搭建方案
tags: ["Technology", "Meta"]
publishDate: 2023-03-07
description: 一次不过不失的折腾。
---

## 错误的工具选择

自从将Next.js更新到13并使用app dir(beta)功能，嵌套布局(nested layouts)导致一些小bug，而且堆在issues中长时间没有解决方案，例如一个最致命的痛点，`<Link>`在无法在嵌套布局自动scroll up，如果将Scrollup写在`layout.js`那么如果是传统的返回那也不符合预期行为，其次`next dev`的SSG越来越卡顿，尽管是使用原有`pages`，Next.js13和react18的`server component`、`Edge runtimes`、`Dynamic Route Segments`等改动迎合大型网站的JAMStack(前后端分离)，甚至将原有的`getStaticProps`等data fetch给deprecated，对于像mdx这样社区喜欢的功能目前在beta版本仍然不支持内置的`Remote MDX`，以及一直不支持`next export`SSG的图片优化，彻底让我放弃了使用Next.js13作为博客的前端框架的想法。

另外一些令我这个外行（没有计算机背景）摸不着头脑的事情：

- 将所有api塞到`/api`

- 在React中查询数据库，暴露底层操作

- `env`无法识别，必须再次在`nextconfig.js`中声明

- `metadata`的客户端渲染导致在社交媒体发送不会立刻预览并显示使用`ogimage generator`的卡片，需要等待一定时间，在13.2版本勉强修复

- `<Link>`在页面内的anchor hash指向错误路由

而且它似乎在逼迫我在顶级页面做完所有的事情：拉取信息、路由、SEO，还要划分client component并分别import进来，为什么问题会变得如此复杂？

正如其名字，生意的重点在于vercel作为前端平台的商业模式，而非开源框架，在next.js conf让合作伙伴拍摄极其精美的短片，强调scale和developer experience，一个又一个toB的成功案例，这是一家商业公司，而不是社区驱动的，我用next.js conf直播中的一条留言结束批判：

**They get so much inspiration from Apple.**

## 相见恨晚

Astro并不是一个有什么厉害的或“前沿技术”的前端框架，它非常简单上手，只需要几行代码就能添加新的功能,sitemap、tailwind、mdx等都是开箱即用的：

```js
// /src/astro.config.mjs
import { defineConfig } from "astro/config";
import image from "@astrojs/image";
import mdx from "@astrojs/mdx";
import tailwind from "@astrojs/tailwind";
import sitemap from "@astrojs/sitemap";
import vercel from "@astrojs/vercel/static";
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'

// https://astro.build/config
export default defineConfig({
  site: "https://www.xushilu.com",
  markdown:{
    syntaxHighlight: "shiki",
      shikiConfig: {
        theme: "github-light",
      },
      remarkPlugins: [remarkMath],
      rehypePlugins: [rehypeKatex],
  },
  integrations: [
    image({
      serviceEntryPoint: "@astrojs/image/sharp",
    }),
    mdx(),
    tailwind(),
    sitemap(),
  ],
  output: "static",
  adapter: vercel({
    analytics: true,
  }),
});

```

它是非常content focus的，`getCollection`能自动读取`/src/content`的markdown和mdx文件，也可以快速筛选frontmatter的信息。

```js
// Example: Filter content entries with `draft: true` frontmatter
import { getCollection } from 'astro:content';
const draftBlogEntries = await getCollection('blog', ({ data }) => {
  return data.draft !== true;
});
```

```js
// /pages/posts/[...slug].astro
---
import { CollectionEntry, getCollection } from 'astro:content';
import PostLayout from '../../layouts/PostLayout.astro';

export async function getStaticPaths() {
	const posts = await getCollection('posts');
	return posts.map((post) => ({
		params: { slug: post.slug },
		props: post,
	}));
}
type Props = CollectionEntry<'posts'>;

const post = Astro.props;
const { Content } = await post.render();
---

<PostLayout {...post.data}>
	<article className="prose">
	<Content />
</article>
</PostLayout>
```

Astro Islands指的是 HTML 静态页面上的交互式 UI 组件。一个页面上可以存在多个孤岛，一个孤岛总是孤立地呈现。将它们想象成静态、非交互式 HTML 海洋中的岛屿。

![Islands Architecture](/static/images/islands-architecture-1.png)

可以将其视为包含多个独立嵌入式应用程序的静态 HTML 文档，这是比传统在SPA上选择SSR更好的SEO解决方法，而SSR实际上会对用户体验产生负面影响——访问者只能等待页面的实际功能出现，同时盯着该页面令人沮丧的虚假版本。


## 参考资料 

Astro Islands. https://docs.astro.build/en/concepts/islands/

Islands Architecture. https://jasonformat.com/islands-architecture/