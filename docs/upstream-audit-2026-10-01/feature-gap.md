# 功能级差异对比：我们的 fork (A) vs 上游 (B)

- **A** = `/Users/yingjing/Desktop/pi-codex` @ `main` (`e34c1c6`)，只读，未做任何修改。
- **B** = `/Users/yingjing/Desktop/pi-codex/pi参考项目/pi-web-main`。

## 0. 前提校正：B 不是 v0.9.3 tag，而是 agegr/main 的 HEAD

B 的 `package.json` 写 `0.9.3`，但逐文件 `git hash-object` 比对后确认：

```
lib/pi-sdk-internals.ts  main=9d96708  local=9d96708  SAME
components/OAuthPastePanel.tsx        SAME
app/login/page.tsx                     SAME
demo/app/page.tsx                      SAME
```

B 的 776 个源文件与 `git ls-tree -r agegr/main` **逐一对应**，即 **B = `agegr/main` @ `e17d2cc`**，
比 `v0.9.3` tag **多 53 个 commit**（`git log v0.9.3..agegr/main --oneline`）。
`v0.9.3` tag 与 B 的差异只有两处：`lib/startup-preferences.ts`（B 改名成 `lib/default-preferences.ts`）
和 `hooks/useEnterSendMode.ts` 等 53 个提交新增的文件。

所以第 1 节里带 "post-v0.9.3" 标注的条目是 **v0.9.3→HEAD 期间上游新增的**，不是 B 快照独有。

---

## 1. B 有而 A 没有的「用户可见能力」

按 (a) 解决什么问题 / (b) A 有无等价 / (c) 落点与工作量 三段写。
判定：**真缺** = 值得补；**等价** = 跳过；**无关** = 上游定位特有。

### 1.1 真缺口（值得补）

---

