# Cloudflare 缓存 / CDN 配置审计（prologue.dev）

> 只读审计报告。审计过程没有修改任何线上设置、没有部署、没有执行缓存 purge、没有改动应用代码；本文件是本次任务唯一的文件产出（`docs/CLOUDFLARE-AUDIT.md`）。
> 报告不含任何凭证；文中命令使用环境变量占位（`$CLOUDFLARE_API_KEY` / `$CF_EMAIL` / `$ZONE`）。

| 项目 | 值 |
| --- | --- |
| 审计对象 | zone `prologue.dev`（zone id `0bf0102de76cab34ef6089be6d6dc95a`） |
| 套餐 / 状态 | Free Website，active，paused=false，development_mode=off |
| 生产形态 | Next.js 16 全静态 export（`output: "export"`）→ assets-only Worker（`prologue-blog`，无 Worker 业务代码、无源站） |
| 审计时间 | 2026-11-26 17:45–18:15（Asia/Shanghai，UTC 09:45–10:15） |
| 审计手段 | Cloudflare API v4 只读 GET（约 60 个端点，`per_page` 上限 50 已遵守）；生产 HTTPS 探针（Node fetch / curl 8.23 / Node http2）；Cloudflare 官方文档与仓库内 `docs/DEPLOY-CLOUDFLARE.md`、`scripts/build-cf-assets.mjs` 对照 |
| 审计时线上版本 | Worker version 29，部署于 2026-11-26T08:15:37Z；Custom Domains：`prologue.dev`、`www.prologue.dev`（workers_dev=false） |
| 边缘节点 | 实测 `cf-ray` 后缀 `-SIN`（新加坡） |
| 已知限制 | 本机 `curl.exe 8.23`（Windows Schannel）不含 HTTP/2 特性 → 103 用 Node `http2`（ALPN=h2）验证；HTTP/3 未实测（只验证 `alt-svc: h3` 通告）。工作区 `out/` 在审计期间被重建（10:02Z，CSS hash `0hzb87ex…`），与线上部署（`0wrpi12jdl6k-.css`）不同 —— 本报告的缓存头结论以**线上实际响应**为准，`_headers` 规则以生成脚本 + 线上 Link 头对齐验证。 |

---

## 1. 结论摘要

**总评：符合"纯静态 Next.js export + Workers Static Assets"的最佳实践，缓存正确性不需要任何线上改动。**

- 缓存策略的唯一权威是 `out/_headers`（20 条规则，由 `scripts/build-cf-assets.mjs` 生成、由 `scripts/verify-export.mjs` 在 CI 中校验）；线上实测头与 `_headers` 逐条一致，没有发现 Cache Rules / Page Rules 之类的第二套缓存策略。
- 五类内容策略正确且已实证：

  | 内容 | 策略 | 实测 |
  | --- | --- | --- |
  | HTML（扩展名无关的干净 URL） | 浏览器 `max-age=0, must-revalidate`；边缘 `s-maxage=31536000`（靠部署/purge 失效） | `CF-Cache-Status: HIT`，重复请求稳定 HIT |
  | RSC `*.txt` | 浏览器 `max-age=60`；边缘 `s-maxage=31536000` | HIT，`ETag` 存在，条件请求 304 |
  | feeds / sitemap / robots / llms / search-index / version.json / sw.js | 浏览器与边缘均 must-revalidate | HIT 且逐字段匹配 `_headers` |
  | `/_next/static/*`、`/static/{opt,variants,source}/*`、`/og/*` | `max-age=31536000, immutable` | HIT，带 ETag |
  | `/static/*`（未哈希文件） | `max-age=604800, stale-while-revalidate=2592000` | 符合 |

- **Early Hints 实测有效**：HTTP/2 下 HTML 200 响应前稳定收到 `103`，`Link` 指向构建产物的共享 CSS（`/_next/static/chunks/0wrpi12jdl6k-.css`），与 `_headers` 的 `Link` 一致。
- **无风险性配置**：没有 Cache Rules、没有 Page Rules；Free 计划下 Cache Reserve 不可用且零收益；无源站使 Argo/Tiered Cache/Always Online 等 origin 相关项天然无作用。
- **最大风险 / 收益（按优先级）**：

  1. **P1 · Hotlink Protection 开启，会 403 掉带第三方 Referer 的 PNG**。实测 `Referer: https://feedly.com/` → `/static/favicons/avatar.png`、`/static/images/*.png`、`/og/*.png` 全部返回 Cloudflare 403 拦截页；AVIF/WebP 不受影响（Hotlink Protection 只支持 gif/ico/jpg/jpeg/png 扩展名）。RSS 全文里同时含 PNG（avatar、截图、OG 卡片），Feedly 之类会带 Referer 的阅读器/外链会掉图。**建议关闭（或为 `/static/`、`/og/` 增加例外）。**
  2. **P2 · Cloudflare 注入脚本（WebMCP + Precursor）**：每个 HTML 文档额外注入 `138 B` 的 `/.webmcp/bridge.js` 标签 + `642 B` 内联 Precursor 引导脚本；运行时再拉 `75,756 B`（br 20,828 B）的 WebMCP bridge 与 `61,279 B`（br 21,949 B）的 Precursor 脚本。后者响应头为 `private, no-store, no-cache` → **每次文档加载都重新下载**；前者虽带 ETag 但实测 `If-None-Match` 仍返回 200（无 304），也基本等于每次重下。合计约 **+43 KB 压缩 / +137 KB 原始 JS 每次文档加载**，且与站点功能无关（仓库源码零引用）。用户此前已决定暂保留；本报告给出量化影响与关闭路径。
  3. **P2 · Atom 与 JSON feed 未压缩**。Cloudflare 默认压缩 MIME 白名单包含 `application/rss+xml`，但**不含** `application/atom+xml` 与 `application/feed+json` → `/atomfeed` 958,712 B、`/jsonfeed` 952,316 B 以 identity 传输（RSS 为 br 371,461 B）。可用 Compression Rule（全套餐可用）修正；属可选项，不影响正确性。

- **低优先级问题**：HSTS `preload` 标记与 `max-age=15552000`（180 天）不满足预加载列表要求的 1 年；charset Response Header Transform 规则仍包含已下线主机 `cf.prologue.dev`（现 NXDOMAIN）；DNS 存在遗留记录 `x.prologue.dev`（A/AAAA，未代理）与 `prologue-blog-demo.prologue.dev`（CNAME → Vercel，未代理）；HTML 响应没有 ETag/Last-Modified（可接受，见 §3.4）；`_headers` 的 `Link` 头会附加到所有响应（约 63 B/响应，可接受）。
- **文档层面**：仓库 `docs/DEPLOY-CLOUDFLARE.md` / `CLAUDE.md` 中"托管 robots 仍开启、会前置 3,153 字节块"与"purge 是新部署可见的唯一条件"两处描述与本次实测/官方文档不完全一致（详见 §6.5），建议后续文档任务更新；本任务按约束未改其他文件。

**一句话行动建议**：先关 Hotlink Protection（P1）；是否关闭 WebMCP/Precursor、是否为两个 feed 加 Compression Rule 由用户决定（P2）；其余保持现状，无需碰缓存核心配置。

---

## 2. 设置与规则矩阵

优先级说明：**P0** 阻断/必须立即修；**P1** 应当修；**P2** 可选优化；**P3** 观察 / 文档 / 低收益。"推荐"栏中"保持"表示当前值与最佳实践一致。

### 2.1 缓存 / CDN 设置

