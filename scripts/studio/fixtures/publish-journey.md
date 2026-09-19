---
title: "从 /studio 发布的一篇文章"
description: "这是一篇通过管理后台创建、预览并发布的文章，用来验证发布链路端到端可用。"
publishDate: 2026-09-19
lastmod: 2026-09-19
tags: [Meta, Crypto]
image: ""
imageDesc: ""
featured: false
---

# 一级标题

这是一篇由 `/studio` 创建的文章。它存在的唯一目的是让发布链路被真正走一遍，
而不是被断言成"应该能行"。

## 富文本

行内公式 $E = mc^2$，行间公式：

$$
\int_{-\infty}^{\infty} e^{-x^2}\,dx = \sqrt{\pi}
$$

一段带 **加粗**、*斜体*、`行内代码` 和 [站内链接](/blog) 的段落。

```js
// 代码块必须保留 shiki 的高亮 class，否则 feed 会掉色
export function greet(name) {
  return `你好，${name}`;
}
```

| 列 | 含义 |
| --- | --- |
| `renderer_version` | 渲染管线的版本 |
| `content_hash` | 文档的指纹 |

- [x] 已完成的任务
- [ ] 未完成的任务

> 引用块。

![占位图片](/static/images/FXfighter.jpg)

一个脚注[^1]。

[^1]: 脚注的内容。
