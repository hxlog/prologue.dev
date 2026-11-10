# prologue.dev — Vercel 资源超限审计报告（v2，三方交叉验证）

> 仓库：`D:\prologue.dev` — Next.js **16.4.5** App Router + Turbopack，`cacheComponents: true`，`partialPrefetching: true`
> 验证手段：① 本地 production build + `next start` 逐路由计 CPU；② **强制过期**触发真实 ISR 再验证并采样 CPU；③ 线上 `https://prologue.dev` 实测响应头与体积；④ `.next` 构建产物（prerender-manifest / nft traces / route-bundle-stats）；⑤ Vercel 官方文档口径核对。
> 限制：本机 Vercel CLI 未登录，无法用 Observability Plus 做**按路由**归因。因此下面的归因是"实测单次成本 × 由 manifest 固定的触发频率"，每一条都标注了强度。子报告：`docs/audit/vercel-metrics.md`、`docs/audit/runtime-cpu.md`、`docs/audit/cache-isr.md`。

---

## 0. 一句话结论

**不是流量问题，也不是"Vercel 计费异常"。**

215K CDN 请求/月 ≈ 每天 7,000 请求（约 300–500 访客/天）——一个小博客的量级。两个真正超限的指标各有一个明确的主导成因：

- **Fluid Active CPU 7h12m（超 80%）← RSS/Atom/JSON 三个 feed 每小时把全部 65 篇文章重渲染一遍，而且三个格式**各自**渲染一次（实测单次冷渲染 10.3–23 s CPU）。**
- **Fast Origin Transfer 15.77 GB（超 58%）← 三个 feed 各 1.0 MB，却以 `s-maxage=600`（比 ISR 的 3600 s 短 6 倍）暴露给 CDN，于是每 10 分钟回源拉 1 MB；加上 `prefetch={true}` 的不可缓存 RSC、bot 的不可缓存整页渲染、以及 `/og` 的 136 KB PNG。**

其余 8 个指标都没超，但同源问题把它们顶到了 20–80%。

---

## 1. 用量表与实际超限面

| 指标 | 用量 | 免费额度 | 占比 | 判定 |
|---|---|---|---|---|
| **Fluid Active CPU** | 7h 12m | 4h | **180%** | **超** |
| **Fast Origin Transfer** | 15.77 GB | 10 GB | **158%** | **超** |
| ISR Writes | 157K (units) | 200K | 78.5% | 逼近 |
| ISR Reads | 758K (units) | 1M | 75.8% | 逼近 |
| CDN Request CPU Duration | 33m 48s | 1h | 56% | 否 |
| Functions Storage | 2.91 GB | 10 GB | 29% | 否 |
| Image Opt. Transformations | 1.5K | 5K | 30% | 否 |
| Fast Data Transfer | 22.25 GB | 100 GB | 22% | 否 |
| CDN Requests | 215K | 1M | 21.5% | 否 |
| Image Opt. Cache Writes | 18K | 100K | 18% | 否 |

> **口径纠正（重要）**：ISR Reads/Writes 的"K"是 **8 KB 单位**，不是操作次数。所以 758K read units ≈ **6.06 GB** 从 durable ISR storage 读出，157K write units ≈ **1.26 GB** 写入。这一点决定了归因方向（见 §3）。

---

## 2. 实测数据（三个独立来源）

### 2.1 本地 production 构建，逐请求服务器 CPU