| 项 | 当前值 | 推荐 | 理由 / 文档依据 | 建议操作 | 风险 | 优先级 |
| --- | --- | --- | --- | --- | --- | --- |
| `cache_level` | `basic`（API 值；Dashboard 显示 "No Query String"，2026-11-24 修改） | 保持 | Worker 静态资产由版本化资产缓存提供；Workers Cache 文档明确 Cache Rules、Page Rules、cache level、默认缓存扩展名等 zone 级缓存配置**对 Worker 缓存无效**。实测带唯一 query 的 `/`、`/rss`、`/index.txt`、CSS、`/og`、`/static` 请求全部 `CF-Cache-Status: HIT`，说明资产缓存不看 query、也不受 "No Query String" 影响 | 无 | 无（误改也无收益） | P3 |
| `browser_cache_ttl` | `0` = Respect Existing Headers | **保持 0，不要改** | `_headers` 已给出精确浏览器策略；Cache-Control 文档：Cloudflare 取 "Browser Cache TTL" 与 `max-age` 的较大值，0 时不覆盖 | 无 | 改成非 0 会把 HTML/RSC 浏览器 TTL 抬高，破坏 HTML↔哈希 chunk 的版本一致性 | **P1（禁止改）** |
| `edge_cache_ttl` | `7200`（默认） | 保持 | 无源站；`_headers` 的 `s-maxage` 才是权威；该设置只影响 zone CDN 的默认 TTL | 无 | 无 | P3 |
| `development_mode` | `off` | 保持 off | 开启会绕过缓存并临时停用优化 | 无 | 线上缓存行为不可预测 | P2 |
| `always_online` | `on` | 保持（无作用） | Always Online 只对"源站不可达时返回缓存快照"有意义；本项目无源站 | 无 | 无 | P3 |
| `early_hints` | `on` | **保持 on** | 实测 103 生效（见 §4）；`_headers` 提供 `Link: …; rel=preload; as=style` | 无 | 关闭后失去 103 预加载收益 | P1（保持） |
| `prefetch_preload` | `off`（readonly） | 保持 | 与 Next 自带 prefetch 重复 | 无 | 无 | P2 |
| `rocket_loader` | `off` | **保持 off** | Rocket Loader 会破坏 Next hydration（仓库既有结论） | 无 | 开启会破坏交互 | P1（保持 off） |
| `speed_brain`（独立端点 `/settings/speed_brain`，不在 bulk settings 中） | `off` | **保持 off** | 与 Next prefetch 重复；历史上开启时 `/cdn-cgi/speculation` 返回站点 HTML | 无 | 重复预取/错误响应 | P2 |
| `minify` | css/html/js 全 `off` | 保持 | 构建期已压缩；二次 minify 可能破坏内联脚本、改变 CSS/JS 内容 | 无 | 构建产物被二次改写 | P2 |
| `brotli` | `on` | 保持 | 实测 HTML/CSS/JS/RSS/txt 均 br 压缩（`/` 96,669 B → 22,468 B；gzip 26,016 B） | 无 | 无 | P2 |
| `http2` / `http3` | `on` / `on` | 保持 | h2 实测 ALPN=h2；h3 由 `alt-svc: h3=":443"` 通告 | 无 | 无 | P2 |
| `0rtt` / `tls_1_3` | `on` / `zrt` | 保持 | 纯静态、只有 GET；0-RTT 重放对无副作用请求可接受 | 无 | 将来出现非幂等 API 时需重新评估 | P3 |
| `polish` / `webp` / `mirage` | 全 `off`（readonly，Free） | 保持 | 图片已在构建期生成 AVIF/WebP 多尺寸变体 | 无 | 开启会重复处理/破坏既有变体 | P3 |
| `sort_query_string_for_cache` | `off`（readonly） | 保持 | 静态站无需；且资产缓存本就不区分 query | 无 | 无 | P3 |
| `response_buffering` | `off`（readonly） | 保持 | 允许流式响应，无副作用 | 无 | 无 | P3 |
| Tiered Cache（`tiered_cache_smart_topology_enable` / `argo_tiered_caching`） | `on` / `on`（后者 readonly） | 保持（对 assets 无直接作用） | Tiered Cache 的目标是减少**回源**请求；本项目无源站。Static Assets 概览文档说明资产使用 Cloudflare 内置分级缓存，与 zone 的 Tiered Cache 设置无关 | 无 | 无 | P3 |
| Cache Reserve | **不可用**：`GET /cache/cache_reserve` → 403 `1135 "not available for your plan type"` | 不启用 | Cache Reserve 文档：需付费计划；本项目无源站，R2 持久层零收益 | 不操作 | 付费且无收益 | P2（不要买） |
| Argo Smart Routing | `GET /argo/smart_routing` → 401 未授权（未订阅） | 不启用 | Argo 优化的是 CF↔源站链路；无源站 | 不操作 | 付费且无收益 | P2（不要开） |
| Cache Rules（phase `http_request_cache_settings`） | **0 条** | **保持 0 条** | 资产缓存由 Worker 版本 + `_headers` 控制；新增 Cache Rules 会产生第二套、可与之冲突的缓存策略（`_headers` 文档明确重复 Cache-Control 指令会导致冲突） | 不新增 | 双重策略/冲突指令 | P1（保持为空） |
| Page Rules | **0 条** | 保持 0 条 | 同上；Page Rules 属 legacy | 不新增 | 无 | P2 |

### 2.2 安全 / TLS / 协议（与 CDN 行为相关的部分）

| 项 | 当前值 | 推荐 | 理由 / 文档依据 | 建议操作 | 风险 | 优先级 |
| --- | --- | --- | --- | --- | --- | --- |
| `security_level` | `essentially_off` | 保持（或按需 `low`） | 纯静态公开内容、无表单/无后端；且规则层面已对所有数据请求（`_rsc`/`.txt`/`_next`）做 skip。抬升安全等级会让可疑 IP 的 HTML 导航收到挑战 | 无（若出现爬虫滥用再评估 `low`） | 挑战误伤自动化客户端/读者 | P3 |
| `waf`（legacy 开关） | `off`；legacy WAF packages 为空；Cloudflare Managed Free Ruleset（44 条）**存在但未挂载**（phase entrypoint 404） | 保持 off | 静态站无动态攻击面；免费托管规则主要覆盖 WordPress/插件/CVE 探测，对静态资产价值低 | 无（不建议开） | 误伤爬虫/增加噪声 | P3 |
| `browser_check` | `off` | 保持 | Browser Integrity Check 对纯静态站价值低 | 无 | 无 | P3 |
| `hotlink_protection` | **`on`** | **改为 off**（或只为 `/static/`、`/og/` 开例外） | 实测：带第三方 Referer 的 `.png` 请求返回 Cloudflare 403 拦截页（`/static/favicons/avatar.png`、`/static/images/*.png`、`/og/*.png`）；Hotlink Protection 文档：仅支持 gif/ico/jpg/jpeg/png，且明确提到 RSS feed 场景需要例外（hotlink-ok 目录 / Configuration Rule）。站点 RSS 全文含 PNG | PATCH zone setting `hotlink_protection` → `{"value":"off"}`；或保留开关但用 Configuration Rule 豁免 `/static/`、`/og/` | 关闭后允许他人外链图片；本项目图片带宽在 Workers Static Assets 上免费且无限，实际风险低 | **P1** |
| `security_header`（HSTS） | enabled，`max_age=15552000`（180 天），`include_subdomains=true`，`preload=true`，`nosniff=true` | 若确有 preload 意图 → `max_age=31536000`；否则去掉 `preload` 标记 | hstspreload.org 要求 ≥1 年 + includeSubDomains + preload；当前 180 天不满足。另：`nosniff` 与 `_headers` 的 `X-Content-Type-Options` 重复但 Cloudflare 已去重（实测单个响应头） | PATCH `settings/security_header`（整对象提交） | HSTS 策略有粘性（改短不会立即解除已缓存策略） | P3 |
| `min_tls_version` | `1.3`（TLS 1.2 握手实测失败） | 保持 1.3，或按兼容性需求降为 `1.2` | TLS 1.3-only 会排除少数旧 Android/客户端；对中文读者群可考虑 1.2+1.3 | 可选 PATCH `settings/min_tls_version` = `1.2` | 1.2 仍安全；1.3-only 兼容面更窄 | P3 |
| `tls_1_2_only` / `ciphers` | `off` / `[]`（默认） | 保持 | 与 min TLS 1.3 一致 | 无 | 无 | P3 |
| `ssl` | `strict` | 保持 | 无源站，但方向正确 | 无 | 无 | P3 |
| `always_use_https` / `automatic_https_rewrites` | `on` / `on` | 保持 | 实测 `http://prologue.dev/` → 301 https | 无 | 无 | P2 |
| `ech` / `pq_keyex` / `ipv6` / `opportunistic_encryption` / `opportunistic_onion` | 全 `on` | 保持 | ECH、后量子密钥交换、IPv6、Tor 友好均为现代最佳实践 | 无 | 无 | P3 |
| `email_obfuscation` | `off` | **保持 off** | 开启会在 HTML 注入 `email-decode` 脚本（额外第三方 JS + 改写邮箱） | 无 | 注入脚本 | P3 |
| `replace_insecure_js` | `on` | 保持或可选 off | "Replace insecure JS" 只改写 `http://` 脚本引用；全站 HTTPS 静态产物下为 no-op | 可选 off（减少边缘改写路径） | 无 | P3 |
| `websockets` | `on` | 保持（无作用） | 无 WebSocket | 无 | 无 | P3 |
| bot_management | `fight_mode=false`、`enable_js=false`、`ai_bots_protection=disabled`、`content_bots_protection/crawler_protection/ai_training/ai_search/ai_user` 全 disabled、`is_robots_txt_managed=true`、`cf_robots_variant="off"` | 保持 | 实测 `/robots.txt`（477 B）与仓库 `out/robots.txt` **字节一致**（普通 UA / GPTBot / ClaudeBot 三种 UA 均相同）→ 托管 robots 实际**未**向站点 robots 追加内容；AI 爬虫策略由站点自身 robots.txt 承载 | 无 | 若未来要托管 AI 策略需在 Dashboard 开启并复核 | P3 |
| `challenge_ttl` | `1800` | 保持 | 默认值；当前安全等级下基本不触发挑战 | 无 | 无 | P3 |
| Managed headers（`add_security_headers` 等） | 全部 `disabled` | 保持 | `_headers` 已是安全头单一来源，避免 Cloudflare 托管头覆盖 | 无 | 无 | P3 |
| `advanced_ddos` | `on`（readonly） | 保持 | L7 DDoS 托管规则集（148 条）自动生效，是唯一实际启用的托管防护 | 无 | 无 | P3 |

### 2.3 Rulesets（规则集）逐条

> 读取方式：`GET /zones/$ZONE/rulesets` + 每个 ruleset 详情 + 每个 phase 的 entrypoint。共 9 个规则集。

