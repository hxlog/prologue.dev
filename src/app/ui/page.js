import ThemeSwitch from "../../components/themeswitch";
import PageTransition from "../../components/page-transition";
import RouteTransition from "../../components/route-transition";
import ColorSystem from "../../components/ui-standard/color-system";
import TypeLadder from "../../components/ui-standard/type-ladder";
import TokenList from "../../components/ui-standard/token-list";
import HoverPlayground from "../../components/ui-standard/hover-playground";
import RevealDemo from "../../components/ui-standard/reveal-demo";
import CopyFieldDemo from "../../components/ui-standard/copy-field-demo";
import MicroblogTimeline from "../../components/microblog-timeline";
import TenYearsLink from "../../components/ten-years-link";
import JsonLd from "../../components/json-ld";
import { breadcrumbJsonLd, webPageJsonLd } from "../../lib/structured-data";
import { absoluteUrl, buildMetadata, defaultOgImage } from "../../lib/seo";

const UI_DESCRIPTION =
  "prologue.dev 的颜色、字体、形状、动效与组件标准：本页直接读取生产 CSS，与实际站点同源。";

/**
 * /ui — the living UI standard.
 *
 * This page is deliberately NOT a copy of the design system: its palette,
 * type ladder, radii, shadows and motion values are read from the running
 * stylesheet at runtime (src/lib/css-probe.js), and every specimen is the
 * production class from globals.css. Editing globals.css updates this page
 * with no second edit — the only per-token work when adding a token is one
 * row in the GROUPS arrays below.
 */

export const metadata = buildMetadata({
  title: "UI 标准 / UI Standard",
  description: UI_DESCRIPTION,
  path: "/ui",
  type: "website",
  image: defaultOgImage("UI 标准"),
});

/* Cache Components gates (Next 16.4) — same contract as the other static pages:
   the shell must resolve synchronously and stay prerendered. */
export const instant = true;
export const ensureStatic = "shell";

const NAV = [
  { id: "colors", label: "颜色" },
  { id: "type", label: "字体" },
  { id: "shape", label: "形状" },
  { id: "motion", label: "动效" },
  { id: "components", label: "组件" },
  { id: "hover", label: "悬停" },
  { id: "rules", label: "规范" },
];

const SHAPE_GROUPS = [
  {
    title: "圆角",
    note: "三级圆角 + 全圆。控件用 control，卡片用 card，弹层用 panel。",
    rows: [
      { name: "--radius-control", usage: "按钮 / 输入框", preview: "radius" },
      { name: "--radius-card", usage: "卡片", preview: "radius" },
      { name: "--radius-panel", usage: "模态 / 大面板", preview: "radius" },
      { name: "--radius-pill", usage: "药丸 / chip / 图标按钮", preview: "radius" },
    ],
  },
  {
    title: "容器与高度",
    note: "页面最大宽度与三档内容宽度；--nav-height 是吸顶导航的实测高度。",
    rows: [
      { name: "--container-page", usage: "页面容器（.shell）", preview: "none" },
      { name: "--container-archive", usage: "归档页", preview: "none" },
      { name: "--container-read", usage: "阅读宽度", preview: "none" },
      { name: "--nav-height", usage: "吸顶导航高度", preview: "none" },
    ],
  },
  {
    title: "阴影",
    note: "阴影一律由 --shadow-tint 着色，随主题变化；卡片静止态只有 1px 内描边。",
    rows: [
      { name: "--shadow-card", usage: "静止卡片", preview: "shadow" },
      { name: "--shadow-card-hover", usage: "hover / 浮起", preview: "shadow" },
      { name: "--shadow-pop", usage: "弹层 / 模态", preview: "shadow" },
    ],
  },
];

const MOTION_GROUPS = [
  {
    title: "时长与缓动",
    note: "整站只有一条缓动曲线和五个时长；hover 时长在行内悬停时预览。",
    rows: [
      { name: "--ease-out-expo", usage: "唯一缓动曲线", preview: "ease" },
      { name: "--duration-instant", usage: "即时反馈", preview: "duration" },
      { name: "--duration-fast", usage: "hover / 颜色", preview: "duration" },
      { name: "--duration-base", usage: "卡片 / 展开", preview: "duration" },
      { name: "--duration-enter", usage: "入场动画", preview: "duration" },
      { name: "--duration-slow", usage: "主题揭示", preview: "duration" },
    ],
  },
];