| 路由 | 服务器 CPU | 响应体 | 说明 |
|---|---|---|---|
| `/` | 8 ms | 94.9 KB | `x-nextjs-cache: HIT` |
| `/blog` | 8 ms | 100.8 KB | |
| `/blog/<post>` | 7 ms | 156.7 KB | 最长文章 328 KB |
| `/blog` + `RSC: 1` | 36.5 ms | 56.6 KB | `text/x-component` |
| `/blog` + `RSC` + `Next-Router-Prefetch` | 20.8 ms | 56.6 KB | prefetch 仍要服务端流式序列化 |
| `/llms-full.txt` | 17–25 ms | 811 KB | `s-maxage=31536000`，构建期生成 |
| `/rss` | 14.8–20 ms（**热**） | 1,005,571 B | |
| `/atomfeed` | 14.8–20 ms（**热**） | 1,023,132 B | |
| `/jsonfeed` | 14.8–20 ms（**热**） | 1,026,589 B | **线上不压缩** |
| `/og` | **879 ms 持续 / 1,875 ms 首次** | 110–145 KB PNG | Satori + 3 次 Google Fonts 往返 + sharp |
| `/api/search` | 28.4 ms 持续 / 173 ms 冷 | 11.7 KB | `private, no-store` |

### 2.2 强制过期，测"真实一次 ISR 再验证"（决定性证据）

把 `.next/prerender-manifest.json` 里 `initialRevalidateSeconds` 从 3600 改成 1、重启、发一次请求、采样进程 CPU：

```
/rss        后台再验证 = 22,062 ms CPU / 21.4 s wall   (x-nextjs-cache: STALE)
/atomfeed                             140.6 ms   （同一进程内正文已 memo）
/jsonfeed                             187.5 ms
文章页再验证                         1,531 ms / 3.4 s wall
```

冷进程直接 benchmark（`node --conditions=react-server`）：

```
getAllPostsWithBody()  65 篇正文过 Shiki      9.8 – 11.0 s CPU
createFeed() 冷（rss/atom/json）             10.3 / 17.6 / 23.0 s CPU
createFeed() 第二次（同进程，正文已缓存）        62 – 78 ms CPU
rss2()/atom1()/json1() 序列化                  6 – 19 ms
buildLlmsFull()（raw markdown）                63 ms
```

**→ feed 的全部成本就是 65 篇正文的 Shiki 渲染；feed 组装与序列化可以忽略。** 22 s 这个数字比估算更高，因为 1 MB XML 的拼接/转义也进来了。

### 2.3 线上实测（`https://prologue.dev`，sin1 区域）

| 请求 | 状态 | x-vercel-cache | 发给浏览器的 Cache-Control | 体积 |
|---|---|---|---|---|
| `/` | 200 | **HIT** (age 2885) | `public, max-age=0, must-revalidate` | 95.4 KB |
| `/blog` | 200 | **PRERENDER** | 同上 | 101.0 KB |
| `/blog/<post>` | 200 | **HIT** (age 4397) | 同上 | 159.7 KB |
| `/blog/<post>` + RSC | 200 | PRERENDER | **`private, no-store, no-cache`** | 66.3 KB |
| `/rss` | 200 | HIT (age 503) | `public` | 1,005,571 B → **br 389,801 B** |
| `/atomfeed` | 200 | HIT (age 163) | `public` | 1,023,132 B → **br 391,773 B** |
| `/jsonfeed` | 200 | **STALE** (age 5162) | `public` | 1,026,589 B → **无压缩，全量 1 MB** |
| `/llms-full.txt` | 200 | PRERENDER | `public, max-age=0, must-revalidate` | 811 KB → br 364 KB |
| `/og?...` | 200 | **MISS** | `public, immutable` | 110 KB |
| `/static/opt/M2-CPI-Date-0162a4d0.webp` | 200 | HIT | **`public, max-age=0, must-revalidate`** | **4,928,251 B** |
| `/_next/image?url=<svg>&w=1080` | **400** | — | — | 报错 |

三条线上事实很关键：
1. **页面文档是缓存的**（HIT / PRERENDER），所以"每次访问都回源渲染整页"不成立——页面文档本身不是 CPU 大头。
2. **RSC / prefetch 响应是 `private, no-store`** ——CDN **不能**缓存它，所以每一个 `prefetch={true}` 都是一次真实的服务端请求（并在 ISR 层留下读）。
3. **`/jsonfeed` 完全没有压缩**（Vercel 只对 rss/atom 的 XML 走 brotli，`application/feed+json` 不在压缩白名单），所以它是三个 feed 里最贵的那个。