| 规则集（id 前缀） | 名称 / 类型 / phase | 版本 | 规则 | 审计结论 | 建议 |
| --- | --- | --- | --- | --- | --- |
| `daf658f8` | default / zone / `http_response_headers_transform` | v4（2026-11-25） | 1 条 | **生效**：`html charset (static migration)`，action `rewrite`，对 `host ∈ {prologue.dev, www.prologue.dev, cf.prologue.dev}` 且路径不含 `.`、不以 `/static/`、`/og/`、`/cdn-cgi/` 开头、不是 4 个扩展名 feed 的请求，设置 `Content-Type: text/html; charset=utf-8`。这是 HTML 有 charset、而 `.html`/404 等路径无 charset 的原因 | 规则本身正确；建议把已下线（NXDOMAIN）的 `cf.prologue.dev` 从 host 集合移除（P3） |
| `120bc947` | default / zone / `http_request_firewall_custom` | v4（2026-11-24） | 1 条 | **生效**：`static export data requests: skip bot challenge`，action `skip`，products = [waf, securityLevel, hot, rateLimit, uaBlock, bic]，表达式 `(_rsc query) or ends_with(path,".txt") or starts_with(path,"/_next/")`。在安全等级全关的当下基本冗余，但为将来提高安全等级保留了数据请求豁免，设计合理 | 保持 |
| `14c02830` | default / zone / `http_request_dynamic_redirect` | v3（2026-11-24） | 1 条 | **生效**：`www -> apex (static migration)`，action `redirect`，301，`preserve_query_string=true`，`target = concat("https://prologue.dev", http.request.uri.path)`，条件 `http.host eq "www.prologue.dev"`。实测 `https://www.prologue.dev/blog?q=1` → 301 `https://prologue.dev/blog?q=1` | 保持 |
| `ad250502` | default / zone / `http_request_cache_settings` | v6（2026-11-24） | **0 条** | 即"没有 Cache Rules"，与设计一致（Fly 时代遗留规则已清理） | 保持为空 |
| `181ea761` | default / zone / `http_request_transform` | v2（2026-08-29） | 0 条 | 无请求头改写规则 | 保持 |
| `70339d97` | Cloudflare Normalization Ruleset / managed / `http_request_sanitize` | v6 | 4 条（1 条启用：URL path 规范化，不传源站） | 托管；对应 phase entrypoint 404 → 未通过 zone 规则集挂载 | 保持 |
| `b42644f5` | Cloudflare Managed Response Firewall Default / managed / `http_response_firewall_custom` | v2（2026-10-21） | 1 条（block 高置信签名） | 托管；phase entrypoint 404 → **未生效** | 保持 |
| `77454fe2` | Cloudflare Managed Free Ruleset / managed / `http_request_firewall_managed` | v89（2026-11-24） | 44 条（全部 enabled，Log4j/WordPress CVE 等） | 托管；phase entrypoint 404，legacy WAF packages 为空 → **当前未部署** | 保持（静态站价值低，不建议为此开启） |
| `4d21379b` | DDoS L7 ruleset / managed / `ddos_l7` | v3541（2026-11-25） | 148 条 | 自动启用（`advanced_ddos=on`），无需配置 | 保持 |

- 未发现 `http_request_redirect`（zone 级不允许，正确返回 400）、`http_request_origin`、`http_request_late_transform`、`http_ratelimit`、`http_response_compression`（无 Compression Rules）等其它 phase 的 zone 规则集。
- Page Rules：**0 条**。Cache Reserve / Bulk Redirects / Image Resizing 等无可用配置（计划限制或未使用）。

### 2.4 Workers / DNS / 其他

| 项 | 当前状态 | 推荐 / 结论 |
| --- | --- | --- |
| Worker | 1 个：`prologue-blog`，`has_assets: true`，无 bindings、无 main 代码，`compatibility_date` 2026-11-25；版本数 29，最新部署 100% → version 29（2026-11-26T08:15:37Z） | 正确（assets-only） |
| Workers Builds | `GET /accounts/…/builds/workers/prologue-blog` → 12040 "No build configuration"；builds 列表空；triggers 列表空 | 正确（已禁用，CI 单一入口是 GitHub Actions） |
| Worker routes / Custom Domains | `/zones/$ZONE/workers/routes` = []（Custom Domains 不显示在 routes）；Workers domains = `prologue.dev` + `www.prologue.dev`，均 enabled、previews_enabled=false | 正确 |
| workers.dev | `workers_dev=false`；实测 `prologue-blog.prologue.workers.dev` 不可达 | 正确（避免非生产入口） |
| DNS | 16 条记录：apex/www 各有 `AAAA 100:: → proxied`（Custom Domain 占位；实测 1.1.1.1 对 apex/www 返回 Cloudflare anycast A 104.21.48.158/172.67.154.82 与 AAAA 2606:4700:…，正常）；MX 3 条指向 Cloudflare Email Routing；TXT 含 SPF、DKIM、DMARC(p=reject)、域名验证 | 生产链路正确；**遗留**：`x.prologue.dev`（A 168.107.79.197 / AAAA 2603:c024:…，未代理）与 `prologue-blog-demo.prologue.dev`（CNAME → `cname-china.vercel-dns.com`，未代理）疑似旧 Fly/Vercel 演示残留，建议确认后删除（P3）。`cf.prologue.dev` → NXDOMAIN |
| DNSSEC | active（算法 13，DS 已配置） | 保持（良好实践） |
| Precursor | `GET /zones/$ZONE/precursor` = `{"default_mode":"min-friction","enforcement_rules":[]}` | 见 §5；可 Dashboard 关闭（P2，用户已决定暂保留） |
| WebMCP | 非 zone setting（`GET /settings/webmcp` → 1003 "Undefined zone setting"）；HTML 中被注入 `/.webmcp/bridge.js` | 见 §5；Dashboard → Browser Run → Agent Readiness 关闭（P2，用户已决定暂保留） |
| `_headers` 规则数 | 20 条（Workers 上限 100；单行 < 2,000 字符） | 合规；CI 的 `scripts/verify-export.mjs` 也在校验规则数/顺序/detach 纪律 |
| 部署后失效 | `.github/workflows/deploy-cloudflare.yml` 在 `wrangler deploy` 之后执行 `POST /purge_cache {"purge_everything":true}`，失败则 job 失败 | 建议保持（见 §3.5 的说明） |

---

## 3. 缓存头与路由验证结果

### 3.1 方法

- HTTP/1.1：Node `fetch`（undici）+ `curl.exe 8.23`（Windows），浏览器 UA，`Accept-Encoding: br/gzip/identity` 分别测试。
- HTTP/2：Node `http2` 直连（ALPN 协商 h2），用于 103 Early Hints 观测。
- 判定依据：`Cache-Control`、`CF-Cache-Status`、`Content-Type`、`Content-Encoding`、`ETag`、`Last-Modified`、`Link`、`Vary`、`Strict-Transport-Security`、`alt-svc`、`NEL` 等；并把线上值与 `out/_headers`（生成器 `scripts/build-cf-assets.mjs`）逐条比对。
- 重复请求均确认 `HIT`（见各行）；带唯一 query 的请求也做了一次，用于判断资产缓存是否区分 query。

### 3.2 线上响应矩阵（2026-11-26 实测）

> 说明：`CF-Cache-Status` 由 Workers Static Assets 的资产缓存给出；HTML 行均**不带** ETag/Last-Modified（见 §3.4）。

