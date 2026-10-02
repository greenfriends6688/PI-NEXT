# PI NEXT v0.1.7

这一版把 9 月底那一轮换肤与手机适配收了尾，同时把积压的 13 批上游改动并了进来。
三件大事：**设计系统有了唯一风格源和门禁**（29 张画板 + 5 条检查脚本，颜色/间距/图标
不再靠人眼比）、**手机 / PWA 从「能用」改成「按得准」**（工作台、侧栏、文件面板、
设置各分节逐个量过）、**pi SDK 从 0.87 升到 1.0.0**（工具 exposure / prompt disposition /
MCP 内置扩展都按新契约对齐）。改动面很大：613 个文件、+71.5k/−28.7k 行。

## 新增

- **设计系统（`design/pi-web-design/`）**：29 张画板 + `DESIGN-SPEC.md` + `DIVERGENCE.md`
  是界面唯一风格来源。颜色链路是「画板 token → `--ds-*` → 产品槽位」，
  产品 CSS 不再写 hex。配套门禁：样式字面量、动效 token、图标名、对比度、
  以及**画板几何对位**（一板一 spec，跑真浏览器逐元素量矩形，覆盖 19/30 张画板）。
- **手机 / PWA 两档**（≤640 手机、641–1024 平板）：工作台输入区在手机上收成固定两行、
  发送键回到工具条内（之前 768 下它被渲染进隐藏层，等于没有发送键）；侧栏行内动作
  命中区抬到 40×40、会话行动作收成一枚常驻 `⋯`、抽屉补 Esc 与左滑关闭；
  文件面板头部分档到行内 + `⋯`；设置各分节（模型 / 技能 / 子代理 / 插件）逐页把
  表格改成卡片、按钮抬到触控档。桌面 >1024px 一个像素不动。
- **设置里新增**：发送键可配（Enter 直发 / Ctrl+Enter 才发）、上下文压缩预算
  （`compaction.*` 与 `branchSummary.reserveTokens`）、思考档 token 预算（四档）、
  重试参数（`settings.retry` 三个字段）、技能与插件按组全开全关。
- **模型配置**：`compat` 开关表按协议展开（26 个字段不用再手改 JSON）、
  `cost.tiers` 阶梯定价编辑器、api 协议下拉覆盖 pi-ai 的 KnownApi 全集、
  模型规格可从 provider 自己的 `/models` 回填、新会话按 per-model 记忆预选思考档。
- **输入框工具条上的供应商配额芯片**：显示当前模型所属 provider 最紧那个额度窗口的
  剩余量（≤10% 红、≤30% 橙），鼠标悬停看全部窗口；查不到就不渲染。
- **文件**：符号链接目录指向项目外时显式放行（一次一条链接、绑定 realpath、重启失效）；
  文件树隐藏什么改由 Git 决定（`check-ignore` + `ls-files`，被跟踪的照样显示）；
  压缩包 zip / 解包；拖入绝对路径变成 cwd 相对 `@` 提及。
- **MCP 换成 pi 1.0 的官方实现**：配置的读/写/删/改、校验、OAuth 入口全部转发 pi 的官方原语
  （跨 agent 的配置发现保留，pi 没这能力）；内置 `mcp` 扩展按 `builtin:mcp` 接进
  `extensionFactories`，会话里能真连上 stdio server 并拿到工具，而「只看一眼会话」
  （切会话取工具列表、自动命名、SSE 预热）不会把 server 拉起来常驻。
  stdio 子进程的 env 做了清洗（不再把整个 `process.env` 交出去）。

## 改动

- **pi SDK 0.87 → 0.99.1 → 1.0.0**：工具 `exposure`（`direct`/`model-only` 与
  `codemode`/`deferred`/`hidden` 的区别）与 `prompt()` 的 `preflightResult` 都按新契约对齐；
  `enabledModels` 作用域改由 SDK 的 `resolveModelScopeWithDiagnostics()` 解析。
- **设置页 12 个分节收敛到两套骨架**（列表页 / 详情页），画板 62 逐帧落地；
  死 CSS 清退（`settings.css` 37.2K → 26K），内联几何字面量从 307 收到 94（冻结基线，只许变少）。
- **会话与流**：SSE 每个客户端的 backlog 封顶、重连快照带上压缩状态；
  空闲回收的唯一接缝是 `lib/session-liveness.ts`，**有后台子代理在跑的父会话不再被回收**。
- **MCP 的校验与认证入口换名换语义**：Test 按钮现在只报**结构是否有效**（不再真连一次握手），
  通过的提示会明说「未建立连接」；OAuth 入口从 `/mcp-auth` 换成 pi 内置的 `/mcp login`；
  `socket` 与旧版 `sse` 两种传输不再支持。旧配置里的 `disabled: true` 仍然按禁用处理。
- **fork 可以在会话正在跑的时候做**（上游 #1023）：fork 走独立的 `SessionManager` 复制
  已完成条目，不再调用会就地改写内层状态的 `AgentSession.fork()`。
- **子代理**：取回标记按 run 记、重启后的孤儿报告成「已中断」、恢复的报告写清来源；
  `ext:` 禁用名单改成对着真实扩展来源解析（别名与 npm 作用域写法绕不过去）。
- **改名 Pinkslab → PI NEXT**：窗口标题、PWA manifest、wordmark 与桌面版的应用目录
  全部换名；桌面包会把旧目录（`Pinkslab` / `Pi Codex` / `pi-web`，由新到旧）里的
  用户数据迁过来。

## 修复

- **旧 Safari / iOS 16.2 首页白屏**：客户端不再出现正则 lookbehind；依赖里那条
  （`mdast-util-gfm-autolink-literal` 的 email 正则）用打包 loader 换成运行时构造，
  Turbopack 与 webpack 两条路都挂上了；`static {}` 块按 browserslist 降到 16.2 编译。
- **路径授权**只认编码工具的结果 —— MCP / 扩展工具结果里的字符串不再能用来读文件；
  打开文件夹先查白名单再 stat，不再用状态码探测路径是否存在。
- **`models.json` 读不出来时禁用保存**，不再把用户配置覆盖成空。
- **渲染**：行内公式旁的货币格式（`$20` 与 `$30`）不再被吃掉、紧跟 URL 的中文标点不再
  被吞进链接、用户消息里 Shift+Enter 排的版不再被折成一行。
- **压缩期间**报「正在压缩」而不是一直报等模型；扩展 UI 按 id 排队，并行审批不再互相顶掉。
- **9 个复制点接上失败反馈**（原先 8 个点下去没反应）。
- **手机上拉变形的开关**：触控档给所有 `button` 补的 `min-height` 把画板里 30×17 的
  `.pw-switch` 压成 30×36 的椭圆（用户实拍那颗「月牙」）—— 现在盒子回到画板几何，
  命中区改用伪元素外扩。

## 已知

- **MCP 仍没有 per-prompt 的连接管理（上游 P1 的 `McpHost`）**：连接在浏览器会话打开期间
  常驻，靠 wrapper 空闲回收关闭；没有「每次 prompt 前比对配置指纹」这一层。
  远程部署还要单独处理 OAuth 回调（只监听 `127.0.0.1`）与 `.pi/mcp.json` 的目录信任。
- 用量统计里 fork 出来的会话（`parentSession` 非空）会把父会话的历史再算一遍，
  总 token/成本比真实支出偏高。
- 画板几何对位覆盖 19/30 张画板；没写 spec 的那几张只靠人眼比。
- 真机 Safari / iOS 16.2 与 Playwright WebKit 没跑过，白屏修复只在源码层验证。