const CARD_CLASSES = "card card-interactive card-spotlight relative flex flex-col p-5";
const HOVER_SNIPPET = "<article className=\"" + CARD_CLASSES + "\"> … </article>";

function Section({ id, index, eyebrow, title, lead, children }) {
  return (
    <section id={id} className="scroll-mt-32 border-t border-border py-10">
      <div className="flex items-start gap-3">
        <span className="mt-1 font-mono text-xs text-faint">{index}</span>
        <div className="min-w-0">
          <p className="eyebrow">{eyebrow}</p>
          <h2 className="mt-1 text-h2 font-semibold tracking-tight text-foreground">{title}</h2>
          {lead ? <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">{lead}</p> : null}
        </div>
      </div>
      <div className="mt-6">{children}</div>
    </section>
  );
}

function Specimen({ title, note, children }) {
  return (
    <div className="card p-5">
      <p className="section-label">{title}</p>
      {note ? <p className="mt-1.5 text-xs leading-5 text-muted">{note}</p> : null}
      <div className="mt-3.5">{children}</div>
    </div>
  );
}

export default function UiStandardPage() {
  return (
    <RouteTransition>
      <PageTransition className="mx-auto max-w-6xl py-8">
        <JsonLd
          data={webPageJsonLd({
            title: "UI 标准 / UI Standard",
            description: UI_DESCRIPTION,
            url: absoluteUrl("/ui"),
          })}
        />
        <JsonLd
          data={breadcrumbJsonLd([
            { name: "首页", path: "/" },
            { name: "UI 标准", path: "/ui" },
          ])}
        />
        <header>
          <p className="eyebrow">UI Standard · v1</p>
          <h1 className="mt-2 text-h1 font-semibold tracking-tight text-foreground sm:text-display">
            设计系统与 UI 标准
          </h1>
          <p className="mt-3 max-w-3xl text-lead leading-8 text-muted">
            颜色、字体、形状、动效、组件与交互的唯一事实来源。本页的每个色板、每个数值都直接读取生产
            <code className="mx-1 rounded bg-surface-2 px-1.5 py-0.5 font-mono text-sm text-foreground">
              globals.css
            </code>
            的 CSS 变量，与线上页面同源 —— 改 CSS，本页自动跟随，不存在第二份手写数值。
          </p>
          <dl className="mt-5 grid grid-cols-1 gap-3 text-xs text-muted sm:grid-cols-3">
            <div className="rounded-(--radius-control) border border-border bg-surface-2 px-3 py-2.5">
              <dt className="font-mono text-faint">读取方式</dt>
              <dd className="mt-0.5">运行时 getComputedStyle + CSSOM 主题作用域</dd>
            </div>
            <div className="rounded-(--radius-control) border border-border bg-surface-2 px-3 py-2.5">
              <dt className="font-mono text-faint">双主题</dt>
              <dd className="mt-0.5">Light / Dark 并排，不随当前主题漂移</dd>
            </div>
            <div className="rounded-(--radius-control) border border-border bg-surface-2 px-3 py-2.5">
              <dt className="font-mono text-faint">维护成本</dt>
              <dd className="mt-0.5">只维护 token 名；值一律不复制</dd>
            </div>
          </dl>
        </header>

        <nav
          aria-label="本页目录"
          className="sticky-below-nav z-30 mt-6 -mx-1 overflow-x-auto border-y border-border bg-background py-2"
        >
          <div className="flex items-center gap-1.5 px-1">
            {NAV.map((item) => (
              <a key={item.id} href={"#" + item.id} className="nav-item shrink-0">
                {item.label}
              </a>
            ))}
          </div>
        </nav>

        <Section
          id="colors"
          index="01"
          eyebrow="Colour"
          title="颜色方案"
          lead="两套语义色板共享同一组 token 名。左 :root、右 .dark，右侧面板读取的是 .dark 作用域声明，所以即使当前页面是亮色，也能看到暗色真值；文字色的 WCAG 比率按各自面板的 --background 计算。"
        >
          <ColorSystem />
          <p className="mt-4 text-xs leading-5 text-faint">
            规则：装饰色（pastel / sky / glow）不承载正文；正文链接使用 --accent（4.15:1，界面级放宽）；
            主按钮文字 --on-accent 落在 --accent-strong 上（5.35:1）。新增文字 token 必须在本页比率 ≥ 4.5:1。
          </p>
        </Section>

        <Section
          id="type"
          index="02"
          eyebrow="Typography"
          title="字体与排版"
          lead="8 级字号阶梯，全部来自文本工具类；下面的 px / 行高 / 字重由浏览器在渲染后实测。整站只使用系统字体栈，0 个 webfont 请求。"
        >
          <TypeLadder />
          <article className="prose mt-8 max-w-none">
            <h3>文章排版 .prose</h3>
            <p>
              文章正文由 markdown 管线输出，统一套用 <code>.prose</code> 样式；行内链接使用
              <a className="link" href="#colors">
                语义色链接
              </a>
              ，代码与公式分别走 Shiki 与原生 MathML。
            </p>
            <blockquote>
              <p>中英文混排时，标题使用 tracking-tight；正文行高 1.75 左右，保证长文可读。</p>
            </blockquote>
            <ul>
              <li>列表、引用、表格都映射到语义色 token。</li>
              <li>不引入 webfont；不使用字距夸张的全大写小标题。</li>
            </ul>
            <table>
              <thead>
                <tr>
                  <th>元素</th>
                  <th>规则</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>标题</td>
                  <td>字重 600，tracking-tight</td>
                </tr>
                <tr>
                  <td>正文</td>
                  <td>--foreground / --muted 两档</td>
                </tr>
              </tbody>
            </table>
          </article>
        </Section>

        <Section
          id="shape"
          index="03"
          eyebrow="Shape"
          title="形状、阴影与容器"
          lead="半径、容器宽度和阴影全部来自 token；右侧数值同样是浏览器计算后的结果。"
        >
          <TokenList groups={SHAPE_GROUPS} />
        </Section>

        <Section
          id="motion"
          index="04"
          eyebrow="Motion"
          title="动效"
          lead="没有动画库：入场、主题揭示、滚动进度和 hover 全部是 CSS。动效使用同一条 ease-out-expo 曲线与五个时长 token，系统开启“减少动态效果”时由全局媒体查询降级。"
        >
          <TokenList groups={MOTION_GROUPS} />
          <div className="mt-6 card p-5">
            <RevealDemo />
          </div>
          <div className="mt-5 card flex flex-wrap items-center justify-between gap-4 p-5">
            <div>
              <p className="section-label">主题切换</p>
              <p className="mt-1.5 text-xs leading-5 text-muted">
                与右上角同一个组件：圆形 view-transition 揭示（0.618s），揭示期间冻结全站过渡，
                并对吸顶玻璃头临时关闭 backdrop-filter。
              </p>
            </div>
            <div className="flex items-center gap-3">
              <ThemeSwitch />
              <span className="font-mono text-xs text-faint">ThemeSwitch</span>
            </div>
          </div>
          <p className="mt-4 text-xs leading-5 text-faint">
            页面级动效：route-transition（旧页 150ms 淡出 / 新页 260ms 淡入 + 6px 上移）。
            滚动进度条与玻璃头的抬升阴影使用 <code>animation-timeline: scroll()</code>，不监听滚动事件。
          </p>
        </Section>

        <Section
          id="components"
          index="05"
          eyebrow="Components"
          title="组件"
          lead="全部是 globals.css 里真实的组件类，直接在页面上跑 hover / focus / active 状态。"
        >
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
            <Specimen title="按钮" note=".btn-primary / .btn-ghost / .btn-icon；hover 位移 1px，active 缩放 0.98。">
              <div className="flex flex-wrap items-center gap-3">
                <button type="button" className="btn btn-primary">
                  主按钮
                </button>
                <button type="button" className="btn btn-ghost">
                  次按钮
                </button>
                <button type="button" className="btn-icon" aria-label="图标按钮">
                  <svg viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5" aria-hidden="true">
                    <path d="M10 2a8 8 0 100 16 8 8 0 000-16z" />
                  </svg>
                </button>
              </div>
              <p className="mt-3 text-xs text-faint">
                填充渐变使用两个 strong ink，保证两端都过 AA；不使用 pastel 作为文字底色。
              </p>
            </Specimen>

            <Specimen title="输入框" note=".input；focus 时 accent 描边 + 22% 焦点环。">
              <div className="flex flex-wrap items-center gap-3">
                <input className="input max-w-xs" placeholder="搜索文章、标签…" aria-label="输入框示例" />
                <button type="button" className="btn btn-ghost shrink-0">
                  搜索
                </button>
              </div>
            </Specimen>

            <Specimen title="导航药丸" note=".nav-item；当前页 aria-current=page + data-active=true 为三段渐变填充。">
              <div className="flex flex-wrap items-center gap-1.5">
                <a className="nav-item" href="#components" aria-current="page" data-active="true">
                  首页
                </a>
                <a className="nav-item" href="#components">
                  归档
                </a>
                <a className="nav-item" href="#components">
                  标签
                </a>
                <a className="nav-item" href="#components">
                  关于
                </a>
              </div>
            </Specimen>

            <Specimen
              title="标签 chip（C 星屑）"
              note=".chip 静止 6% 三色 wash + 1px 淡紫描边；hover 时 1px 三色外圈旋转（5.5s）+ 两颗星点闪烁（1.7s），文字 → --accent-strong。"
            >
              <div className="flex flex-wrap items-center gap-1.5">
                <a className="chip" href="#components">
                  经济学
                </a>
                <a className="chip" href="#components">
                  人工智能
                </a>
                <a className="chip" href="#components">
                  随笔
                </a>
                <button type="button" className="chip-more">
                  +2
                </button>
              </div>
              <p className="mt-3 text-xs text-faint">
                药丸太小，放不下卡片那种双层柔光，所以沿用卡片 07 的外圈语言：同一套 conic 三色 +
                mask-composite 1px 裁切，只是把旋转放慢到 5.5s、加了两颗 1px 星点。把指针移上来试试 ——
                这是全站唯一带持续动效的 hover。
              </p>
            </Specimen>

            <Specimen title="眉标与分组标签" note=".eyebrow（渐变短线 + 文字）与 .section-label（渐变竖条 + 文字）。">
              <div className="space-y-3">
                <p className="eyebrow">Section Eyebrow</p>
                <p className="section-label">分组标题</p>
              </div>
              <p className="mt-3 text-xs text-faint">
                不做大写、不做宽字距：标签是中文字符，两者只会降低可读性。
              </p>
            </Specimen>

            <Specimen title="链接与渐变文字" note=".link 正文链接；.text-gradient 仅用于大字号标题。">
              <p className="text-sm leading-6 text-muted">
                正文中的<a className="link" href="#type">行内链接</a>使用可访问的 accent ink，hover 更亮。
              </p>
              <p className="text-gradient mt-3 text-h2 font-semibold">渐变标题文字</p>
              <p className="mt-2 text-xs text-faint">
                文字渐变必须使用 --gradient-brand-text（两个 ink），不能用 pastel 填充渐变。
              </p>
            </Specimen>

            <Specimen title="复制字段" note=".copy-field + useCopy()：空闲 / 已复制 / 复制失败三态。">
              <CopyFieldDemo />
            </Specimen>

            <Specimen title="卡片（静止）" note=".card：1px 内描边就是全部高度；hover 效果在 06 节。">
              <article className="card relative flex flex-col p-4">
                <p className="text-xs text-faint">2026-11-04 · 约 6 分钟</p>
                <p className="card-title mt-2 text-lg font-semibold tracking-tight text-foreground">
                  一张卡片的解剖
                </p>
                <p className="mt-1.5 line-clamp-2 text-sm leading-6 text-muted">
                  元信息、标题、摘要与标签；整卡是一个链接（stretched link），标签浮在其上。
                </p>
                <div className="mt-3 flex gap-1.5">
                  <span className="chip">阅读</span>
                  <span className="chip">设计</span>
                </div>
              </article>
            </Specimen>

            <Specimen title="模态面板" note=".modal-panel + modal.js 打开：遮罩、Esc、焦点陷阱、滚动锁。">
              <div className="modal-panel p-4">
                <p className="text-sm font-semibold text-foreground">订阅更新</p>
                <p className="mt-1.5 text-xs leading-5 text-muted">
                  面板本身使用 94% surface + 16px 背景模糊；正文、按钮与链接沿用同一套 token。
                </p>
                <div className="mt-3 flex justify-end gap-2">
                  <button type="button" className="btn btn-ghost h-8">
                    取消
                  </button>
                  <button type="button" className="btn btn-primary h-8">
                    确定
                  </button>
                </div>
              </div>
            </Specimen>

            <Specimen title="玻璃吸顶导航" note=".glass-header：76% 背景 + 14px 模糊；滚动时抬升阴影由 scroll() 驱动。">
              <div
                className="relative h-20 overflow-hidden rounded-(--radius-control)"
                style={{ backgroundImage: "var(--gradient-brand)" }}
              >
                <div className="glass-header absolute inset-x-0 top-0 flex items-center justify-between gap-3 px-3 py-2">
                  <span className="text-sm font-semibold text-foreground">prologue.dev</span>
                  <div className="flex items-center gap-1">
                    <span className="nav-item">归档</span>
                    <span className="nav-item">关于</span>
                  </div>
                </div>
              </div>
            </Specimen>

            <Specimen
              title="全站搜索面板"
              note=".search-dialog-*；桌面面板 760px，移动端结果改 S2 三段式（标题 / 摘要 / 日期），日期独占整行且 nowrap。点导航栏放大镜或按 ⌘K/Ctrl+K 打开真实面板。"
            >
              <div className="search-dialog-panel" aria-hidden="true">
                <div className="search-dialog-topline" />
                <div className="search-dialog-input">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                    strokeWidth={1.6}
                    stroke="currentColor"
                    className="h-[18px] w-[18px] shrink-0 text-faint"
                    aria-hidden="true"
                  >
                    <circle cx="10.5" cy="10.5" r="6.5" />
                    <path strokeLinecap="round" d="m16 16 4.5 4.5" />
                  </svg>
                  <input readOnly placeholder="搜索文章与页面…" tabIndex={-1} />
                  <kbd>esc</kbd>
                </div>
                <div className="search-dialog-progress" />
                <div className="search-dialog-body">
                  <p className="search-dialog-group">
                    文章 <em>2</em>
                  </p>
                  <a className="search-result" href="#components" data-active="true">
                    <span className="search-result-dot" />
                    <span className="search-result-title">流动性、杠杆与周期的共振</span>
                    <span className="search-result-snippet">
                      当<mark>流动性</mark>转向，杠杆会放大回撤；本文拆解三者之间的时滞。
                    </span>
                    <span className="search-result-meta">2026-11-04 · 约 9 分钟</span>
                  </a>
                  <a className="search-result" href="#components">
                    <span className="search-result-dot" />
                    <span className="search-result-title">风险平价的第二次进化</span>
                    <span className="search-result-snippet">
                      从全天候到<mark>风险平价</mark>，组合管理的假设发生了什么变化。
                    </span>
                    <span className="search-result-meta">2026-10-21 · 约 12 分钟</span>
                  </a>
                  <p className="search-dialog-group">
                    页面 <em>1</em>
                  </p>
                  <a className="search-result" data-kind="page" href="#components">
                    <span className="search-result-dot" />
                    <span className="search-result-title">关于作者</span>
                    <span className="search-result-snippet">
                      作者槐序，00 后，梦想成为自由职业者。
                    </span>
                    <span className="search-result-meta">页面</span>
                  </a>
                </div>
                <div className="search-dialog-foot">
                  <span className="search-dialog-key">
                    <kbd>↑</kbd>
                    <kbd>↓</kbd> 选择
                  </span>
                  <span className="search-dialog-key">
                    <kbd>↵</kbd> 打开
                  </span>
                  <span className="search-dialog-count">共 3 条结果 · 2ms</span>
                </div>
              </div>
              <p className="mt-3 text-xs leading-5 text-faint">
                结果来自 <span className="font-mono">/api/search</span>（服务端 Fuse，索引不进浏览器）；高亮用
                <span className="font-mono"> mark </span>承载 accent 淡底，正文仍是 --muted。
              </p>
            </Specimen>

            <Specimen
              title="微博时间轴"
              note="T2：无逐条卡片。连续 1px 脊线 + 节点 + 发丝分隔；日期栏固定 72px（移动端 64px、紧凑 56px），month.day 与年份都 nowrap，不会被省略。图片用正文列宽，1 / 2 / 3 列网格，保留 lightbox。"
            >
              <MicroblogTimeline
                entries={[
                  {
                    id: "ui-mb-1",
                    date: "2026-11-04",
                    paragraphs: ["时间轴不是把卡片摞起来：它是一条连续的线，日期是线上的刻度。"],
                    images: [],
                  },
                  {
                    id: "ui-mb-2",
                    date: "2026-10-21",
                    paragraphs: ["同一条线在首页会变成紧凑版，只换列宽、字号与段落截断。"],
                    images: [],
                  },
                ]}
              />
            </Specimen>

            <Specimen
              title="十年之约 · 虫洞"
              note="L1：友链页底部的 banner；复用 .card / card-interactive / card-spotlight，CTA 用 .btn-ghost。页脚另有同一 URL 的内联 .link（F1），不加新行、不加新颜色。"
            >
              <TenYearsLink variant="links" />
            </Specimen>

            <Specimen
              title="开源项目卡片"
              note="Portfolio（/about 正文之后）；复用 .card + card-interactive + card-spotlight。全部卡片等宽两列，没有精选位，也没有额外的超链接按钮——整张卡就是仓库链接。"
            >
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {[
                  ["Balanced Portfolio", "机构级投资管理工具：全天候风险平价组合与回测、股指期货统计看板、场外期权定价。", "hxlog/balanced-portfolio", "48", "25"],
                  ["Prologue", "这个站点本身：内容优先的 Next.js 博客。", "hxlog/prologue.dev", "41", "10"],
                  ["DSH MCP Tools", "DeepSeek Harness 的 MCP 管理器。", "hxlog/dsh-mcp-tools", "3", "0"],
                ].map(([name, desc, repo, stars, forks]) => (
                  <a
                    key={repo}
                    href={`https://github.com/${repo}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="card card-interactive card-spotlight flex flex-col p-5"
                  >
                    <p className="card-title text-lg font-semibold leading-7 tracking-tight text-foreground">
                      {name}
                    </p>
                    <p className="mt-2 line-clamp-3 text-sm leading-6 text-muted">{desc}</p>
                    <div className="mt-auto flex items-center justify-between gap-3 pt-5 text-xs text-faint">
                      <span className="truncate font-mono text-[0.7rem]">{repo}</span>
                      <span className="shrink-0">
                        ★ {stars} · ⑂ {forks}
                      </span>
                    </div>
                  </a>
                ))}
              </div>
            </Specimen>
          </div>
        </Section>

        <Section
          id="hover"
          index="06"
          eyebrow="Interaction"
          title="卡片悬停：双描边柔光 07"
          lead="卡片：1px 三色 conic 外圈随指针旋转、1px 内描边、跟随指针的柔光、上浮 2px。标签沿用同一套外圈语言，只是放慢成自转并加了两颗星点（见 05 的 chip 标本）。左右分别是 Light 与 .dark 作用域下的同一个组件。"
        >
          <HoverPlayground />

          <div className="mt-6 grid grid-cols-1 gap-5 md:grid-cols-2">
            <div className="card p-5">
              <p className="section-label">结构与实现</p>
              <ul className="mt-3 space-y-2 text-sm leading-6 text-muted">
                <li>
                  <span className="font-mono text-xs text-foreground">::before</span> 外圈：conic-gradient 三色，用
                  <span className="font-mono text-xs text-foreground"> mask-composite: exclude </span>
                  裁成 1px 边框；<span className="font-mono text-xs text-foreground">from = --spot-ang + 90deg</span>
                  ，指针方向为扇区起点。
                </li>
                <li>
                  <span className="font-mono text-xs text-foreground">::after</span> 柔光：两层同心径向渐变，圆心
                  = <span className="font-mono text-xs text-foreground">--spot-x / --spot-y</span>，140ms 缓动。
                </li>
                <li>
                  内描边：hover 的 box-shadow 里的一层 inset，与中性描边叠成“双描边”。
                </li>
                <li>卡片只上浮 2px；标题颜色不变，文字永远在上层，不被染色。</li>
              </ul>
              <p className="mt-3 font-mono text-[0.7rem] leading-5 text-faint">{HOVER_SNIPPET}</p>
            </div>

            <div className="card p-5">
              <p className="section-label">实测（生产 CSS）</p>
              <dl className="mt-3 space-y-2 text-sm text-muted">
                <div className="flex items-baseline justify-between gap-3">
                  <dt>Light hover 平均亮度 L</dt>
                  <dd className="font-mono text-xs text-foreground">0.967（静止 0.999）</dd>
                </div>
                <div className="flex items-baseline justify-between gap-3">
                  <dt>Light 峰值色度 C</dt>
                  <dd className="font-mono text-xs text-foreground">0.090</dd>
                </div>
                <div className="flex items-baseline justify-between gap-3">
                  <dt>Dark hover 平均亮度 L</dt>
                  <dd className="font-mono text-xs text-foreground">0.275（静止 0.241，+0.034）</dd>
                </div>
                <div className="flex items-baseline justify-between gap-3">
                  <dt>标题颜色</dt>
                  <dd className="font-mono text-xs text-foreground">hover 前后一致</dd>
                </div>
              </dl>
              <p className="mt-3 text-xs leading-5 text-faint">
                hover 只在 <span className="font-mono">(hover: hover) and (pointer: fine)</span> 下启用；
                外圈颜色由 --glow-sky / --glow-lav / --glow-pink 三个 RGB 三元组驱动。
              </p>
            </div>
          </div>
        </Section>

        <Section
          id="rules"
          index="07"
          eyebrow="Rules"
          title="规范与维护"
          lead="这些规则保证新页面落在同一套系统里；其中几条是历史 bug 的结论，不要“简化”掉。"
        >
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
            <div className="card p-5">
              <p className="section-label">必须</p>
              <ul className="mt-3 space-y-2 text-sm leading-6 text-muted">
                <li>颜色一律引用语义 token，组件里不出现 hex / rgb 字面量。</li>
                <li>新文字色必须先在本页确认对比度 ≥ 4.5:1（大字 3:1）。</li>
                <li>优先复用 .btn / .card / .chip / .nav-item / .input / .eyebrow / .section-label / .link。</li>
                <li>圆角、时长、缓动使用 token；新值先加 token 再用。</li>
                <li>hover 与指针交互包在 (hover: hover) and (pointer: fine) 内。</li>
                <li>装饰动效用纯 CSS；reduced-motion 沿用全局降级。</li>
                <li>新组件先在本页加一个 specimen，再进真实页面。</li>
              </ul>
            </div>
            <div className="card p-5">
              <p className="section-label">禁止</p>
              <ul className="mt-3 space-y-2 text-sm leading-6 text-muted">
                <li>不新增动画库；不引入 webfont（0 请求是基线）。</li>
                <li>pastel / 渐变只做描边、填充与光标光，不承载正文。</li>
                <li>不给卡片子元素加 position: relative —— 会缩小整卡点击区。</li>
                <li>不手写 -webkit-backdrop-filter（Lightning CSS 会丢掉标准属性）。</li>
                <li>不改 hover 装饰层而不重测：Light ≥ 0.95 L，Dark ≤ +0.04 L。</li>
                <li>不在预渲染期读时钟 / 随机数（cacheComponents 会直接失败）。</li>
              </ul>
            </div>
          </div>

          <div className="mt-5 card p-5">
            <p className="section-label">维护方式</p>
            <div className="mt-3 grid gap-5 text-sm leading-6 text-muted md:grid-cols-2">
              <div>
                <p>
                  <span className="font-mono text-xs text-foreground">src/app/globals.css</span> —— 唯一的 token
                  与组件类来源（本页从它的 :root / .dark 规则里取值）。
                </p>
                <p className="mt-2">
                  <span className="font-mono text-xs text-foreground">src/lib/css-probe.js</span> ——
                  运行时读取器：CSSOM 建立双主题作用域 + getComputedStyle 解析 var()。
                </p>
                <p className="mt-2">
                  <span className="font-mono text-xs text-foreground">src/components/ui-standard/*.js</span> ——
                  各分区的预览组件；<span className="font-mono text-xs text-foreground">src/app/ui/page.js</span>{" "}
                  是这一页。
                </p>
              </div>
              <div>
                <p>新增 token 的三步：</p>
                <ol className="mt-1.5 list-decimal space-y-1 pl-5">
                  <li>在 globals.css 的 :root（与 .dark）里定义。</li>
                  <li>在本页对应分区的 GROUPS 里加一行（只写 token 名与用途）。</li>
                  <li>跑 yarn build + yarn lint；不需要改任何数值。</li>
                </ol>
                <p className="mt-3 text-xs leading-5 text-faint">
                  本页故意不写死任何颜色或尺寸：只要 token 还在，预览就是对的；token 被删掉，对应行会显示“读取中…”，
                  这也是一次免费的回归检查。
                </p>
              </div>
            </div>
          </div>

          <p className="mt-6 text-xs leading-5 text-faint">
            页面路径 /ui · 与线上 CSS 同源 · 变更随 globals.css 自动生效。最后同步：悬停系统 07 上线时。
          </p>
        </Section>
      </PageTransition>
    </RouteTransition>
  );
}