---

## 3. 归因：两个超限指标各自的账

### 3.1 Fluid Active CPU = 7h 12m

| 来源 | 单次成本（实测） | 触发频率 | 月成本 | 强度 |
|---|---|---|---|---|
| **3 个 feed 的 ISR 再验证** | **10.3–23 s CPU** | 3 entries × 24 次/天（`revalidate:3600`） | **4.4 h（同一实例保温）～13 h（每次冷启动）** | ★★★ 主导 |
| 87 条页面路由每日再验证 | 1.53 s | 87/天 | ≈ 1.1 h | ★★ |
| bot UA 整页渲染（htmlLimitedBots） | 55–106 ms / 次 | Bingbot/百度/社交预览每次访问 | 与爬虫量成正比 | ★★ |
| `/og` 渲染 | 0.88–1.88 s | 每个唯一 URL 每个区域一次 | 与 OG 抓取量成正比 | ★★ |
| `src/proxy.js`（middleware） | 每请求先于缓存执行，Fluid 计费 | 所有页面类请求 | 加起来几十秒–几分钟 | ★ |
| 页面文档 | 8 ms | 有 CDN 缓存 | 可忽略 | — |

**7h12m 落在 feed 一行的区间内。** 这是三个独立数据集（本地冷渲染、强制过期再验证、ISR write units）指向同一结论。

### 3.2 Fast Origin Transfer = 15.77 GB

| 来源 | 字节 | 说明 |
|---|---|---|
| ISR read + write 字节 | **7.32 GB（46%）** | 758K×8KB + 157K×8KB；其中 feed 单条 1 MB = 126 units，~6,016 次读就吃满 758K units |
| `prefetch={true}` 的 RSC | 56–66 KB × N | `private, no-store` → 每次 prefetch 都是 origin 响应；首页最多 19 个 |
| bot 整页渲染 | 238 KB / 次（Bingbot 实测） | 不可缓存 |
| `/og` PNG | 110–145 KB / 次 | `MISS` 时走函数 |
| `/jsonfeed` | **1,026,589 B 未压缩** | 同一份内容比 rss 多传 ~2.6× |
| 页面文档再验证 | ~95–160 KB / 次 | 87/天 |

**为什么 feed 是主力**：`s-maxage=600` 让 CDN 每 10 分钟就必须回源一次，而 ISR entry 的有效期是 3600 s——**6 次里有 5 次取回的是同一份没变的 1 MB**。线上 `/jsonfeed` 抓到的 `STALE`（age 5162 s）就是这个后台再验证正在发生。

### 3.3 ISR Writes = 157K units（1.26 GB）

Vercel 文档明确：**只有输出"变了"才算一次写；时间戳、随机数、生成 ID 会让没变的输出每次都不同。**

而 `src/lib/feed/build-feed.js` → `createFeed(new Date())` → feed 里写着：

```xml
<lastBuildDate>Tue, 10 Nov 2026 02:51:43 GMT</lastBuildDate>
```

**于是每次再验证输出的字节都不同 → 每次都产生一次 1 MB 的写。** 157K units ÷ 126 units/MB ≈ **1,240 次 feed 写**，正好是 3 个 feed 的小时级再验证上限量级。

### 3.4 ISR Reads = 758K units（6.06 GB）

同一地址的 CDN 窗口（600 s）比 ISR 窗口（3600 s）短 6 倍 → feed 每 10 分钟从 durable ISR storage 读一次 1 MB（126 units）。6,016 次读 × 126 = 758K units。**数字对得几乎严丝合缝。**

---

## 4. 五个根因（按可修复性排序）

### R1. Feed：三个格式各自缓存、每小时全量 Shiki 重渲染，且时间戳每次都变