| 内容类型 | 示例路径 | 状态 | Cache-Control | CF-Cache-Status | Content-Type | 其他 |
| --- | --- | --- | --- | --- | --- | --- |
| HTML 首页 | `/` | 200 | `public, max-age=0, s-maxage=31536000, must-revalidate` | HIT | `text/html; charset=utf-8` | br 22,468 B（原始 96,669 B）；`Link` preload CSS；HSTS、nosniff、CSP frame-ancestors、Referrer-Policy、Permissions-Policy、X-Frame-Options；无 ETag/Last-Modified；无 Vary |
| HTML 归档 | `/blog`、`/blog/` | 200 | 同上 | HIT | 同上 | 原始 101,138 B |
| HTML 文章 | `/blog/2022-review-changes-and-alterations` | 200 | 同上 | HIT（首次为 MISS） | 同上 | 原始 74,441 B |
| HTML 标签 | `/tags/Economics` | 200 | 同上 | HIT | 同上 | 原始 74,995 B |
| HTML 长页 | `/about`、`/ui` | 200 | 同上 | HIT（`/ui` 首次 MISS） | 同上 | 原始 56,877 B |
| HTML 404 | `/this-path-does-not-exist-t6` | **404** | 同上 | HIT | 同上 | 原始 29,173 B；站点 404 页；`/mcp`（404）同样 |
| RSC payload | `/index.txt`、`/blog/2022-…-.txt` | 200 | `public, max-age=60, s-maxage=31536000` | HIT | `text/plain; charset=utf-8` | ETag W/"…"；br 16,744 / 46,714 B；`If-None-Match` → 304；重复 HIT；`?_rsc=…` 仍匹配 |
| RSC 子树 payload | `/blog/2022-…/__next._tree.txt` | 200 | 同 RSC | HIT | 同上 | 321 B |
| RSS | `/rss` | 200 | `public, max-age=0, must-revalidate` | HIT | `application/rss+xml; charset=utf-8` | br 371,461 B（原始 940,958 B）；ETag；304 |
| Atom | `/atomfeed` | 200 | 同上 | HIT | `application/atom+xml; charset=utf-8` | **未压缩** 958,712 B（见 §3.4）；strong ETag；304 |
| JSON Feed | `/jsonfeed` | 200 | 同上 | HIT | `application/feed+json; charset=utf-8` | **未压缩** 952,316 B；strong ETag；304 |
| 微博 RSS | `/microblog/rss` | 200 | 同上 | HIT | `application/rss+xml; charset=utf-8` | br 6,156 B（原始 29,876 B） |
| sitemap | `/sitemap.xml` | 200 | 同上 | HIT | `application/xml; charset=utf-8` | br |
| robots | `/robots.txt` | 200 | 同上 | HIT | `text/plain; charset=utf-8` | br；477 B，与 `out/robots.txt` 字节一致 |
| llms | `/llms.txt`、`/llms-full.txt` | 200 | 同上 | HIT | `text/plain; charset=utf-8` | br（llms-full 811,495 B → 355,096 B） |
| 搜索索引 | `/search-index.json`、`/search-index-lite.json` | 200 | 同上 | HIT | `application/json; charset=utf-8` | br |
| 版本号 | `/version.json` | 200 | 同上 | HIT | `application/json; charset=utf-8` | 68 B；ETag；`If-None-Match` → 304 |
| Service Worker | `/sw.js`、`/sw-manifest.json` | 200 | 同上 | HIT | `text/javascript` / `application/json; charset=utf-8` | br |
| 哈希 CSS | `/_next/static/chunks/0wrpi12jdl6k-.css` | 200 | `public, max-age=31536000, immutable` | HIT | `text/css` | br 17,511 B（原始 91,935 B）；ETag；304 |
| 哈希 JS | `/_next/static/chunks/1k2w3nq2-wg_-.js` | 200 | 同上 | HIT | `text/javascript` | br；ETag |
| 图片变体 | `/static/variants/08a93194bff8-64.avif` | 200 | `public, max-age=31536000, immutable` | MISS→HIT | `image/avif` | 1,341 B；ETag；WebP 变体同 |
| 未哈希静态 | `/static/favicons/cover.png`、`/static/favicons/avatar.png` | 200 | `public, max-age=604800, stale-while-revalidate=2592000` | MISS→HIT | `image/png` | ETag；avatar 871,775 B |
| OG 卡片 | `/og/default.png?v=5`、`/og/post-….png?v=5` | 200 | `public, max-age=31536000, immutable` | HIT | `image/png` | 115,232 B / 130,947 B；ETag；304 |
| favicon | `/favicon.ico` | 200 | `public, max-age=0, s-maxage=31536000, must-revalidate`（`/*` 基线规则） | HIT | `image/vnd.microsoft.icon` | ETag；浏览器每次 revalidate（可接受） |
| 缺失静态资源 | `/static/missing-t6.png` | **404** | `max-age=604800, stale-while-revalidate=2592000`（被 `/static/*` 命中） | HIT | `text/html` | **404 继承长 TTL**（见 §3.4） |
| 缺失哈希资源 | `/_next/static/chunks/missing-t6.js`、`/static/opt/missing-t6.avif` | **404** | `max-age=31536000, immutable`（被 immutable 规则命中） | HIT | `text/html` | 同上，见 §3.4 |
| 点号路径 404 | `/apple-touch-icon.png`、`/icon.svg` | **404** | `public, max-age=0, s-maxage=31536000, must-revalidate` | HIT | `text/html`（**无 charset**，因 charset 规则排除含 `.` 路径） | 404 页自带 `<meta charset>`，不影响显示 |
| www→apex | `https://www.prologue.dev/` | **301** | 无 | 无 | `text/html; charset=utf-8` | `Location: https://prologue.dev/`；`/blog?q=1` 保留 query；无 `Link` 头（规则生成，非资产） |
| http→https | `http://prologue.dev/` | **301** | 无 | 无 | — | `Location: https://prologue.dev/`（Always Use HTTPS） |
| .html / 尾斜杠规范化 | `/about.html`、`/index.html`、`/blog/index.html` | **307** | `public, max-age=0, s-maxage=31536000, must-revalidate`（`/*` 命中） | 无 | — | 分别 → `/about`、`/`、`/blog`；307 未被缓存（无 CF-Cache-Status） |

**与 `_headers` 的一致性结论：全部一致。** 逐条核对的结果：

- `/*` 基线（安全头 + HTML/RSC 基础 Cache-Control + `Link`）在纯 HTML/404/307 上完全匹配；
- `/*.txt` 的 `Content-Type: text/plain; charset=utf-8` 与 `Cache-Control: public, max-age=60, s-maxage=31536000` 生效（未出现 `max-age=0` 与 `max-age=60` 被逗号拼接的冲突，说明 `! Cache-Control` detach 顺序正确）；
- 四个 feed、`sitemap.xml`、`robots.txt`、`llms*.txt`、`search-index*.json`、`version.json`、`sw.js`/`sw-manifest.json` 的 MIME 与 must-revalidate 全部按规则生效；
- `/_next/static/*`、`/static/{opt,variants,source}/*`、`/og/*` 为 `max-age=31536000, immutable`；
- `/static/*` 为 `7d + SWR`；
- 规则总数 20（< 100 上限），行宽 < 2,000 字符；`scripts/verify-export.mjs` 在 CI 中校验顺序、detach 与关键指令（含 `_headers` 第一条必须是 `/*`、每条窄规则必须先 `! Cache-Control` 等）。

### 3.3 缓存命中与失效行为（实测）

- **重复请求**：HTML（`/`、`/blog`、`/tags/Economics`、`/about`、`/ui`、404）、RSC（`/index.txt`、post `.txt`）、CSS/JS、OG、feeds、`version.json`、`sw.js`、静态图片：第二次请求全部 `CF-Cache-Status: HIT`。冷资源（首次请求的 `/blog/2022-…`、未命中过的 avif/webp 变体、`/static/favicons/cover.png`）首次 MISS、随后 HIT。
- **条件请求**：`/index.txt`、`/version.json`、`/rss`、`/atomfeed`、CSS、`/og/default.png?v=5` 的 `If-None-Match` 均返回 **304**；HTML 无 ETag/Last-Modified，带任意 `If-None-Match` 或 `If-Modified-Since` 仍返回 200（完整重下）。
- **query string 不参与资产缓存键**：对 `/`、`/rss`、`/index.txt`、CSS、`/og/default.png?v=5`、`/static/favicons/cover.png`、`/blog`、`/about` 各加唯一 query 参数请求，均返回 `CF-Cache-Status: HIT`。含义：
  - **不能**用 `?cb=…` 绕过 Cloudflare 资产缓存来验证新部署；
  - `/og/*.png?v=5` 的 `v` 只对**外部**缓存（Twitter/Facebook/搜索引擎）有意义，CF 资产缓存忽略 query；OG 卡片变更仍依赖部署（新文件 → 新资产版本）与 purge。
- **Range**：Workers Static Assets 文档明确：带 `Range` 的请求仍返回 **200 全量**、没有 `Content-Range`/`Accept-Ranges`（实测 CSS `Range: bytes=0-99` → 200 + 91,935 B）。对 CSS/JS 无影响；若未来加视频/音频需要 range，则须把路径交给 Worker（`run_worker_first`）自行返回 206 —— 本静态站当前无此需求。

### 3.4 偏差 / 非理想项（均不影响正确性）

1. **HTML 响应没有 ETag / Last-Modified**：HTML（含 `.html` 直出 404 页）不返 `ETag`，而 `.txt`/CSS/JS/图片/feeds/OG 都有 ETag 并可 304。结果是 HTML 的浏览器缓存是"`max-age=0` + 无验证器" → 每次重新打开文档都要完整重下（首页 br 22,468 B）。影响可控：HTML 本身很小、站点用 SW 运行时缓存导航、站内导航走 RSC/SPA 不重载 HTML。**不建议**用 `_headers` 加一个固定 ETag（所有 HTML 共用同一 ETag 会导致错误的 304），也无需为此引入 Worker 代码。
2. **没有 `Vary` 头**（HTML、CSS、feeds 均无）。Cloudflare 自己在边缘按 `Accept-Encoding` 处理编码变体，实测 br/gzip/identity 三种请求都得到正确内容；浏览器缓存是私有的，不构成共享缓存串味问题。属观察项，无需处理。
3. **Atom / JSON Feed 未压缩**：`application/atom+xml`、`application/feed+json` 不在 Cloudflare 默认压缩 MIME 白名单（白名单含 `application/rss+xml`、`text/xml`、`application/xml`、`application/json` 等，但**不含**这两种）。实测即使请求头带 `Accept-Encoding: br` 也返回 identity：Atom 958,712 B、JSON Feed 952,316 B（RSS 为 br 371,461 B）。可用 **Compression Rule**（全套餐可用，Free 10 条）修正（见 §6.2），但属优化、非正确性问题。
4. **404 继承通配规则的 TTL**：由于 `_headers` 是按路径匹配的，不存在的 `/static/**` 文件会以 404 状态继承 `7d+SWR`（`/static/{opt,variants,source}/**` 与 `/_next/static/**` 甚至继承 `immutable 1 年`）。这意味着：
   - 被删除/拼错的静态路径可能被浏览器缓存 404（`/static/` 7 天、哈希路径 1 年）；
   - 页面 404（扩展名路径）则是 `max-age=0` + S-maxage 1 年，浏览器每次 revalidate，无此问题。
   哈希路径的 404 不会"重新出现"；`/static/` 下非哈希文件的 404 缓存 7 天是唯一略有感知的场景。属可接受的小瑕疵（`_headers` 没有状态码维度的匹配能力，无法优雅区分 404）。
