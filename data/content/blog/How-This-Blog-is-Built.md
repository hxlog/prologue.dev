---
title: 这个博客是如何搭建的
tags: ["Technology", "Meta"]
publishDate: 2023-12-09
description: 记录作者搭建博客的过程和心得，建议博客应以内容为中心，结构化文本处理。
---

## 前言

最开始接触博客是微软的FrontPage，所见即所得编辑器在当时大概算得上很大胆的创意，相比现在的低代码炒作，在这之后，入坑自媒体、内容社区，在网上和陌生人争辩，浪费了美好的青春。

搭建博客遇到的两个大坑，Wordpress和ghost，Wordpress在我看来是对FrontPage停止维护的反抗斗争，拥有Web2.0的交互属性和可拓展性，经典编辑器（现在是古腾堡编辑器）的设计让我想到word2003，将网页内容的可视化编辑呈现在前端，但是Wordpress带来的可拓展性却是复杂性，各种插件、主题和php的冲突和兼容问题，ghost使用node.js技术，但是其主题细节很多又无法让我完全满意，打算修改默认主题时，就想既然都手写HTML、CSS了，为何不直接使用前端框架生成网站，静态站点生成器（SSG）是主要的独立博客解决方案，而React和Next.js却给我这个什么技术都没有人的小白打开新的大门。

## 博客模板

![首页](/static/images/Index-Screenshot.jpg)


![文章](/static/images/Post-Screenshot.jpg)


![自动生成Opengraph(OG)作为SEO图片](/static/images/og-example.png)

访问[`/og?title=这个博客是如何搭建的`](/og?title=这个博客是如何搭建的)也能看到这张卡片，通过文字生成图片，这里是用了`@Vercel/og`的[OG生成 Edge Function](https://vercel.com/docs/functions/edge-functions/og-image-generation)，当文章没有设置图片时，就会自动生成OG。

SEO信息如下：
```html
<meta property="og:image" content="https://prologue.dev/og?title=这个博客是如何搭建的"/>
```

## 目录结构

回到博客的构建上，首先是文件架构，我将博客分为两部分，**内容信息**和**前端模板**，因为如果将内容信息和前端目录混在一起，杂乱无章，会导致增加维护模板的时间。

```
.
└── prologue.dev/
    ├── data/
    │   ├── content/
    │   │   ├── blog
    │   │   └── pages
    │   ├── headerNavLinks.js
    │   └── sitemetadata.js
    ├── src/
    │   ├── app
    │   └── conponents
    └── public
```

所以我将内容信息采集全部放到`/data`，也就是说只需要修改`/data`就可以自定义网站，其中在`/content`中的`/blog`放markdown格式的文章，`/pages`放不同页面的信息，`headerNavLinks.js`设置导航栏的超链接，`sitemetadata.js`设置个性化站点的内容。

`/src`目录则主要用来维护博客模板的文件路由、`layout.js`全局和`/components`组件，要获得本博客的效果，是不需要修改`/src`目录下的文件的。

`/public`是Next.js储存静态文件的目录。

## 部署

可以直接`git clone`[我的博客](https://github.com/hxlog/prologue.dev)进行修改，也可以在[Vercel上一键Fork并部署](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fhxlog%2Fprologue.dev)。

理论上Next.js能部署在支持Node.js的平台上，但不是所有平台支持`next start`和`/og`的社交平台卡片生成，所以应该禁用图片优化，静态导出。

## 内容结构

以下是文章markdown的frontmatter结构：

```yaml
---
title: title
description: description
publishDate: 2022-11-13
(required)

lastmod: 2023-07-02
featured: true
tags: ["tag1",tag2]
image: /static/photos/06.jpg
imageDesc: This is a static file
(optional)
---
```

以下是页面markdown的frontmatter结构：

```yaml
title: title
description: description
(required)
```

## 维护模板

大部分问题都能通过React生态components的技术文档解决，需要做的只是拼凑起来，仅此而已，梳理下思路：

完整的博客 = Markdown、MDX、Latex等标记语言渲染成HTML + SEO + 文件路由 + 交互

渲染问题`contentlayer`或`next-mdx-remote`都能解决，配合`Remark`和`Rehype`两个生态的插件拓展。

目前交互选择以Github Discussion为后端的`Giscus`。

如果要用mdx，就在`contentlayer.config.js`里按照文档里修改。

搜索引擎使用`Fuse.js`，实现全文模糊搜索。

SEO目前Next.js13框架已经内置Opengraph和JSON-LD，RSS和SEO的配置都是填表游戏，所以这套模板没有任何技术含量。

## 建议

请保持对开发和写作的热情，最花时间的是一些非技术性的事物，例如排版布局的细节，自适应窗口大小等，还有CSS渐变效果实现还需要点想象力；而写作更需要连贯的思考输出，而不是“坚持”，保持好奇心和持续观察外界。

请尽可能保持简洁，**如果交互、设计过多，内容就不是博客的主体了**。

**请尽量掌握维护博客的技术或方法**。能快速上手的一定是伪命题，要做好一件事物，必须付出一定精力和时间学习，到Github上看别人代码是如何实现的，又有哪些小bug，这就和自己财务规划一样，包括自己的资产负债表的设计，没有人能够比自己做得更好，但自己又不得不去学着做。

请不再折腾，折腾数据库现在是真怕了，就像是维护多一个项目，静态化数据用数据库是没有意义的，我们能不能不要为了折腾而折腾。

请结构化你的文本，本模板选择Markdown + Latex + Frontmatter和`Unified.js`（一个使用语法树处理内容的接口），是为了结构化文本(Content as structured data)，方便备份和数据读取，只要有底层数据在，就能简单地完成前端渲染。