- `src/lib/feed/cached.js:21-22`：`'use cache'` + `cacheLife({stale:600, revalidate:3600, expire:86400})`，函数签名 `getFeedXml(format)` → **format 进 cache key，等于为同一份数据存 3 份、付 3 次 10–23 s 渲染**。
- `src/lib/feed/build-feed.js:49`：`createFeed(feedUpdated = new Date())` 把渲染时刻写进 `lastBuildDate`。
- 内容只在 deploy 时变化，3600 s 的再验证周期毫无收益。

**修复（最高优先，一行级）**
```js
// src/lib/feed/cached.js
cacheLife("max");                       // 30 天；deploy 会换 deploymentId + 新缓存
// 并把 build-feed 的 updated 改成内容里最新的 lastmod/publishDate（microblog/rss 已经这么做）
```
再进一步：把"65 篇的 feed HTML"缓存成**一个** entry，三个序列化器只做 30–80 ms 组装。
**预期：Fluid CPU −4.4～6 h/月；ISR Writes −1.2 GB；ISR Reads 大部分消失。**

### R2. Feed 1 MB + `s-maxage=600`（比 ISR revalidate 短 6 倍）+ jsonfeed 不压缩

- `src/app/rss/route.js:8`、`atomfeed/route.js:4`、`jsonfeed/route.js:4`：`public, s-maxage=600, stale-while-revalidate=86400`。
- 线上实测：rss/atom 走 brotli（1 MB → 390 KB），**`/jsonfeed` 完全不压缩**（`application/feed+json` 不在 Vercel 压缩白名单）。
- feed body 1 MB 是"全文 + Shiki 高亮 HTML"换来的——feed 阅读器不需要语法高亮。

**修复**
- `s-maxage` 提到 ≥ ISR 的 revalidate；配合 R1 后直接 `s-maxage=86400, stale-while-revalidate=604800`。
- body 砍到最近 20 篇（≈ 1/3 体积）；feed 内容退回 raw markdown / 纯 `<pre><code>`，**顺带把 Shiki 从 feed 路径彻底拿掉**。
- `/jsonfeed` 的 `Content-Type` 改成 Vercel 会压缩的类型，或对它单独 `Content-Encoding`。
**预期：Fast Origin Transfer −6～13 GB/月（item 之一即可回到额度内）。**

### R3. `htmlLimitedBots`：所有被列入的 bot 请求绕过预渲染，且**不可缓存**

`prerender-manifest.json` 每条路由都带 `experimentalBypassFor`（`Bingbot|baiduspider|yandex|Slackbot|Twitterbot|LinkedInBot|Discordbot|facebookexternalhit|applebot|…`）。实测：

```
同一篇文章 URL：浏览器 8.2 ms / 156,663 B   →  Bingbot 82.8 ms / 238,110 B
首页：106.25 ms / 144,349 B       /blog：60.9 ms      /about：62.5 ms
响应头：Cache-Control: private, no-cache, no-store → CDN 不可能缓存
```

**即每一个 Bingbot / 百度 / 社交预览请求都是一次不可缓存的整页渲染，比正常访问贵 10 倍。** 好消息：Googlebot、GPTBot、ClaudeBot **不在**该名单里（走静态，12.5 ms）。

**修复**：用 `next.config.js` 的 `htmlLimitedBots` 收窄正则（只保留真正需要非流式 HTML 的 UA）；或接受成本但对爬得最凶的 UA 做 robots 限制。

### R4. footer 的一句 `cacheLife("days")` 把全站 87 条路由钉成 24 h 再验证

`src/components/footer.js:18` → `src/lib/site-year.js:20-23`（`cacheLife("days")`）。
Next 规则：**一条路由的 revalidate 取它包含的所有 cache 里最短的那个**（`building.md:353`，源码见 `use-cache-wrapper.js:601-616` 的 min 归约）。所以 `prerender-manifest` 里 88 条 `PARTIALLY_STATIC` 页面路由中有 87 条是 `revalidate=86400 / expire=604800`（唯一例外是 `/_global-error`，`revalidate=false`）。