5. **`Link` 头出现在所有响应上**（包括 feed、`.txt`、CSS、JS、图片，约 63 B/响应），因为 `_headers` 只有 `/*` 这一条能覆盖"所有扩展名无关的 HTML"。Early Hints 只对合格 HTML 生效，所以非 HTML 上的 `Link` 无副作用；只是轻微冗余。`_headers` 支持 splat/placeholder 但不支持"排除扩展名"，要收窄就得逐个路由列规则、收益极低，**不建议动**。
6. **307 重定向响应带 `/*` 的 Cache-Control（`s-maxage=31536000`）但没有 `CF-Cache-Status`**：说明 307 没被资产缓存保存（每次现算），可接受；`.html`/尾斜杠请求本来就不该是热路径。
7. **HTML 的 charset 来自 zone Response Header Transform（ruleset），不是 `_headers`**：因为 Workers Assets 对"扩展名无关 HTML"默认只发 `text/html`、不带 charset；规则为所有干净 URL 补 `charset=utf-8`。该规则排除含 `.` 的路径，因此 `.html`/点号路径 404 响应没有 charset 头（页面自身 `<meta charset>` 兜底，浏览器显示正常）。这是合理折中，无需改。
8. **`cache_level` 是 API `basic`（Dashboard "No Query String"）**：由于 Worker 资产缓存不理会 zone 缓存级别（见 §2.1），对当前架构无影响；若将来有非 Worker 的 proxied 记录依赖 zone CDN，再评估是否改回 Standard。

### 3.5 边缘缓存与失效路径（重要说明）

- Static Assets 概览文档：Cloudflare 会自动缓存静态资产，`CF-Cache-Status` 表示资产是否由缓存提供；资产由 **Worker version 的 asset manifest** 管辖 —— 版本 B 中不存在的文件即使缓存过也按 missing asset 处理（`version-skew` 文档）。这解释了仓库里"Worker 资产版本就是缓存身份"的说法。
- 但 **`_headers` 的长 `s-maxage` 仍然是 HTML/RSC 的失效压力来源**：资产缓存对同一版本内的响应有 TTL；如果某个缓存层尊重 `s-maxage=31536000`，那么新部署后要靠 purge 才能立即看到新 HTML。两种情况在外部无法完全区分（我们观察到的只是 HIT 与当前内容），所以：
  - **部署后的 `purge_everything` 步骤建议保留**：它同时覆盖 Early Hints 的 URI 级缓存（若不清，可能对新版本发出旧 CSS 的 103 预加载）、任何 zone 级缓存条目与遗留问题；出错即失败（fail fast）也是好实践。
  - Workers Cache 文档另有一句"zone 级 purge 不影响 Workers Cache 内容"——那是指 Worker 代码用 `ctx.cache` 写入的 **Workers Cache**；Workers Static Assets 的资产缓存与它不是一个东西，不要把该句当成"purge 无效"的依据。**结论：保留现有 purge 步骤，不做改动。**
- 不启用 Cache Reserve / Tiered Cache / Argo：无源站、无收益，详见 §7。

---

## 4. Early Hints 实际验证

### 4.1 验证方法

本机 `curl.exe` 8.23（Windows Schannel）编译不含 HTTP/2 特性（`curl -V` Features 无 HTTP2），而 Early Hints 的 103 只在 HTTP/2/HTTP/3 上发送（官方文档明确），因此改用 **Node.js `http2` 客户端**（ALPN 协商得到 `h2`）直连 `https://prologue.dev/`，监听 `HEADERS` 流事件。

### 4.2 实测结果

- **103 确实发送**，形如：

  ```
  103 HEADERS: {":status":103, "link":"</_next/static/chunks/0wrpi12jdl6k-.css>; as=style; rel=preload"}
  ```
  随后是 200，`Link` 头为 `</_next/static/chunks/0wrpi12jdl6k-.css>; rel=preload; as=style`（参数顺序不同，语义相同）。
- 103 的 `Link` 指向的 CSS 与 HTML 中 `<link rel="stylesheet">` 的实际文件一致（同一构建产物），说明 `_headers` 生成的 `Link` 被 Early Hints 正确采用。
- 覆盖页面：`/`、`/blog`、`/about`、`/tags/Economics`、`/ui`、`/links`、文章页、带 query 的 HTML 变体 —— 均收到 103（首次请求 MISS 的情况除外）。
- **不发 103 的情况（与文档规则一致）**：

  | 场景 | 结果 | 依据 |
  | --- | --- | --- |
  | 资产缓存 MISS（首次访问某 URL） | 无 103，直接 200 | Early Hints 从缓存取 103；"若主响应头已可用则不发" |
  | 404 HTML（`/this-404-page`） | 无 103 | 文档：仅 200/301/302 |
  | `/about.html`、`/index.html` 等 307 重定向 | 无 103 | 307 不在 200/301/302 范围 |
  | `https://www.prologue.dev/` 的 301 | 无 103 | 该 301 由 zone Redirect Rule 生成，响应**没有** `Link` 头（只有资产响应才有 `_headers` 的 Link），因此不满足"响应含 preload Link" |
  | 非 HTML（`/rss`、`/index.txt`） | 无 103 | 仅 HTML/无扩展名 URI 会生成 |
  | 带 query 的 HTML | 有 103 | Early Hints 缓存键按 URI、忽略 query（文档明确；实测 `/?x=1`、文章 `?x=1` 均有） |

### 4.3 价值与限制评估

- 收益：在 200 响应到达前约 1 RTT 让浏览器开始预加载共享 CSS（91,935 B 原始 / 17,511 B br）。对 Cloudflare 边缘（本机观察为 SIN）到读者的高延迟链路有实际帮助；对已缓存 HTML 的重复访问收益最小（本来也就 1 个 RTT）。
- 限制：① 仅 h2/h3（本机 curl 无法验证 h2，已用 Node 补充；h3 未实测）；② 仅缓存命中后可用 —— 每次部署 purge 后每个 URI 的首次访问没有 103；③ 仅 200/301/302 且响应含 preload/preconnect Link 才生成；④ 103 里的 Link 参数顺序与 200 头不同（`as=style; rel=preload`），语义一致；⑤ 浏览器支持有限（Chrome M94+ 生效，Firefox/Safari 忽略，无副作用）；⑥ 文档提示启用了认证的站点可能对未认证访问发 103 —— 本站无认证，不涉及。
- 结论：**Early Hints 配置正确、实测生效、保持开启**。

---

## 5. Cloudflare 注入脚本：WebMCP / Precursor

### 5.1 注入内容与体积（实测）

| 注入物 | 形式 | 原始大小 | 压缩后 | 缓存行为 | 每页出现 |
| --- | --- | --- | --- | --- | --- |
| WebMCP bridge 标签 | `<script type="module" async fetchpriority="low" src="https://prologue.dev/.webmcp/bridge.js" data-packs="c2pa,mcp-server-client">`，注入到 `<head>` 最前 | 138 B（标签本身） | — | — | 所有 HTML（含 404） |
| `/.webmcp/bridge.js` | 由 Cloudflare 边缘提供，不在 `out/` 资产里 | 75,756 B | br 20,828 B | `public, max-age=0, must-revalidate`、`CF-Cache-Status: HIT`、强 ETag；但 `If-None-Match` 实测仍 200（无 304） | 每次文档加载重新下载 |
| Precursor 引导内联脚本 | `window.__CF$cv$params={r:'<cf-ray>',…}` + 动态 `document.createElement('script')` 注入 `/cdn-cgi/challenge-platform/scripts/precursor/main.js?ray=…`，位于 `</body>` 前 | 642 B | — | 随 HTML（HTML 带 `s-maxage` 边缘缓存；注入在边缘逐响应重写，见 5.2） | 所有 HTML |
| Precursor 主脚本 | `/cdn-cgi/challenge-platform/scripts/precursor/main.js?ray=…` → 302 → `/cdn-cgi/challenge-platform/h/g/scripts/precursor/<hash>/main.js?ray=…` | 61,279 B | br 21,949 B | 302：`public, max-age=300, stale-if-error=10800, stale-while-revalidate=10800`；最终 200：`private, max-age=0, no-store, no-cache, must-revalidate` → **不缓存** | 每次文档加载重新下载 |

合计：**每个 HTML 文档 +780 B HTML + ~137 KB 原始 JavaScript、~43 KB 压缩后 JavaScript**（且都不受浏览器缓存保护）；代码全部由 Cloudflare 注入，仓库 `src/`、`public/`、`scripts/` 中 **零引用**（已 grep 验证），站点也不依赖它们。

### 5.2 行为分析

- **注入发生在边缘，且逐响应重写**：HTML 本身 `CF-Cache-Status: HIT`（缓存），但每次响应的内联 `__CF$cv$params.r` 都等于当次响应的 `cf-ray`（连续 3 次请求 3/3 匹配）→ 缓存的是"注入前"的 HTML，注入在缓存之后做。因此不存在"缓存了一份旧 ray 的挑战参数"的问题。
- **WebMCP**（`data-packs="c2pa,mcp-server-client"`）：脚本首行 `// src/tool-pack.ts`，逻辑是等待 Chrome 的 `document.modelContext`（WebMCP 浏览器 API，Chrome 146+ 实验特性）。若浏览器没有该 API，会往 console 输出 `[webmcp-interceptor] document.modelContext is not available…` 警告后退出；在有该 API 的浏览器中，会注册 C2PA（图片内容凭证扫描）与 Site MCP Server（默认把工具代理到同源 `/mcp`，并带用户会话凭证去探测 —— 本站 `/mcp` 是 404 HTML）。属于 Cloudflare "Agent Readiness / WebMCP" Beta 的站点级开关（公开资料：Dashboard → Browser Run → Agent Readiness），**不是 zone settings API 里的设置**（`GET /zones/$ZONE/settings/webmcp` → 1003 Unknown setting）。
- **Precursor**：Cloudflare Challenges 产品中的客户端、会话级持续验证；`GET /zones/$ZONE/precursor` 返回 `{"default_mode":"min-friction","enforcement_rules":[]}` → 当前处于**最低摩擦模式**（不拦截，仅采集/评估信号）。官方文档：模式 Off/Monitor/Armed（Dashboard → Security → Settings → 过滤 "Precursor" → Status；API 为 "Update Zone Precursor Config"）。在 `security_level=essentially_off`、`browser_check=off`、WAF/bot management 全关的组合下，它对本站几乎没有实际防护作用，主要是信号采集 + 额外 JS 成本。
- 除上述两项外，未发现其它 Cloudflare 注入：HTML 中无 `email-decode`、无 Rocket Loader、无 Cloudflare Web Analytics beacon、无 speculation rules；`/cdn-cgi/speculation` 返回 2 B 的 `[]`、`email-protection` 类脚本不存在。

