# 2026-11-07 作者/站点数据集中化审计

## 审计目标

把作者、社交账号、版权、feed 身份、页面文案和示例型个性化内容收敛到 data/，避免在 src/ 中硬编码。知乎属于可选项：data/sitemetadata.js 的 zhihu 未定义或为空时，Footer 不渲染入口，JSON-LD 不加入 sameAs。

## 发现并修复

| 位置 | 之前 | 现在 |
|---|---|---|
| src/lib/feed/build-feed.js | 作者邮箱、版权、generator 硬编码 | siteMetadata.feedEmail / copyright / feedGenerator |
| src/app/microblog/rss/route.js | 微博 feed 邮箱/版权/generator 硬编码 | 同上，并使用 pages.microblog |
| src/app/blog/[...slug]/page.js | CC BY-NC-SA 4.0 文本硬编码 | siteMetadata.copyright / copyrightUrl |
| src/components/friendlinks.js | GitHub 编辑地址硬编码 hxlog/prologue.dev；标题/描述硬编码 | 从 siteMetadata.github / siteRepo / pages.links 生成 |
| src/app/links/page.js | 页面标题/描述硬编码 | siteMetadata.pages.links |
| src/app/microblog/page.js | 页面标题/描述硬编码 | siteMetadata.pages.microblog |
| src/app/blog/page.js | 归档标题/描述硬编码 | siteMetadata.pages.archive |
| src/app/ui/page.js | UI 说明、作者、站点 host、项目示例硬编码 | siteMetadata.pages.ui / author / authorDesc / siteUrl |
| src/lib/llms.js | 站点描述硬编码 | siteMetadata.pages.llms.description |
| src/lib/projects.js | User-Agent 硬编码 | siteMetadata.siteRepo 派生 |
| src/components/ui-standard/copy-field-demo.js | 回退 URL 硬编码 prologue.dev | 只使用 siteMetadata.siteUrl |
| src/lib/structured-data.js | sameAs 只有 GitHub | GitHub + 可选 zhihu |
| src/components/footer.js | 无知乎入口 | 条件渲染 siteMetadata.zhihu，官方 Simple Icons 单色路径，currentColor |
| data/sitemetadata.js | 无 zhihu/版权/feed/pages | 全部新增 |
| template/data/sitemetadata.js | starter 无对应字段 | 增加通用 pages/版权/feed；zhihu 为空 |

## 审计结果

- src/ 中不再包含作者姓名、知乎、GitHub 用户名、prologue.dev feed 邮箱、版权文本或项目示例的运行时硬编码。
- 仅剩 og/route.js 的设计注释中提到示例文案，不参与运行。
- 知乎未定义/为空时 Footer 不显示；template 保持通用 starter，不会泄露作者账号。
- 作者与文章内容仍分别由 data/sitemetadata.js、data/content/**、data/microblog.yaml、data/links.yaml、data/projects.yaml 维护。

## 验证

- 全仓字符串审计：槐序/hxlog/xingyu/hello@prologue/CC BY-NC-SA/项目名在 src/ 中无运行时命中。
- Next MCP：get_compilation_issues 为 0；get_page_metadata /blog 指向 app/blog/page.js；get_errors 为空。
- agent-browser 390×844：菜单打开/关闭使用真实坐标点击，scrollY 保持 700；标签 gap 4px；知乎 Footer 可见且 href 正确。
- yarn lint / yarn build / yarn test:e2e 通过。
- template worktree 执行 yarn install --immutable + yarn build 通过；zhihu 为空时无入口。