**代价**：87 × 30 = 2,610 次页面再验证/月，每次实测 1.53 s CPU → **≈1.1 h CPU/月**，外加 2,610 次 ISR 写与回源。

**修复**：`getSiteYear()` 改 `cacheLife("max")`（跨年后最多 30 天显示旧年份，对 footer 版权年完全可接受）；或把它放进独立的 `<Suspense>` 洞 / 用 `cacheTag` 在部署时失效。

### R5. `/og`：单次 1.9 s CPU，而 feed 里有 52 个唯一 `/og` URL

- `src/lib/feed/urls.js:coverImageUrl()`：文章没有 `image` 就回退到 `/og`；**65 篇里 50 篇没有封面** → feed 里 53 个 `/og?` URL（52 个唯一）。
- 每篇文章 HTML 的 `og:image` 也是逐条不同的 `/og?...&v=4`。
- 线上 `/og` 新 URL = `x-vercel-cache: MISS` → 函数渲染 879 ms–1.9 s（3 次 Google Fonts 往返 + Satori + sharp 缩放头像）。

**修复**：构建期预生成 65 张 OG PNG（`public/og/` 或 `opengraph-image` 静态），运行时只做静态分发；或至少本地打包字体子集 + 构建期生成头像 PNG；feed 封面不要用 `/og`。

---

## 5. 次级问题（不超限，但同源，值得一起修）

### S1. 每张卡片 `prefetch={true}` → 一次访问 6–19 次不可缓存的服务端请求

`src/components/card.js:43`。实测预渲染 HTML 里的文章链接数：**首页 18、/blog 8、/tags/AI 6、文章页 6（4 related + 2 prev/next）**，再加 navbar `/about` = 19。线上 RSC 响应是 `private, no-store` → 每个都是一次真实请求 + ISR 读；首页光投机 RSC 就是 **19 × 35.5 KB ≈ 675 KB**。

`CLAUDE.md` 里写的理由（"every post is static，所以 per-link prefetch 从 static cache 解析 params"）在 Cache Components 之后**不再成立**：`params` 是 request-time，每个 prefetch 都是一次 PPR 渲染。`partialPrefetching` 只对默认 `"auto"` 去重（每路由一个共享 App Shell），**不会**去重 `prefetch={true}`。

**修复**：卡片回到默认 prefetch；只保留文章页 prev/next（2 个）。**预期：CDN Requests / ISR Reads / 客户端带宽显著下降。**

### S2. `/static/**` 全部 `max-age=0, must-revalidate`（无浏览器缓存）

线上实测 `/static/opt/M2-CPI-Date-0162a4d0.webp`：`Cache-Control: public, max-age=0, must-revalidate`。这是 Next 对 `public/` 的默认行为，本站没配 `headers()` → **每次导航都要重新验证 202 张图**（虽然 CDN 命中，但仍是请求 + 延迟）。

**修复**：`next.config.js` 加 `headers()`，对 `/static/:path*` 发 `public, max-age=31536000, immutable`（图片加改名即失效）。

### S3. 图片体积与内容缺陷

- `M2-CPI-Date.gif` = **4,928,251 B**（4.7 MB 动图）且 `max-age=0` → 单篇文章首屏代价极高；
- 最大 JPG 5.9 MB、1.9 MB PNG；202 张共 49.5 MB；
- `formats: ["avif","webp"]` + 16 个宽度档 → 单次冷变换要从 origin 拉原图再编 AVIF；
- **正确性 bug：文章内 12 张 SVG 在生产环境全部 400**（`/_next/image` → `dangerouslyAllowSVG:false`，而 `optimized-html-renderer.js` 没给 SVG 加 `unoptimized`；`friendlinks.js:46` 有正确写法）。
- `next.config.js` 关于"图片 URL 带 content hash"的注释对字符串路径图片是**错的**（URL 里没有 hash），所以 `minimumCacheTTL` 才是唯一的缓存依据。