### 5.3 建议（用户已决定暂保留）

- **短期保持现状**是可行选择，但应把它记录成"已知成本"：在中文读者常见的移动网络下，额外 ~43 KB br JS + 61 KB 脚本解析/执行的边际 TTFB/LCP 影响需要实测量化（建议对照实验：关闭前后各跑 5 次 Lighthouse/WebPageTest，比较 LCP/TBT，而不是凭直觉）。
- 若决定关闭（不做也无功能影响，仓库零引用）：
  1. **WebMCP**：Dashboard → Browser Run → Agent Readiness（Beta）→ 关闭 WebMCP；关闭后要复核 HTML 中不再出现 `/.webmcp/bridge.js` 与 `data-packs` 标签（社区有"开关关闭后仍注入"的报告，可能有传播/缓存延迟）。
  2. **Precursor**：Dashboard → Security → Settings → Precursor → Status 选 **Off**（或调用 "Update Zone Precursor Config" API 把 `default_mode` 设为 `off`；该端点/字段较新，若走 API 请先 GET 现有配置再整体提交、并灰度验证）。关闭后复核 HTML 中不再出现 `__CF$cv$params` / `challenge-platform/scripts/precursor`。
  3. 两项都关掉后，再做一次 `/` 与文章页的响应头/HTML 内容回归，确认 `Content-Length`/缓存策略/安全头不变（它们只影响 HTML body 尾部 ~780 B 与动态脚本）。
- 不建议为了"保持 console 干净"而单独处理 WebMCP 的 console.warn —— 只能通过关闭功能或接受。

---

## 6. 需要人工操作的事项（本报告不执行）

> 所有命令都用环境变量占位；**在获得用户确认前不要执行**。本审计使用的凭据是 Global API Key（`X-Auth-Email` + `X-Auth-Key`）；如果改用 API Token，把头部换成 `Authorization: Bearer $CLOUDFLARE_API_TOKEN`。

### 6.1 仅能 / 更适合在 Dashboard 手动完成

| # | 事项 | 路径 | 建议 | 优先级 |
| --- | --- | --- | --- | --- |
| D1 | 关闭 WebMCP 注入 | Dashboard → Browser Run → Agent Readiness（Beta）→ WebMCP 关闭（具体菜单名以现网 Dashboard 为准） | 与用户确认后再关；关后验证 HTML 无 `/.webmcp/bridge.js` | P2 |
| D2 | Precursor 关闭 / 调模式 | Dashboard → Security → Settings → 过滤 "Precursor" → Status | 若保留，保持 min-friction；若不需要持续验证则 Off | P2 |
| D3 | 清理遗留 DNS 记录 | Dashboard → DNS → Records | 确认 `x.prologue.dev`（A/AAAA）与 `prologue-blog-demo.prologue.dev`（CNAME→Vercel）是否仍被使用；若否删除，降低悬空子域面 | P3 |
| D4 | （可选）确认 HSTS 策略 | Dashboard → SSL/TLS → Edge Certificates → HSTS | 若想进入 preload 列表：max-age 改 1 年（≥31536000）；否则把 `preload` 关掉 | P3 |
| D5 | （可选）免费托管 WAF | Dashboard → Security → WAF | 静态站不建议为此投入；若开启需观察爬虫误伤 | P3（不建议） |
| D6 | （可选）Early Hints 复核 | Dashboard → Speed → Settings → Content Optimization → Early Hints | 保持 ON（当前正确） | P3 |

### 6.2 可通过 API 安全修改（给出具体值/命令，**未执行**）

1) **关闭 Hotlink Protection（P1，推荐）**

```
curl -sS -X PATCH "https://api.cloudflare.com/client/v4/zones/$ZONE/settings/hotlink_protection" \
  -H "X-Auth-Email: $CF_EMAIL" -H "X-Auth-Key: $CLOUDFLARE_API_KEY" \
  -H "Content-Type: application/json" \
  --data '{"value":"off"}'
```

替代方案（保留功能、只豁免本站图片路径）：用 Configuration Rule 匹配 `/static/`、`/og/` 跳过 Hotlink Protection，或把 PNG 放进名为 `hotlink-ok` 的目录（官方文档推荐的做法，但需要改站点目录结构，本任务不允许改代码，故只记录）。验证：

```
curl -sS -o NUL -w '%{http_code}\n' -e https://feedly.com/ https://prologue.dev/static/favicons/avatar.png   # 期望 200
```

2) **（可选）为 Atom / JSON Feed 增加 Compression Rule（P2）**

现象：二者 MIME（`application/atom+xml`、`application/feed+json`）不在 Cloudflare 默认压缩名单，实测 identity 958,712 B / 952,316 B。Compression Rules 全套餐可用（Free 10 条），API 方式：在 zone 级 `http_response_compression` phase 创建规则（当前该 phase 不存在 entrypoint）：

```
curl -sS -X POST "https://api.cloudflare.com/client/v4/zones/$ZONE/rulesets" \
  -H "X-Auth-Email: $CF_EMAIL" -H "X-Auth-Key: $CLOUDFLARE_API_KEY" \
  -H "Content-Type: application/json" \
  --data '{
    "name": "compression rules",
    "kind": "zone",
    "phase": "http_response_compression",
    "rules": [{
      "action": "compress_response",
      "action_parameters": { "algorithms": [ {"name":"brotli"}, {"name":"gzip"}, {"name":"auto"} ] },
      "expression": "(http.response.content_type.media_type in {\"application/atom+xml\" \"application/feed+json\"})",
      "description": "compress Atom + JSON feed (MIME not in CF default compression list)",
      "enabled": true
    }]
  }'
```

- 规则结构与字段依据官方文档（`compress_response` action、`algorithms` 列表、`auto` 必须放最后）。
- 创建后需 `POST /zones/$ZONE/purge_cache {"purge_everything":true}` 让已缓存的 feed 重新以压缩形式写入缓存（这一步会短暂清空全 zone 缓存；建议与下一次部署合并做，或接受一次全站冷缓存）。
- 验证：`curl -sS -o NUL -w '%{size_download} %{content_type}\n' -H 'Accept-Encoding: br' https://prologue.dev/atomfeed`（期望 wire 明显 < 958,712，且 `Content-Encoding: br`）；同时确认 Vary/条件请求仍正常。
- 若担心压缩规则与资产缓存交互，可先在预览环境里对同一 Worker 试；这是可选项，不做也不影响正确性。

3) **（可选，P3）HSTS max-age 对齐 preload 意图**

```
curl -sS -X PATCH "https://api.cloudflare.com/client/v4/zones/$ZONE/settings/security_header" \
  -H "X-Auth-Email: $CF_EMAIL" -H "X-Auth-Key: $CLOUDFLARE_API_KEY" \
  -H "Content-Type: application/json" \
  --data '{"value":{"strict_transport_security":{"enabled":true,"max_age":31536000,"include_subdomains":true,"preload":true,"nosniff":true}}}'
```

（若并不打算提交 hstspreload.org，则把 `preload` 改 false、max_age 可维持 180 天；二选一，避免"声称 preload 却不够资格"。）

4) **（可选，P3）清理 Response Header Transform 规则里的已下线 host**

现有规则（ruleset `daf658f8d3fe433e990bcbb7c97e2a29`，v4）host 集合包含 `cf.prologue.dev`（已 NXDOMAIN）。更新时**必须整包提交**（PUT 覆盖整个 ruleset 的 rules，而不是只发表达式）：

```
curl -sS -X PUT "https://api.cloudflare.com/client/v4/zones/$ZONE/rulesets/daf658f8d3fe433e990bcbb7c97e2a29" \
  -H "X-Auth-Email: $CF_EMAIL" -H "X-Auth-Key: $CLOUDFLARE_API_KEY" \
  -H "Content-Type: application/json" \
  --data '{
    "name": "default",
    "kind": "zone",
    "phase": "http_response_headers_transform",
    "rules": [{
      "action": "rewrite",
      "action_parameters": { "headers": { "content-type": { "operation": "set", "value": "text/html; charset=utf-8" } } },
      "expression": "(http.host in {\"prologue.dev\" \"www.prologue.dev\"}) and not (http.request.uri.path contains \".\") and not (starts_with(http.request.uri.path, \"/static/\")) and not (starts_with(http.request.uri.path, \"/og/\")) and not (starts_with(http.request.uri.path, \"/cdn-cgi/\")) and not (http.request.uri.path in {\"/rss\" \"/atomfeed\" \"/jsonfeed\" \"/microblog/rss\"})",
      "description": "html charset (static migration)",
      "enabled": true
    }]
  }'
```

- 风险：PUT 是整体替换；漏字段可能改变行为。改前先 `GET /zones/$ZONE/rulesets/daf658f8…` 保存完整响应，改后立即用 `curl -I https://prologue.dev/about` 验证 `Content-Type: text/html; charset=utf-8` 仍在、`/rss` 等仍被正确排除。
- 收益很小（去掉一个死 host 的判断），可与其他规则改动合并做；不做也无功能问题。