#### G1. 文件树让 Git 决定隐藏什么（被 gitignore 的目录仍可浏览）
`lib/file-tree-visibility.ts` + `app/api/files/[...path]/route.ts`（接线）· 上游 `13bc2b0` (#1014)、`claude/issue-677`

- **(a)** 现在文件树用**写死的黑名单**（`node_modules/.git/dist/build/target/vendor/.pyc`…）。
  于是：① 被 `.gitignore` 忽略的 `secret/`、`*.log` 照样列出来；② 反过来，一个 **git 跟踪着的
  `build/`（很多仓库真的提交了构建产物）被硬编码黑名单藏起来，用户找不到**。
  B 改成问 Git：目录在 work tree 内就用 `git check-ignore --no-index` 判忽略，再用
  `git ls-files --cached` 兜底——**被忽略但有跟踪文件**的条目照常显示；不在 work tree 内才退回名字表。
- **(b)** A **确认无等价实现**。`app/api/files/[...path]/route.ts:45-51` 是
  `IGNORED_NAMES` / `IGNORED_SUFFIXES` 两个常量，`:831` 直接 filter；全仓 `grep check-ignore` 无命中。
- **(c)** 新增 `lib/file-tree-visibility.ts`（157 行，纯函数 + execFile）；
  改 `app/api/files/[...path]/route.ts` 的 list 分支（1 处 import + 1 处过滤）；
  加 `.test.mjs`。**工作量 M**（逻辑本身是现成的，难点在超时/批量/pathspec 转义）。
- **风险**：列表会等 git（上限 5s），A 的 dev 模式本来就慢，`lib/git-status.ts` 已经踩过 git 阻塞的坑。

---

#### G2. 符号链接目录：允许操作员显式放行到 roots 之外
`lib/linked-directory.ts` + `app/api/files/[...path]/route.ts` + FileExplorer 确认弹层 · 上游 `687af27` (#1018)、`claude/issue-748`

- **(a)** 克隆下来的仓库里常有一个指向项目外的符号链接目录。A 现在的行为：list 会把它**列出来**
  （`resolveDirentIsDirectory` 走了 stat），但点进去读文件一律 403 —— 死胡同。
  B 的做法：条目上带 `outsideLinkTarget`，点进去弹一次确认（「允许浏览 /home/x/foo？若目标是 `/` 或 `~` 还要额外警告」），
  校验 lstat 是 symlink、realpath 与列表时一致（变了就 409 让刷新），只授权这一条、不加宽全局 roots。
- **(b)** A **确认无等价实现**。`grep -rn "outsideLink\|linkedDirectory"` 全仓 0 命中。
  A 相关的只有「防逃逸」：`lib/path-security.ts`、`lib/file-mutations.ts`、`app/api/files/[...path]/route.ts:164`
  （拒绝编辑 symlink 文件）。防逃逸 ≠ 允许放行，方向相反。
- **(c)** 新增 `lib/linked-directory.ts`（123 行，可整份照搬）；
  files 路由 list 分支包一层 + 新增一个 `action:"allow-linked-directory"`；
  `components/FileExplorer.tsx` 加确认弹层（上游在 `FileExplorer.linked-directory.test.mjs` 有守卫）。
  **工作量 M**。

---

#### G3. 扩展 UI 请求排队（并行工具同时弹多个审批框）
`lib/extension-ui-queue.ts` + `hooks/useAgentSession.ts` + `components/ChatWindow.tsx` · 上游 `70470ca`、`e17d2cc`、`46b5235`

- **(a)** A 的 `hooks/useAgentSession.ts:366-367` 是
  `useState<...DialogRequest | null>` + `useState<...CustomRequest | null>` —— **单槽**。
  两个工具并行跑、各自被权限扩展 gate 住时，后一个请求会顶掉前一个，前一个的服务端 future 永远不 resolve。
  B 改成两条按 `id` 排队的队列（dialog 一条、custom panel 一条），SSE 重连重放同一 id 不重复入队，
  服务端已关但关闭事件因断流没收到的陈旧请求按 id 集合裁掉。
- **(b)** A **确认无等价实现**（有 `extension_ui_request` 的完整往返，但就是单槽）。
- **(c)** 新增 `lib/extension-ui-queue.ts`（45 行）；`useAgentSession.ts` 单槽 → 队列（4 个 setState 点）；
  `ChatWindow.tsx:2090-2093` 单个 `ExtensionDialog` → `.map()`。
  **工作量 M**。注意 A 的 `lib/approval-extension.ts` / `lib/approval-policy.ts` 是这套交互的主要来源，收益直接。

---

#### G4. 技能 / 插件「按组全开全关」开关
`components/settings-ui-helpers.ts` + `components/SettingsUi.tsx`(`ConfigSidebarGroupSwitch`) + `SkillsConfig.tsx` + `PluginsConfig.tsx` · 上游 `eceac13` (#1020)、`b9622a1` (#1021)、`4de9f77`

- **(a)** 上游把设置侧栏的分组标题升级成开关：一组技能一键「全部给模型看 / 全部不给模型看」，
  一组插件一键「全部启用 / 全部停用」（带 resource filter 的插件包停用会丢过滤器，所以保留自己的开关）。
- **(b)** A **确认无等价实现**。A 有**单个**技能的 `disableModelInvocation` 开关
  （`components/SkillsConfig.tsx:898`）和单个插件包的 `disabled` 开关（`components/PluginsConfig.tsx:417`），
  也有**模型**维度的批量开关（`components/EnabledModelsSection.tsx:359-395`，那是 models 不是 skills）。
  `grep -rn "groupSwitch" lib/i18n/messages/zh-CN.ts` → 0，A 连 i18n key 都没有。
- **(c)** 需要在 A 的设计体系里长出来：`components/SettingsUi.tsx`（A 有这个文件）加
  `ConfigSidebarGroupSwitch`；`SkillsConfig.tsx` 分组标题接开关 + `applySkillToggleResults` 批量落盘；
  `PluginsConfig.tsx` 同理；`itemsToSwitch` 的 keepOn 语义要照抄。
  **工作量 M**（A 的设置面板是重设计过的，不是 B 的组件直接可用）。

---

#### G5. iOS 16.2 / Safari < 16.4 首页白屏
`lib/gfm-autolink-email-loader.cjs` + `next.config.ts`（turbopack rules + webpack rule + `transpilePackages`）· 上游 `f52fd84` (#1019)

- **(a)** `mdast-util-gfm-autolink-literal@2.0.1` 的 email 正则以 lookbehind 开头
  （`(?<=^|\s|\p{P}|\p{S})`），Safari 16.4 以下解析不了 → 整个 chunk SyntaxError → `/` 首屏白屏。
  B 用一个 webpack/turbopack loader 把该正则替换成运行时 `new RegExp(...)`（失败再退回无 lookbehind 版）；
  顺带 `transpilePackages: ["mermaid", "@mermaid-js/parser"]` 处理 mermaid 的 `static {}` 类块。
- **(b)** A **确认有同一个 bug**（不是「上游特有」）：A 的 `node_modules/mdast-util-gfm-autolink-literal`
  实测就是 2.0.1 且含 lookbehind，A 的 `next.config.mjs` 里**没有任何 loader / transpilePackages**。
  A 同样依赖 `mermaid ^11.16.1`。
- **(c)** 新增 `lib/gfm-autolink-email-loader.cjs`（37 行，可整份照搬）；
  `next.config.mjs` 里加 `turbopack.rules` + `webpack()` + `transpilePackages`。
  注意 A 是 **`.mjs`**（有注释解释为什么不用 TS，避免 `next start` 把 swc 拖进运行时包），
  所以要写成 JS 而不是照抄 B 的 `.ts`。**工作量 S**（半小时级，但需要真机/真 Safari 验一次）。

---

#### G6. 发送键可配置（Enter / Ctrl+Enter）
`hooks/useEnterSendMode.ts` + `components/SettingsPanel.tsx` · 上游 `5df8278` (#1001)

- **(a)** 上游给「Enter 发送 vs Ctrl+Enter 发送」一个设置开关（`useSyncExternalStore` + localStorage）。
  动机是桌面 Enter 直发会和某些 IM 习惯冲突。
- **(b)** A **确认无等价**：`components/ChatInput.tsx:2482` 写死
  `Enter && !shiftKey && (!isMobile || ctrl/meta)`，设置面板里没有这一项。
  A 的 `hooks/useTwoPhaseEnter.ts` 是**同名不同物**（弹层两段式入场动画），别认错。
- **(c)** 新增 `hooks/useEnterSendMode.ts`（40 行）；`SettingsPanel.tsx` 加一行 radiogroup（用 A 的设置行组件）；
  `ChatInput.tsx:2482` 的 `sendShortcut` 读 `useEnterSendMode()`；i18n 三语 +2 key。
  **工作量 S**。

---

#### G7. 密码网关（`PI_WEB_PASSWORD`）+ 登录页 + 登录限速
`lib/web-auth.ts` + `lib/auth-throttle.ts` + `lib/login-destination.ts` + `app/api/web-auth/route.ts` + `app/login/page.tsx`

- **(a)** 上游支持 `PI_WEB_PASSWORD`：设了就必须先过 `/login` 输密码，拿到 HMAC 签名的 httpOnly cookie
  （30 天）或 Basic Auth；失败走**全局指数退避**（1s→60s，5 分钟清零），因为 Next route handler
  拿不到可信客户端 IP，`x-forwarded-for` 可伪造，所以宁可锁所有人不锁 IP。
  `lib/login-destination.ts` 专门堵 `?next=/\evil.example` 被解析成 `//evil.example` 的跳转劫持。
- **(b)** A **确认无等价**：`grep -rn "PI_WEB_PASSWORD"` 全仓 0 命中，A 没有任何 operator 密码。
  A 有 `lib/request-security.ts` 的 `isApiRequestAllowed`（同源/CSRF 校验），但那是**防跨站**，不是**防未授权访问**。
- **(c)** 新增 4 个文件 + `proxy.ts` 加一条 `/login` 与 `/api/*` 的会话校验 + 全局 CSS。
  **工作量 L**（且要决定：A 是 Electron 桌面 + 默认绑 127.0.0.1，这套是为「远程部署的 Web 服务器」设计的）。
- **定位判断**：**边界项**。A 默认单机、无远程暴露面（`dev:lan`/`start:lan` 才绑 0.0.0.0）。
  只有当 A 要支持「局域网/公网部署」时才需要 → 建议记为待决，不进本轮。

---

#### G8. 会话正在跑时也能 fork（#1023）
共享文件里的行为差异，A **有硬编码禁用**。

- **(a)** `components/ChatWindow.tsx:2203`：
  `onFork={sessionBusy || isNew ? undefined : handleFork}` —— 运行中消息的分叉按钮直接不传。
  B 的 #1023 去掉这个限制并处理运行态下的分支写入。
- **(b)** A 有 fork 能力本身，只是运行中禁用。
- **(c)** 放宽条件 + 处理「fork 目标会话也在跑」的分支点。**工作量 S–M**（看着一行，实际要碰 session 写入路径）。

---

#### G9. 压缩中显示「正在压缩」而不是「等模型」（#1008）
`lib/chat-phase-label.ts` · B 是独立模块，A 内联在 ChatWindow + `fork/PhaseRoll.tsx`。

- **(a)** 自动压缩会卡住一轮好几十秒，期间状态行报 `waiting_model`，读起来像挂死。
- **(b)** A 有 `isCompacting`（`hooks/useAgentSession.ts:355`）并传到了 ChatWindow（`:1924`），
  但 `components/fork/PhaseRoll.tsx` 的相位文案里**没有 compacting 优先级**（grep 无 compacting）。
  → 半覆盖，需要在 A 的相位映射里补一条。
- **(c)** `components/ChatWindow.tsx` 相位 key 计算 + `fork/PhaseRoll.tsx` 文案表 + i18n。**工作量 S**。

---

#### G10. Markdown 列表在 **Enter** 上自动续行（#884）
`lib/markdown-list-continuation.ts`（95 行）

- **(a)** B 支持 `- ` / `1. ` / `1、` / `- [ ]` 在**普通 Enter** 时自动续前缀。B 的实现比 A 完备：
  处理 thematic break（`---` 不是列表）、代码围栏、中文顿号编号、缩进保持。
- **(b)** A **有等价但触发键不同**：`lib/markdown-list.ts` + `ChatInput.tsx:2637`
  绑在 **Shift+Enter** 上（显式换行），且 A 的实现**不含** thematic-break / 代码围栏 / `1、` 判定。
  A 的 Enter 是「发送」，语义上不能同时续行 —— 这正是 B 用「可配置发送键」（G6）解放 Enter 的原因。
- **(c)** 若要补，等 G6 落地后再谈：移植 B 的解析器 + 扩展 A 的用例。
  **工作量 S**（纯函数），但依赖 G6，**建议与 G6 合并做**。

---

### 1.2 已有等价实现（跳过）

| 上游文件 | 上游能力 | A 的等价物 |
| --- | --- | --- |
| `components/OAuthPastePanel.tsx` | 把 ModelsConfig 里「粘贴回调 URL / code」那一坨抽成组件 | A `components/ModelsConfig.tsx:1856-1889` **同样是内联那一块**（文案逐字相同）。B 的动机是 demo 要复用，A 没有 demo。**纯重构，跳过** |
| `components/SelectorRow.tsx` | 选择器行 + 星标「存为默认」 | A 有 `lib/favorite-models.ts`（收藏模型）+ 自己的 `ConfigSidebar*` 行组件。形状不同、目的重合。**跳过** |
| `components/ThemeIcon.tsx` | 主题偏好图标 | A `components/SettingsPanel.tsx:128` **明确注释说已删掉 `ThemeIcon`**，改用设计画板图标集 `components/PwIcons.tsx`。**跳过** |
| `lib/display-path.ts` | `shortenPath` / `displayPathWithin` 抽出成公共模块 | A 在 `AgentsConfig.tsx:120`、`SkillsConfig.tsx:38`、`PluginsConfig.tsx:42` **各内联了一份**同样的正则。重复≠缺失。**跳过** |
| `lib/npm-source.ts` | `npm:pkg@1.2.3` 解析 | A 在 `lib/plugin-updates.ts:46`、`lib/subagents.ts:568`、`lib/subagent-extension.ts:316` 内联了等价正则。**上游是去重，跳过** |
| `lib/tool-call-expansion.ts` | 模块级 Set 记住用户展开的 tool card | A 把 `expandedToolIds` 放在 `components/ChatWindow.tsx:634`（React state，**高于 MessageView**），stream→history 提升时组件不重挂，状态天然不丢。B 需要模块级是因为它的挂载点更低。**等价，跳过** |
| `lib/startup-preferences.ts`(v0.9.3) → `lib/default-preferences.ts` + `app/api/models/default/route.ts` | 「存为默认模型/思考档」+ 项目 `.pi/settings.json` 遮蔽时返回 409 | A `lib/startup-preferences.ts` 走的是另一条路：新会话选择模型时若与生效模型相同就写全局默认。**能力有，落点不同**，而且 B 后来的 `6a1246e`(#871) 反而把「新会话模型选择写进全局默认」去掉了（因为那是反直觉的）。**跳过** |
| `lib/default-cwd.ts` + `app/api/default-cwd/route.ts` | 「用默认目录」每天开一个新文件夹 | A **有同一个路由** `app/api/default-cwd/route.ts`。差别：A 用 `~/pi-cwd-YYYYMMDD`（平铺）+ **UTC** 日期，B 用 `~/pi-cwd/YYYYMMDD`（子目录）+ **本地** 日期。功能等价，细节差异；A 还额外调 `allowFileRoot`。**跳过**（真要改是改 A，不是补缺口） |
| `app/api/open-in-explorer/route.ts` | 在系统文件管理器里打开工作区 (#907) | A **两边都有该路由**，且 `SessionSidebar.tsx:1808` + `ExplorerPanel.tsx:118,132` 都接线了。**跳过** |
| `lib/pi-sdk-internals.ts` + `lib/mcp-transport.ts` | 加载 SDK 未导出的 MCP 模块（连接类/stdio transport/mcp.json 编辑器/OAuth 登录），并给 stdio MCP server 洗掉 `PI_WEB_PASSWORD` | **两端目前都没接线**：`grep -rn createPiWebMcpTransportFactory` 在 B 树里只命中定义文件本身。B 的 `docs/adr/0006-mcp-and-code-mode.md` 明说「Implemented in phases… until P1 lands」。A 的 `app/api/mcp/route.ts` 也只是 mcp.json 的 CRUD + test，**不会在会话里真连 MCP server**。→ 上游是**未启用的地基**，不是现成能力。**跳过** |
| `hooks/useScrollbarVisibility.ts` | 覆盖式滚动条悬停才显形 | A 完全没有 `.scrollbar-subtle` 类，滚动条是系统默认样式。**属于 A 自己的视觉体系**（Codex 皮肤走实心边框，不用 macOS overlay 滚动条）。**无关，跳过** |
| `lib/gfm-autolink-email-loader.test.mjs`、`lib/auth-throttle.test.mjs` 等 20 个 `.test.mjs` | 纯测试文件 | 见 G5 / G7，随宿主能力一起处理。**单独看无缺口** |
| `e2e/pdf-page-fragment.mjs` | e2e：点 markdown 里的 `file.pdf#page=183` 看 viewer iframe URL | A **支持这个功能**（`components/MessageView.tsx:976` 的 `onOpenFile(filePath, page)`）只是没有这条 e2e。**测试缺口，不是功能缺口** |

### 1.3 上游特有、与我们定位无关（跳过）

| 项 | 为什么无关 |
| --- | --- |
| `demo/`（~264 个文件，独立 Next.js 项目 + `demo/mock/*` 全量假后端） | 是给 GitHub Pages 做的**无后端演示站**，用来对外展示上游产品（营销资产）。A 是内部 Electron 桌面 + 局域网自建 fork，没有对外演示站需求。A 的 `docs/screenshots` 已承担对内记录职责。**不补** |
| `.github/workflows/demo-pages.yml` | 只为发布 demo 到 Pages，与 A 无关 |
| G7 密码网关的**云端形态** | 见 G7，边界项 |

---

## 2. A 有而 B 没有的能力（反向缺口）

### 2.1 台账覆盖核对

台账 = `docs/patches/README.md`（编号 0001–0046）+ `docs/codex-skin/delta.md`（按 §N 记的皮肤/布局/功能混合流水）。

**台账已覆盖（patches/README.md 有编号）**：

| A 侧能力 | 台账编号 |
| --- | --- |
| `app/api/usage-stats/` + `lib/usage-stats.ts` + `fork/UsageStatsPanel` | **0025**（ZC-03 本地用量统计） |
| `lib/approval-extension.ts` / `lib/approval-policy.ts` / `lib/permission-mode.ts` / `lib/plan-mode*.ts` | **0009**（工具审批 + 权限档位 + 计划模式） |
| `lib/exploration.ts` + `fork/ExplorationPane.tsx` | **0015**（探索分支 + 结论带回） |
| `lib/cron-history.ts` / `cron-rule.ts` / `cron-failure.ts` / `cron-extension.ts` | **0034 / 0038 / 0040** |
| 会话回退 `app/api/sessions/[id]/rewind` + `lib/session-rewind.ts` | **0010** |
| `lib/subagent-status.ts` | **0016** |
| 会话内查找 `lib/conversation-find.ts` + `fork/ConversationFindBar` | **0021**（ZC-02） |
| 右栏 tab 概览 + 最近关闭 | **0022**（ZC-06） |
| 队列逐条操控 `lib/queue-surgery.ts` | **0006** |
| 附件模型 | **0005** |
| 行内引用（`&`/`#`/`~`） | **0003** |
| 独立聊天工作区 | **0001** |
| 文件树多根 | **0008** |
| cron 模型下拉 | **0013** |

**台账未覆盖（代码里实实在在存在，但两份台账都查不到编号/条目）**：

| 能力 | 落点文件 | 首次提交 | 备注 |
| --- | --- | --- | --- |
| **Electron 桌面打包** | `electron/{main,preload,legacy-user-data}.js`、`lib/desktop-shell.ts`、`scripts/after-pack.mjs`、`package.json` 的 `desktop*` 脚本 + electron-builder 配置 | — | `docs/patches/README.md` 里 electron/desktop **0 命中**。delta.md §30「macOS 原生适配 + 改名 Pi Codex（electron 壳）」和 §「Electron 桌面端已剔除」有**历史**记录，但**当前形态（4 个 electron 文件 + 一整套 npm 脚本）没有可 revert 的条目**。合并上游时最容易漏 |
| **Git 图谱 / 分支 / 提交历史** | `app/api/git/branch/route.ts`、`app/api/git/log/route.ts`、`lib/git-graph*.ts`（7 个）、`lib/git-status.ts`、`components/GitGraphTab.tsx`、`components/GitRefChips.tsx` | `22fa16a release: Pinkslab v0.1.4` | 两份台账都**只在「保留 `lib/git-changes.ts` 基础层」的提醒里被顺带提过一次**，没有独立条目。注意 `app/api/git/diff` 与 `/status` 是上游共有的，A 多出来的是 `branch` + `log` + 整套图谱渲染 |
| **跨 agent 会话/技能/模型/MCP 导入** | `app/api/import/{scan,apply}/route.ts`、`lib/import/`（9 个）、`components/ImportPanel.tsx` | `ac4ec72 feat: 导入 …` | 两份台账**都没有条目**（patches 里 `import` 只出现过 1 次，且是别的东西） |
| **SkillHub 市场** | `lib/skillhub.ts`、`app/api/skills/{skillhub,install-skillhub}/route.ts`、`lib/default-skills.ts`、`app/api/skills/{content,defaults}/route.ts` | `a1d5f75 feat(skills): 接入 SkillHub 市场` | 两份台账 **0 命中** |
| **工作区 Markdown 编辑器 + CodeMirror** | `components/CodeFileEditor.tsx`、`components/MarkdownFilePreview.tsx`、`lib/markdown-file.ts`、`markdown-sync.ts`、`markdown-incremental.ts`、`code-highlight-schedule.ts`、`hooks/useMarkdownFile.ts`、`useLazyHighlighter.ts`（+ `@codemirror/*` 7 个依赖） | `1f4d45a feat(workspace): add workspace Markdown editor` | 两份台账 **CodeMirror 0 命中**。delta.md 只提过「markdown 预览空白」的 bug 修复 |
| **内置浏览器面板 / 多浏览器 tab** | `components/BrowserPanel.tsx`、`components/browser-tab-state.ts`、`lib/fork/PathActions.tsx` | `83f7488` | delta.md §12「栏内展开 + 内置浏览器面板」有**一条流水记录**，但 `docs/patches/README.md` 无编号。算半覆盖 |
| **会话/项目归档** | `components/ArchivedSessionsPanel.tsx`、`components/ProjectArchivePanel.tsx`、`lib/archive-names.ts`、`lib/project-flags.ts` | `a917ffd` | patches **0 命中** |
| **通知偏好 / 语义提示音** | `lib/notification-prefs.ts`、`hooks/useNotificationPrefs.ts`、`lib/sound-presets.ts` | `61807c5` / `f573824` | patches **0 命中**；delta.md 提过「通知」4 次 |
| **文件压缩包（zip/解包）** | `lib/file-archives.ts` + files 路由 `compress`/`extract` | `495e859`（明确写着「移植上游 PR #899」） | 已被 delta.md §「压缩」覆盖过（6 次），但 patches 无编号；且 A 是**从上游 PR 手动移植**的，上游主线若已合入会冲突 |
| **文件 @ 提及** | `lib/file-mentions.ts`、`lib/mention-tokens.ts`、`lib/composer-references.ts` | — | patches **0033** 覆盖了 `&`/`#`/`~`，**`@文件` 提及没有单独条目**（很可能与 0003 同期但没单列）→ **待人工确认** |
| **收藏模型** | `lib/favorite-models.ts`、`components/fork/ProviderUsageCards.tsx` | `22fa16a` | patches **0 命中** |
| **全主题皮肤 / 壁纸 / 皮肤工作室** | `lib/theme-skins.ts`、`lib/wallpaper*.ts`、`hooks/useWallpaper.ts`、`ThemeSkinStrip/Studio`、`WallpaperLayer/Settings`、`app/wallpaper.css`、`app/design/tokens.css` | — | **由 `docs/codex-skin/delta.md` 覆盖**（§18、§26、§31 等），不算漏 |

> **结论**：台账真正缺的是 **Electron 打包**、**Git 图谱**、**跨 agent 导入**、**SkillHub**、
> **CodeMirror 编辑器**、**归档**、**通知/提示音**、**收藏模型** 这 8 块。
> 其中 **Electron 打包**风险最高 —— 它的合并冲突面在 `package.json` + `.gitignore` + 构建脚本，
> 恰好是第 3 节里「合并时会踩」的地方。

### 2.2 其余 A 独有能力（一行一条，指向台账）

- 本地用量统计面板与图表 → **0025**
- 定时任务引擎（`lib/cron-schedule/store/runner/lifecycle/expression/timezone` + `app/api/cron`） → **0013/0034/0038/0040**（基础能力本身记在 `docs/codex-skin/delta.md` §25/§26，无 patches 编号）
- 记忆目录（`lib/pi-memory.ts`、`lib/memory-catalog.ts`、`fork/PiMemoryConfig.tsx`） → **0039**（基础面在 delta.md §25/26/29）
- 工具审批 + 权限档位 + 计划模式 → **0009**
- 会话回退 → **0010**
- 实时过程时间线 / 待办实时化 / 子会话中断态 → **0011 / 0012 / 0016**
- 独立聊天工作区 / 会话 URL 恢复 / 行内引用 / 附件 / 队列操控 / 文件树多根 → **0001 / 0002 / 0003 / 0005 / 0006 / 0008**
- 快捷键内核与设置表、会话内查找、右栏 tab 概览、MCP OAuth 入口 → **0026 / 0021 / 0022 / 0023**
- 折叠动效 / 流式入场 / 滚动渐隐 / 倒计时条 / TabBar 指示器 / FLIP 重排 / 等待态状态行 → **0024 / 0041 / 0042 / 0043 / 0044 / 0045 / 0046**
- 会话分组拖拽、CSV 预览、词级 diff、附件预览、命令管理、空状态引导 → **0031 / 0032 / 0028 / 0029 / 0036 / 0037**

---

## 3. 结构性差异（合并时会踩）

### 3.1 配置文件格式

| | A | B |
| --- | --- | --- |
| Next 配置 | `next.config.mjs`（**JS**，文件头注释解释：TS 配置会让 `next start` 用 SWC 编译，把 `@next/swc-*` 拖进运行时包，~40MB/平台，且另一平台的 binary 不会被安装） | `next.config.ts` |
| 体积上限 | `proxyClientMaxBodySize: resolveMaxBodySize()`（读 `bin/max-body-size.mjs`，可用 `PI_WEB_MAX_BODY_SIZE` 覆盖） | `proxyClientMaxBodySize: "128mb"` 硬编码 |
| Turbopack / webpack loader | **无** | `turbopack.rules` + `webpack()` 各挂一条 `gfm-autolink-email-loader.cjs`（G5） |
| `transpilePackages` | **无** | `["mermaid", "@mermaid-js/parser"]` |
| `images` | 无（`next/image` 未被使用，全是 `<img>` + eslint-disable） | `{ unoptimized: true }`（login 页用 `next/image` 加载 logo） |
| tsconfig | 42 行左右，无 `exclude: ["demo"]` | 显式 `exclude: ["node_modules", "demo"]` |

**踩点**：直接抄 B 的 `next.config.ts` 会毁掉 A 的跨平台打包（§3.3）。G5 的 loader 要用 `.mjs` 重写。

### 3.2 构建 / 运行脚本

| | A | B |
| --- | --- | --- |
| `dev` | `next dev -H 127.0.0.1 -p 30141` | 同 |
| dev/prod 切换 | **额外**：`dev:clean` / `prod` / `mode:status`（`scripts/next-mode.mjs`，在启动前把不匹配的 `.next` 挪到临时目录） | 无。**A 与 B 的 `.next` 产物不兼容，必须先清** |
| 桌面 | `desktop` / `desktop:dist` / `desktop:dist:win` / `desktop:verify` / `desktop:smoke` / `desktop:icons`（electron-builder） | 无 |
| 门禁 | `check:styles` / `check:motion` / `check:icons` / `check:contrast` / `check:design` / `verify:boards` / `verify:boards:seeded` | 无 |
| 单测范围 | `app/ components/ hooks/ lib/ public/ electron/` | `app/ components/ hooks/ lib/ public/` |
| `lint` | `eslint .` | `eslint .`（`eslint.config.mjs` 多一条 `ignores: ["demo/**"]`，A 多一条 `files: ["electron/**/*.js"]` 关掉 `no-require-imports`） |
| `bin/` | `max-body-size.mjs` + 与 B 相同的 6 个 | 无 `max-body-size.mjs` |

### 3.3 依赖版本差异（`dependencies` + `devDependencies`）

| 包 | A | B | 备注 |
| --- | --- | --- | --- |
| `@earendil-works/pi-agent-core` / `pi-ai` / `pi-coding-agent` / `pi-tui` | **0.87.0** | **0.99.1** | ⚠️ **最大风险**。12 个 minor 的 SDK 跨度。B 的 `lib/pi-sdk-internals.ts` 直接按 `dist/extensions/mcp/*.js` 的路径 + 导出名去加载内部模块，这种代码只有 0.99.x 成立 |
| `next` | 16.3.5 | 16.3.6 | |
| `eslint-config-next` | 16.3.1 | 16.3.6 | |
| `semver` | 7.8.0 | 7.8.5 | |
| `undici` | 8.10.0 | 8.11.0 | |
| `@types/mdast` | **缺** | ^4.0.4 | 上游新加 |
| A 独有（`dependencies`） | `@codemirror/{commands,lang-css,lang-html,lang-javascript,lang-json,language,search,state,view}`、`node-diff3`、`tailwind-merge`、`tw-animate-css`、`unified`、`remark-parse`、`remark-stringify`、`remark-frontmatter` | — | A 的编辑器和 diff 是自研的，合并上游不会带进来 |
| B 独有 | — | — | 无（`ansi_up`/`remark-*`/`unified` 在 B 是 devDeps，A 挪进了 dependencies） |

### 3.4 `demo/` 目录

B 有 264 个文件的独立 Next.js 项目（`demo/package.json` 自带 `package-lock.json`，mock 层 `demo/mock/*` 约 30 个文件，
外加 `demo/public/icons/catppuccin/*` 200+ 个 SVG 和 `demo/types/pi-sdk-stubs.d.ts`）。
它**不进 tsconfig / eslint / 主 CI**（B 显式 `exclude` + `ignores`）。
→ 合并时如果整棵树 copy，会多出一份 12MB 级依赖树和一条 Pages 流水线。**建议明确排除。**

### 3.5 CI

| | A | B |
| --- | --- | --- |
| `.github/workflows/ci.yml` | checks（lint/tsc/test）+ e2e（30min timeout）**+ Theme contrast gate（WCAG AA）+ Design gates 静态 + Design gates live（`verify:boards:seeded`）** | checks + e2e（20min），无设计门禁 |
| `.github/workflows/demo-pages.yml` | **无** | 有（只服务 demo） |
| 桌面发布流水线 | **无**（有 `desktop-dmg` / `desktop-release` 分支，但没 workflow） | 无 |

→ A 的 CI **更强**，合并上游时**不要**用 B 的 `ci.yml` 覆盖。

### 3.6 `.gitignore`

B 忽略 `/.agents/`、`/skills-lock.json`；A 额外忽略大量本地目录（`/pi参考项目/`、`/设计风格/`、`/docs/proma-*`、`/docs/zcode-*` …）
并**特意不忽略** `/build/`（electron-builder 的 `extraResources` 要用，注释写明了原因）。
→ 直接覆盖 `.gitignore` 会让 `npm run desktop:dist` 在别人机器上缺图标。

### 3.7 构建产物

- A 有 `tsconfig.tsbuildinfo`、`.next/`、`.scratch/`、`build/`（electron 资源，**进仓库**）。
- B 的 `tsconfig.json` 带 `incremental: true`，同样会生成 tsbuildinfo，但 `.gitignore` 里处理方式不同。
- A 的 `demo` 排除项不存在于 A 的 tsconfig —— 若 copy `demo/`，**必须**同时补 `exclude`，否则 `tsc --noEmit` 会去编译 demo 并炸。

---

## 4. 结论

### 4.1 第 1 节三分

**真实缺口（值得补）** —— 共 10 条，都能指出 A 里「确认无等价实现」的具体位置，且不依赖 SDK 升级：

| 优先级 | 条目 | 理由 | 量 |
| --- | --- | --- | --- |
| P0 | **G5** Safari/iOS 16.2 白屏 | A 的 `node_modules` 里实测就是 2.0.1 + lookbehind，A 无 loader → **A 现在就有这个 bug**，不是「上游特有」 | S |
| P0 | **G3** 扩展 UI 排队 | A 单槽（`useAgentSession.ts:366`），并行工具会互相顶掉且服务端 future 永不 resolve；A 的审批扩展是主流量来源 | M |
| P1 | **G1** Git 决定文件树隐藏 | 跟踪的 `build/` 现在看不见，gitignore 的 `*.log` 现在看得见 | M |
| P1 | **G4** 技能/插件按组全开全关 | A 只有单项开关，连 i18n key 都没有 | M |
| P2 | **G2** 符号链接目录放行 | 克隆仓库里的外链目录是死路 | M |
| P2 | **G6 + G10** 发送键可配 + Enter 续列表 | 两条互相依赖，建议一起做；A 的 `markdown-list.ts` 比 B 少 thematic-break/代码围栏/中文顿号 | S+S |
| P2 | **G9** 压缩中相位文案 | A 已有 `isCompacting`，只差优先级 | S |
| P3 | **G8** 运行中可 fork | A 有一行硬编码禁用，但改动落在 session 写入路径 | S–M |
| 待决 | **G7** 密码网关 | 需先决定 A 是否要支持远程部署 | L |

**已有等价实现（跳过）** —— 12 项。其中 5 项（`OAuthPastePanel` / `SelectorRow` / `ThemeIcon` /
`display-path` / `npm-source` / `tool-call-expansion`）是上游自己的**抽取去重**，A 用内联或另一套实现达成了同一目的；
`default-cwd` / `open-in-explorer` 是 A 两边都有的同款功能（只有路径格式细节差异）；
`pi-sdk-internals` / `mcp-transport` 是**上游自己也还没接线的地基**（ADR 0006 明说 P1 未落地）。

**上游特有、与我们定位无关（跳过）** —— `demo/`（~264 文件的 GitHub Pages 假后端演示站）+ `demo-pages.yml`。
A 是内部 Electron 桌面 + 自建 fork，无对外演示需求；顺带也免掉 §3.4/§3.7 的 tsconfig/eslint/依赖树麻烦。

### 4.2 一句话总览

A 在**用户可见功能上并不落后**：cron、记忆、导入、SkillHub、CodeMirror 编辑器、内置浏览器、
Git 图谱、Electron 打包这些上游完全没有的东西，A 一大堆，且大部分**台账没记**（§2.1 的 8 块）。
A 真正缺的只有 10 条、合计约 **15 人日**，其中 P0 两条（G5/G3）一改就改。
真正的风险不在功能清单，而在 **§3.3 的 SDK 0.87.0 ↔ 0.99.1 差距**和**§2.1 的台账缺口**：
上游大量改动（尤其 MCP、subagent 工具暴露、session 生命周期）都建立在 0.99.x 的 SDK 表面上，
在 0.87.0 上照抄会静默失效 —— 这是下次合并上游必须先解决的前置项，而不是本报告能逐条比出来的。