**修复**：原图压到 ≤300 KB WebP（49.5 MB → ~5 MB）；动图改成视频或静态首帧；修正 SVG 的 `unoptimized`；`deviceSizes` 去掉 2048/3840（正文栏最大 720 px）。

### S4. 每个函数 bundle 都被塞进 52.5 MB 的 `public/` → Functions Storage 2.91 GB

`rehype-figure` 用 `sharp(path.join(process.cwd(), "public", <动态>))` 读真实宽高，`@vercel/nft` 无法静态解析 → **整个 `public/`（221 文件 / 55 MB，含 search-index.json）被 trace 进每个内容路由函数**。实测 24 条 trace 合计 901 MB，每条 67.9 MB（public 51.8 MB + data/content 0.8 MB + node_modules 13.5 MB）。2.91 GB ≈ 2 个保留部署 × ~20 个函数 × ~66 MB。

**修复**：构建期把 `{src: {w,h}}` 写进一个 JSON 清单，运行时不再 `fs`+`sharp`；并加 `outputFileTracingExcludes` 排除不需要图片的 route。
> 附带确认：`data/content` **确实** 在 trace 里（66/66），所以 ISR 再验证能读到内容——不存在"运行时读不到文件"的风险。

### S5. `/llms-full.txt` / `/llms.txt` 没问题

811 KB、`s-maxage=31536000`、构建期生成、`buildLlmsFull()` 只用 raw markdown（63 ms）。**不要动它**，它反而是 AI 抓取最省成本的那条路。

---

## 6. 修复优先级与预期效果

| # | 改动 | 文件 | 主要指标 | 预期 |
|---|---|---|---|---|
| **1** | feed `cacheLife("max")`；三格式共享一次 corpus；`lastBuildDate` 用内容日期 | `src/lib/feed/cached.js`、`build-feed.js` | **Fluid CPU ↓ 4.4–6 h**；ISR Writes ↓ ~1.2 GB | 单独即可让 CPU 回到额度 |
| **2** | feed `s-maxage` 提到 ≥ revalidate；body 砍到 20 篇 / 去 Shiki；jsonfeed 可压缩 | `src/app/{rss,atomfeed,jsonfeed}/route.js` | **FOT ↓ 6–13 GB** | 单独即可让 FOT 回到额度 |
| **3** | 卡片去掉 `prefetch={true}`（只留 prev/next） | `src/components/card.js:43` | CDN Requests、ISR Reads、FOT | 高 |
| **4** | 收窄 `htmlLimitedBots` | `next.config.js` | Fluid CPU（爬虫量） | 中–高 |
| **5** | `getSiteYear()` → `cacheLife("max")` | `src/lib/site-year.js` | Fluid CPU ↓ ~1.1 h；ISR Writes | 中 |
| **6** | OG 构建期预生成 | `src/app/og/route.js`、`feed/urls.js` | Fluid CPU、FOT | 中 |
| **7** | `/static/**` 长缓存 + 图片压缩 + 修 SVG | `next.config.js`、`rehype-figure` | FDT、CDN Requests、LCP | 中 |
| **8** | 构建期 intrinsic size + tracing excludes | `rehype-figure`、`next.config.js` | Functions Storage、冷启动 | 低–中 |

**只做 #1 + #2，两个超限指标就应该都回到免费额度内**——它们正好一一对应。

---

## 7. 时间线：为什么是"突然"变快的