5) **（可选，P3）min TLS / security level**：如决定放宽兼容或提高安全等级，用 `PATCH /zones/$ZONE/settings/min_tls_version`（`{"value":"1.2"}`）或 `PATCH /zones/$ZONE/settings/security_level`（`{"value":"low"}`）。当前审计**不建议**为静态站改动安全等级（HTML 导航可能开始遇到挑战，数据请求已有 skip 规则但 HTML 没有）。

6) **Purge（仅在某次改动确实需要时）**

```
curl -sS -X POST "https://api.cloudflare.com/client/v4/zones/$ZONE/purge_cache" \
  -H "X-Auth-Email: $CF_EMAIL" -H "X-Auth-Key: $CLOUDFLARE_API_KEY" \
  -H "Content-Type: application/json" --data '{"purge_everything":true}'
```

注意：日常内容更新无需手动 purge（CI 部署后已自动 purge）；不要为"验证缓存"而反复 purge。

### 6.3 变更后的验证清单

1. `curl -sS -D - -o NUL https://prologue.dev/`：核对 `Cache-Control`、`CF-Cache-Status`、`Content-Type`、`Link`、HSTS 与变更前一致；
2. Hotlink：带 `-e https://feedly.com/` 请求 PNG 应为 200；
3. Early Hints：用 Node http2 脚本确认 103 仍在（见附录 E 片段）；
4. Feeds：`curl -H 'Accept-Encoding: br'` 看 `/atomfeed`、`/jsonfeed` 的 wire size 与 `Content-Encoding`；
5. `/rss`、`/sitemap.xml`、`/robots.txt`、`/version.json`、`/sw.js` 的 Content-Type 与 must-revalidate 不变；
6. 若关了 WebMCP/Precursor：`curl -sS https://prologue.dev/ | grep -c 'webmcp\|__CF\$cv\$params'` 应为 0；
7. 部署后仍有 `purge_everything` 成功日志。

### 6.4 明确"无需操作"的项

- Cache Rules / Page Rules：保持 0 条；**不要**新增。
- Cache Reserve / Argo / 购买升级：不启用（Free 计划；无源站，零收益）。
- Tiered Cache / Always Online / Edge Cache TTL / cache_level / browser_cache_ttl：保持现值；browser_cache_ttl 尤其不要动。
- HTML/RSC/feed/SW/静态资源的缓存策略：保持 `_headers` 现状（含 `/*.txt` 的 60s 浏览器 TTL）。
- Workers Builds：保持关闭（GitHub Actions 是唯一 CI/CD）。
- 安全头（nosniff/Referrer-Policy/Permissions-Policy/X-Frame-Options/CSP frame-ancestors）：保持 `_headers` 现状。
- `robots.txt` / 托管 robots：当前 Cloudflare 不追加内容，站点文件即最终内容；不要为此改 bot management。
- 不要改 MX / SPF / DKIM / DMARC / Email Routing。

### 6.5 建议后续更新的仓库文档（本任务不改）

| 位置 | 当前描述 | 实测 / 建议 |
| --- | --- | --- |
| `docs/DEPLOY-CLOUDFLARE.md`（2026-11-26 更新段） | "Managed robots stays on（会前置 3,153 字节块）" | 实测 `/robots.txt`（477 B）与 `out/robots.txt` 字节一致（普通 UA / GPTBot / ClaudeBot 均同）；`bot_management` 显示 `cf_robots_variant=off`、AI 相关开关 disabled。建议改为"托管 robots 当前不生效，robots.txt 完全是站点文件" |
| 同上 | "purge 是新部署在边缘可见的唯一条件" | 资产缓存按 Worker 版本/asset manifest 管理（Static Assets 概览 + version skew 文档）；新部署本身会切换版本。建议改为"purge 仍保留作为 Early Hints/zone 缓存的兜底与快速失效手段"，避免误导后人把它当作唯一机制或误删 |
| `CLAUDE.md` 部署段 | "Cloudflare 也注入 `/.webmcp/bridge.js`（~75 KB）与 Precursor 挑战脚本" | 体积/缓存行为可补精确数字（75,756 B / br 20,828 B，无 304；Precursor 61,279 B / br 21,949 B，no-store）；本审计已量化 |
| 同上 | "Cache Reserve/Tiered Cache 若文档不支持"（任务描述里的关注点） | 明确写"不适用：Free 计划 + 无源站"可减少后续重复调研 |

---

## 7. 不建议做的事（及理由）

| 不建议 | 理由 |
| --- | --- |
| 为本站启用 **Cache Reserve** | 需付费计划（API 403；文档明确 paid plan）；本站无源站，资产已由 Cloudflare 自动缓存，R2 持久层无收益，还增加计费面 |
| 启用 **Argo Smart Routing** / 为 assets 调 **Tiered Cache** | 二者优化的是"CF 边缘↔源站"链路；本站是 assets-only Worker、无源站。Static Assets 已自带内部分级缓存，zone 设置不参与 |
| 新增 **Cache Rules** 或 **Page Rules** | 资产缓存由 Worker 版本 + `_headers` 决定；再叠加规则会形成第二套策略，且 `_headers` 文档明确重复/冲突的 Cache-Control 指令会被逗号拼接成无效值（RFC 9111 视为 stale） |
| 把 **HTML 浏览器 TTL** 改长（如 max-age=3600/1y） | 会打破"HTML 与哈希 chunk/RSC 同版本"的保证，旧 HTML 可能引用已删除的 chunk。当前 `max-age=0, must-revalidate` + `browser_cache_ttl=0` 是正确组合 |
| 用 **query string** 做缓存失效 / 验证新部署 | 实测资产缓存忽略 query（唯一 query 仍 HIT）；失效应依赖部署 + purge（`/og?v=` 只影响外部缓存） |
| 通过 `_headers` 给 HTML 加固定 **ETag** | 所有 HTML 会共享同一 ETag → 可能对错误内容返回 304，比"无 ETag"更糟；正确做法是保持现状或引入 Worker 代码（本架构明确不要） |
| 开启 **Rocket Loader** | 会破坏 Next hydration（仓库与历史实测均已确认） |
| 开启 **Minify（HTML/CSS/JS）** | 构建期已压缩；二次 minify 可能改变内联脚本/hash/CSS 语义，收益近零 |
| 开启 **Polish / Mirage / WebP** | 图片在构建期已生成 AVIF/WebP 多尺寸；这些功能在 Free 计划只读，且会与既有变体/缓存策略重复 |
| 开启 **Speed Brain / Speculation Rules / Prefetch-Preload** | 与 Next 自带 prefetch 重复；历史问题：`/cdn-cgi/speculation` 会返回站点 HTML；当前三者均为 off，是正确的 |
| 开启 **Email Obfuscation** | 会注入 email-decode 脚本并改写邮箱；站点已有自己的联系入口 |
| 开启 **Development Mode** | 会绕过缓存并临时停用优化，绝不用于生产 |
| 依赖 **Always Online** 做可用性兜底 | 没有源站，没有可供快照的来源；真正兜底是 Cloudflare 边缘资产缓存本身 |
| 重新启用 **Workers Builds** | 会与 GitHub Actions 形成重复构建/漂移；当前 build config 已删除是正确的 |
| 现在开启 **Cloudflare 免费托管 WAF 规则集** | 静态站无动态攻击面；托管规则主要针对 WordPress/插件 CVE 探测，收益低、可能误伤爬虫。需要 bot 防护时先单独评估 |
| 把 **security_level** 提高且不测试 | HTML 导航可能开始收到挑战，影响读者/自动化；数据请求的 skip 规则只覆盖 `_rsc`/`.txt`/`_next`，HTML 没有豁免 |
| 把 **min_tls_version** 设得更高 / 更激进地使用 **0-RTT** | 1.3-only 已牺牲部分旧客户端兼容；当前 0-RTT 对纯 GET 可接受，但若未来有非幂等请求需关闭 |
| 现在把 **HSTS preload** 当作已完成 | max-age 180 天不满足预加载列表要求；要么补到 1 年并正式提交，要么去掉 preload 标记 |
| 修改 **MX / SPF / DKIM / DMARC / Email Routing** | 邮件链路不在本次范围且当前配置正常（DMARC p=reject、DNSSEC active），动它有真实退信风险 |
| 删除 `x.prologue.dev` / `prologue-blog-demo` 而不确认用途 | 它们看起来是遗留记录，但可能是仍在使用的演示/隧道入口；先确认再删（见 D3） |

---

## 附录 A：Zone settings 全量快照（56 项，2026-11-26 只读获取）

> 格式：`id = value`；标 `[readonly]` 的是当前计划下只读项。`security_header` 已在上文展开。