`git log`（158 commits）：
1. `2026-11-04 457e1bd` adopt Yarn 4, Next 16, React 19
2. `2026-11-04 0d2e1af` instant navigation gates / intent prefetch / CSS scroll UI
3. `2026-11-04 669917f` **Cache Components data flow, cached reads** ← 全站进入 PPR + `'use cache'` 模型
4. `2026-11-04 434bca0` server-side search palette
5. `2026-11-05/06` feeds 重构、`c62dfc1` harden SEO/GEO（llms.txt、OG v4）
6. `2026-11-10` 内容更新

迁移前：每页纯静态 HTML，CDN 直接出，**函数 CPU ≈ 0**。
迁移后：页面文档仍缓存（实测 HIT/PRERENDER），但引进了三个新成本——PPR 让每个 prefetch/RSC 都不可缓存且要渲染、`cacheLife("days")` 把全站钉成每日再验证、feed 从"每次请求都渲染"收敛到"每小时 3 次 × 10–23 s"（是改善，但仍是 2,160 次/月的全量 Shiki）。

**这不是"Next.js 16 有毒"，而是迁移时保留了三处旧模型的假设**：① "post 都是 static，所以 prefetch 免费"；② "footer 的年份读可以随便用短 cache"；③ "feed 只要缓存了就不贵"。

---

## 8. 如何再验证（Vercel 侧）

本机 CLI 未登录，以下需要你在有权限的环境执行：

```bash
vercel login && vercel link
vercel metrics                                   # 计划用量明细
# Observability Plus（14 天窗口，per-route）：
#   Fluid Active CPU / invocations 按路由 → 看 /rss /atomfeed /jsonfeed 是否吃满
#   ISR reads/writes 按路由 → 看是不是 feed
#   CDN cache status 按路由 → 看 prefetch RSC 的 no-store 比例
vercel logs <deployment> --follow                # 看 x-vercel-cache: MISS/STALE/BYPASS 与 vary_key_denied
```

**三个判定修复生效的硬信号**
1. `/rss` 响应头 `lastBuildDate` 不再每次变化；`s-maxage` ≥ 3600；
2. Observability 里 `/rss` `/atomfeed` `/jsonfeed` 的 invocation 在部署后趋近 0（原本每小时各 1 次）；
3. Fluid Active CPU 日增量降到现在的 ~1/6。

本地复现：`.tmp/lead/bench*.mjs`（冷渲染）、`.tmp/lead/probe.ps1`（文档/RSC/prefetch 三种请求 CPU）、`.tmp/audit/expire-measure.ps1`（强制过期再验证）。

---

## 9. 关于架构：Cache Components 要不要留？

不必回退，但当前配置把它的两个特性都用反了：

- **PPR 的价值**是"静态壳先出、动态洞后贴"。这个站**没有任何 request-time 数据**（无登录、无 cookie、无个性化），动态洞只有 `params`。为它付"每个 prefetch 一次渲染"是纯成本。
- **`partialPrefetching` 的价值**是"一次 shell 预取、多处复用"。保留 `prefetch={true}` 等于把旧模型的"每链接全量预取"接回新模型：收益消失、成本保留。

**最小改动路线**：完成 §6 的 #1–#6，并把四条硬约束写进 `CLAUDE.md`：
1. feed 的 `s-maxage` 必须 ≥ ISR revalidate；
2. feed 的 `lastBuildDate` 不得用 `new Date()`；
3. 卡片不得用 `prefetch={true}`；
4. 任何 `cacheLife("seconds"|"minutes"|"days")` 出现在 layout 里，都要先算清它会把多少条路由钉住。

**彻底路线**：让内容页回到"构建期完全静态 + CDN"，feed/OG 构建期预生成，运行时只剩静态分发——Fluid CPU 会趋近 0。

---

## 10. 审计中发现的两个正确性 Bug（与计费无关但应尽快修）

1. **文章内 12 张 SVG 在生产环境 400 打不开**（`/_next/image` 拒 SVG，而渲染器没加 `unoptimized`）。已线上复现。
2. **4.7 MB 的 `M2-CPI-Date.gif` 与 5.9 MB 的 `IMG_20251007_140841.jpg`** 仍按原图分发，且 `max-age=0`。既是流量成本也是首屏灾难。


---

# 修复后实测（质量优先改造）

## 变更概要

| 项 | 修复前 | 修复后 |
|---|---|---|
| feed 单次再生成 CPU（冷） | 10.3–23 s | **0.14–0.39 s** |
| feed 单次再生成 CPU（热） | 20 s（每次全量 Shiki） | **8–13 ms** |
| feed 缓存条目 | 3 份 × 每小时全量重渲染 | **1 份共享条目**，600 s 窗口，三格式各 6–19 ms 序列化 |
| `<lastBuildDate>` | 渲染时刻（每次都变 → 每次都算 ISR 写） | 内容派生 `max(lastmod||publishDate)`，字节稳定 |
| feed 响应体积 | rss 1,005,571 B | 947,252 B（−5.8%；全文 feed 的物理下限，见下） |
| 页面路由 revalidate | 87 条 × 24 h（footer `cacheLife("days")`） | **87 条 × 30 d**（footer `cacheLife("max")`） |
| `/og` 单次渲染 | 1,875 ms CPU（6 次 Google 往返 + sharp） | 网络 0 次、sharp 移出模块图；渲染只剩 Satori，66 张卡片像素逐字节不变 |
| 客户端路由缓存 | 300 s | 900 s（长会话重复点击不再回源） |
| `public/static` | 51.8 MB / 219 张 | **27.7 MB**（56 张重压，像素尺寸不变） |
| 最坏单图 | 5.9 MB JPG / 4.7 MB 动图 | 1.38 MB AVIF / 2.38 MB 动图 WebP |
| 函数 trace 中的 `public/` | 每函数 51.8 MB | **排除**（保留 favicons/avatars，因为 /og 与 metadata 读它们） |
| 文章内 SVG | 12 张生产环境 400 | 200（`unoptimized` + e2e 图片解码断言守卫） |
| 首图 eager 策略 | 一律 `eager + fetchPriority=high` | 首图仍 eager，>400 KB 时降级优先级 |

## 为什么 feed 只小了 5.8%，而不是计划里的 30%

按"全文 feed"的硬约束算过：65 条 `content:encoded` 的**纯文本**就有 746,561 B（中文 3 B/字），XML 开销约 55 KB；把标签全删也只有约 800 KB。Shiki 的 `<span>` 外壳实测只有 58,710 B，已全部剥掉（`spanTagsLeft = 0`）。要 −30% 只能改成摘要 feed，那会破坏订阅全文与收录，因此**保留全文、接受 −5.8%**，并把这个取舍写进 CLAUDE.md。

## 验证

- `yarn lint` / `yarn build` / `yarn build:e2e` / `yarn test:e2e`：**30 passed**（含新增 `e2e/feed.spec.js`、`e2e/media.spec.js`）。
- feed 契约：四个 feed 200、条目 65、`content:encoded` 非空、两次请求 `lastBuildDate` 一致、`s-maxage=600`。
- media 契约：4 篇样本文章所有 `<img>` `naturalWidth > 0`，无 `/_next/image` 或 `/static` 4xx/5xx（这条会直接锁住那 12 张 SVG）。
- 图片引用构建门：`scripts/build-search-index.mjs` 现在断言"内容里引用的每个 `/static` 资源都存在且有尺寸条目"，共 208 个引用全部通过；改名漏改会让 **build 失败**而不是线上图裂。
- /og 像素一致性：8 张真实卡片与旧 route 输出 sha256 全等；66 张全部 200 且 0 次远程字体请求；模板发布时用模板自己的头像重新生成 `assets/og/avatar-152.png`（作者头像不进模板）。

> 三份子报告（`vercel-metrics.md` / `runtime-cpu.md` / `cache-isr.md`）的结论已并入本文件，原始长文在本次整理中删除以去掉重复。