```
0rtt = on
advanced_ddos = on [readonly]
always_online = on
always_use_https = on
automatic_https_rewrites = on
brotli = on
browser_cache_ttl = 0
browser_check = off
cache_level = basic
challenge_ttl = 1800
ciphers = []
cname_flattening = flatten_at_root
development_mode = off
early_hints = on
ech = on
edge_cache_ttl = 7200
email_obfuscation = off
filter_logs_to_cloudflare = off
hotlink_protection = on
http2 = on [readonly]
http3 = on
ip_geolocation = on
ipv6 = on
log_to_cloudflare = on
long_lived_grpc = off [readonly]
max_upload = 100
min_tls_version = 1.3
minify = {"css":"off","html":"off","js":"off"}
mirage = off [readonly]
mobile_redirect = {"status":"off","mobile_subdomain":null,"strip_uri":false}
opportunistic_encryption = on
opportunistic_onion = on
orange_to_orange = off
origin_error_page_pass_thru = off [readonly]
polish = off [readonly]
pq_keyex = on
prefetch_preload = off [readonly]
privacy_pass = off
proxy_read_timeout = 125 [readonly]
pseudo_ipv4 = off
replace_insecure_js = on
response_buffering = off [readonly]
rocket_loader = off
security_header = {strict_transport_security:{enabled:true,max_age:15552000,include_subdomains:true,preload:true,nosniff:true}}
security_level = essentially_off
server_side_exclude = on
sort_query_string_for_cache = off [readonly]
ssl = strict
tls_1_2_only = off
tls_1_3 = zrt
tls_client_auth = off
true_client_ip_header = off [readonly]
visitor_ip = on
waf = off
webp = off [readonly]
websockets = on
```

另有独立端点（不在 bulk settings 中）：`speed_brain = off`、`tiered_cache_smart_topology_enable = on`、`argo_tiered_caching = on`（readonly）、`early_hints` 已含在上表；`precursor = {default_mode:"min-friction",enforcement_rules:[]}`。

## 附录 B：Rulesets 完整清单（9 个）

| id | name | kind | phase | version | 规则数 |
| --- | --- | --- | --- | --- | --- |
| `70339d97bdb34195bbf054b1ebe81f76` | Cloudflare Normalization Ruleset | managed | http_request_sanitize | 6 | 4（1 enabled） |
| `b42644f558d04e41ba6afa4c79b51009` | Cloudflare Managed Response Firewall Default | managed | http_response_firewall_custom | 2 | 1 |
| `77454fe2d30c4220b5701f6fdfb893ba` | Cloudflare Managed Free Ruleset | managed | http_request_firewall_managed | 89 | 44 |
| `4d21379b4f9f4bb088e0729962c8b3cf` | DDoS L7 ruleset | managed | ddos_l7 | 3541 | 148 |
| `120bc9477b67488da8839d0f9e1009e0` | default | zone | http_request_firewall_custom | 4 | 1（skip 数据请求） |
| `ad25050224084c9a8b8f5a9d66264080` | default | zone | http_request_cache_settings | 6 | 0 |
| `181ea76194314a43a25dc2b9a1d5d40e` | default | zone | http_request_transform | 2 | 0 |
| `14c02830a69f43b6b88328c3df554029` | default | zone | http_request_dynamic_redirect | 3 | 1（www→apex 301） |
| `daf658f8d3fe433e990bcbb7c97e2a29` | default | zone | http_response_headers_transform | 4 | 1（HTML charset） |

## 附录 C：DNS 记录（16 条）

| 类型 | 名称 | 内容 | Proxied | TTL | 备注 |
| --- | --- | --- | --- | --- | --- |
| A | x.prologue.dev | 168.107.79.197 | 否 | 1 | 疑似遗留，见 D3 |
| AAAA | x.prologue.dev | 2603:c024:4503:e0aa:0:1b98:eaff:f8ea | 否 | 1 | 疑似遗留 |
| CNAME | prologue-blog-demo.prologue.dev | cname-china.vercel-dns.com | 否 | 1 | Vercel 演示残留 |
| MX | prologue.dev ×3 | route1/2/3.mx.cloudflare.net | — | 1 | Email Routing |
| TXT | cf2024-1._domainkey.prologue.dev | DKIM | — | 1 | — |
| TXT | _dmarc.prologue.dev ×2 | v=DMARC1; p=reject; sp=reject; adkim=s; aspf=s; … | — | 1 | 良好 |
| TXT | *._domainkey.prologue.dev | v=DKIM1; p=（空） | — | 1 | — |
| TXT | prologue.dev ×4 | openai-domain-verification / SPF(include:_spf.mx.cloudflare.net ~all) / ENS / google-site-verification | — | 1 / 3600 | — |
| AAAA | prologue.dev | 100:: | 是 | 1 | Worker Custom Domain 占位 |
| AAAA | www.prologue.dev | 100:: | 是 | 1 | Worker Custom Domain 占位 |

- 实测公网解析（1.1.1.1）：apex/www 均返回 Cloudflare anycast A（104.21.48.158、172.67.154.82）与 AAAA（2606:4700:…）；`cf.prologue.dev` 为 NXDOMAIN。DNSSEC 状态 active。

## 附录 D：Workers / 部署信息

- 脚本：`prologue-blog`，`has_assets: true`，`handlers: ["fetch"]`（assets-only 的内部 fetch），`bindings: []`，`compatibility_date: 2026-11-25`。
- 版本：共 29 个版本（最近几次：v29 2026-11-26T08:15:37Z；v28 08:02Z；v27/v26/v25 为 11-25）——由 `wrangler` 上传（`workers/triggered_by=version_upload`），符合"CI 用 wrangler 部署"。
- 部署：最新 deployment `5522b423…`，100% → version 29，source wrangler。
- Custom Domains：`prologue.dev`、`www.prologue.dev`（均 enabled，previews_enabled=false）。
- Workers Builds：无 build config（12040）、builds []、triggers []。
- 其它：account 级 `workers/subdomain = "prologue"`，但 zone 的 `workers_dev=false` 且实测 workers.dev 不可达。

## 附录 E：复现命令（不含密钥）

```bash
# 只读获取全部 zone settings（Global API Key 方式；per_page 上限 50）
ZONE=0bf0102de76cab34ef6089be6d6dc95a
curl -sS "https://api.cloudflare.com/client/v4/zones/$ZONE/settings" \
  -H "X-Auth-Email: $CF_EMAIL" -H "X-Auth-Key: $CLOUDFLARE_API_KEY" | jq '.result[] | {id,value,editable}'
curl -sS "https://api.cloudflare.com/client/v4/zones/$ZONE/rulesets" \
  -H "X-Auth-Email: $CF_EMAIL" -H "X-Auth-Key: $CLOUDFLARE_API_KEY" | jq '.result[] | {id,name,kind,phase,version}'
curl -sS "https://api.cloudflare.com/client/v4/zones/$ZONE/precursor" \
  -H "X-Auth-Email: $CF_EMAIL" -H "X-Auth-Key: $CLOUDFLARE_API_KEY"

# 生产响应头
curl -sS -D - -o /dev/null https://prologue.dev/ | grep -Ei '^(HTTP/|cache-control|cf-cache-status|content-type|link|strict-transport-security|alt-svc)'
curl -sS -D - -o /dev/null https://prologue.dev/atomfeed | grep -Ei '^(HTTP/|content-type|cache-control|content-encoding)'
curl -sS -o /dev/null -w '%{http_code}\n' -e https://feedly.com/ https://prologue.dev/static/favicons/avatar.png

# 103 Early Hints（Node http2；curl 无 h2 能力时用）
node -e 'const h=require("node:http2");const c=h.connect("https://prologue.dev");const r=c.request({":path":"/",":method":"GET","accept":"text/html"});r.on("headers",x=>{if(x[":status"]===103)console.log("103",x)});r.on("response",x=>console.log("status",x[":status"]));r.on("data",()=>{});r.on("end",()=>c.close())'
```

## 附录 F：参考文档

- Workers Static Assets — Headers（默认头/ETag/_headers/100 条规则/2,000 字符/detach 语义）：https://developers.cloudflare.com/workers/static-assets/headers/
- Workers Static Assets — 概览（自动缓存、版本/manifest、内置分级缓存）：https://developers.cloudflare.com/workers/static-assets/
- Workers Static Assets — Billing and limitations（Range 限制、免费额度）：https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/
- Workers — Version skew and static assets：https://developers.cloudflare.com/workers/versions-and-deployments/version-skew/
- Cache — Cache-Control directives（s-maxage/Browser Cache TTL 交互）：https://developers.cloudflare.com/cache/concepts/cache-control/
- Cache — Early Hints（h2/h3、生成条件、URI 键忽略 query）：https://developers.cloudflare.com/cache/advanced-configuration/early-hints/
- Speed — Content compression（MIME 白名单）：https://developers.cloudflare.com/speed/optimization/content/compression/
- Rules — Compression Rules（全套餐可用、API `compress_response` / `http_response_compression`）：https://developers.cloudflare.com/rules/compression-rules/
- WAF — Hotlink Protection（gif/ico/jpg/jpeg/png、RSS 例外）：https://developers.cloudflare.com/waf/tools/scrape-shield/hotlink-protection/
- Cache — Cache Reserve（需要付费计划）：https://developers.cloudflare.com/cache/advanced-configuration/cache-reserve/
- Cache — Tiered Cache（面向源站）：https://developers.cloudflare.com/cache/how-to/tiered-cache/
- Workers — Cache（zone 级缓存配置/purge 与 Worker 缓存的关系）：https://developers.cloudflare.com/workers/cache/
- Challenges — Precursor（客户端持续验证、模式、Dashboard 路径）：https://developers.cloudflare.com/cloudflare-challenges/precursor/
- WebMCP（Browser Run Beta）：https://developers.cloudflare.com/browser-run/features/webmcp/

---

*报告完。本次审计未修改任何线上设置、未部署、未 purge；除本文件外未改动仓库文件。*

> **Post-audit architecture note (2026-11-26):** the Worker is no longer assets-only. A thin `worker/index.js` with an `ASSETS` binding and `run_worker_first: true` was added for Free-plan Markdown for Agents content negotiation; see `docs/DEPLOY-CLOUDFLARE.md`. Cache headers and routing semantics in this audit remain valid.
