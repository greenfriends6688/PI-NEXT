# PI NEXT 下一步计划（2026-10-15）

日期：2026-10-15（第 2 版，含 pi-web 深度对比结论）
范围：独立 Web 版、真登录、移动端品牌、多 Agent 改造、侧栏排序、电脑操控下线、pi-web 借鉴
状态：待执行（部分条目需要用户决策，见 §8）

---

## 0. 一页摘要

| # | 事项 | 真相 | 工作量 | 依赖 |
|---|---|---|---|---|
| 1 | 调用轨迹空白 | **已确诊**：iframe `srcdoc` 的内联脚本被应用 CSP 拦截 | 小 | 无 |
| 2 | 电脑操控 | **整体下线**（你的要求）；根因是 macOS 12 < 要求的 13.0 | 小 | 无 |
| 3 | 独立 Web 版 | 去掉 Electron 的独立 Web 服务端 —— 只需拆 2 个文件的 Electron 依赖 | 中 | 无 |
| 4 | 登录是假的 | `app.pinext.dev` **域名不存在**（NXDOMAIN），服务端从未部署 | 大 | 域名 + 服务器 |
| 5 | 移动端品牌 | 图标**已是** PI NEXT（sha256 同源），只差**大写** | 极小 | 无 |
| 6 | **多 Agent 改造** | **pi-web 的 subagent 明显更好**：后台运行 + 可 steer/resume + worktree 隔离 | 中（4 个 PR） | 无 |
| 7 | **侧栏排序错** | 按 `createdAt`（创建时间）而非 `updatedAt`（活动时间）—— 最新对话沉底 | 极小 | 无 |
| 8 | **回合末尾只有「审查」** | 加「文件」按钮看文件名 → 点开看内容；更优做法是**一个查看器 + 三模式切换**（学 pi-web） | 小（2 个 PR） | 无 |
| 9 | pi-web 借鉴 | 见 §6：**30 条**，含 subagent / 排序 / 分叉导航三块新发现 | — | — |

**三条关键结论**：

- **第 3 项**：`src/agent/main.ts` 已经是一个**不依赖 Electron 的 Node 服务端**，
  `out/main/agent.js` 构建产物已存在，还能 `--port` 指定端口。它现在启动即崩，
  **只因为它间接依赖了 2 个文件里的 `electron`** —— 拆掉就能独立跑。
- **第 6 项**：pi-web **不做「调用轨迹」**（见 §1.5），它把力气花在 **subagent 是完整会话**上：
  `Agent` / `get_subagent_result` / `steer_subagent` 三个工具 + 后台运行 + worktree 隔离。
- **第 7 项**：pi-web 按 `session.modified` 降序（`lib/session-family.ts:68`），
  我们按 `createdAt` 降序（`sidebar.tsx:245`，注释还写着「有意为之」）—— 这是**设计取舍写错了**。

---

## 1. 调用轨迹空白（已确诊，先做）

### 1.1 根因

`src/renderer/src/components/layout/trace-frame.tsx:76`：

```tsx
<iframe sandbox="allow-scripts allow-popups" srcDoc={html} />
```

`srcDoc` 创建的文档**继承父页面的 CSP**。父页面是 `src/renderer/index.html:7`：

```
script-src 'self' 'wasm-unsafe-eval'
```

而 pi 导出的那份 HTML（`exportToHtml` 的产物）**整个 UI 都靠一段内联 `<script>` 构建**：
侧栏树、消息列表、工具栏全在里面。CSP 把内联脚本拒了 → iframe 里永远空白。

### 1.2 实测证据

```
$ node --check <导出 HTML 里抽出的三段 script>     # 三段都通过 —— JS 本身没问题
$ 在 Electron 里复现 srcdoc + 同样 CSP：
PROBE=INLINE-SCRIPT-BLOCKED                       # 内联脚本确实被执行策略拦下
```

导出的 HTML 本身是好的（实测 7.3 MB，`session-data` 占 7.06 MB，内容完整）。
**问题 100% 在承载方式，不在导出。**

### 1.3 修复方向

不要用 `srcDoc`。改用**独立文档 URL**，由我们自己控制响应头 —— 项目里已有成熟的先例：

| 现有实现 | 位置 | 做法 |
|---|---|---|
| 内联 HTML 预览 | `src/main/engine/media-protocol.ts:56` | `pinext-media://` 服务页面，**自己加 `INLINE_HTML_CSP`**（`src/shared/media-preview.ts:80`），不信上游的头 |
| 独立 HTML 文档 | `src/shared/media-preview.ts` | `INLINE_HTML_CSP` = `script-src 'unsafe-inline' 'unsafe-eval' https:` |

**做法**：把导出 HTML 写到会话目录下的一个临时文件，通过 `pinext-media://` 打开，
沿用同一套 `INLINE_HTML_CSP`（允许内联脚本，禁本地文件读写、禁表单提交）。
iframe 保持 `sandbox="allow-scripts"`（**不加 `allow-same-origin`**，导出页碰不到应用存储）。

### 1.4 PR

**PR-A1** `fix(trace): 调用轨迹用独立文档承载导出页，绕开应用 CSP`

- 改 `trace-frame.tsx`：`srcDoc` → `src=mediaPreviewUrl(...)`
- 改 `process-manager.ts:3083` `exportHtmlDocument()`：写到磁盘并返回路径（现在返回字符串）
- 补 `test/` 一个断言：导出的 HTML 含 `session-data` 且可被 `pinext-media://` 服务
- 验收：打开「调用轨迹」能看到完整历史（侧栏树 + 消息 + 工具输出）；刷新与全屏仍可用

> 顺带：SDK 的 `generateHtml` 有一个 `String.replace` 未转义 `$&` 的小瑕疵
> （`dist/core/export-html/index.js:116`，`highlight.min.js` 里含 `$&`）。
> 实测**不影响功能**（它落进了一个正则字符类里，语法仍合法），
> 但值得给上游提 issue。

### 1.5 pi-web 是怎么做「调用轨迹」的？——答案是：**它不做**

我把参考项目从头翻了一遍：

```
$ grep -rln "trace\|Trace" 参考项目/pi-web-0.12.1/{components,lib,app}
（无结果）
```

**pi-web 没有「调用轨迹」这个功能，也导出一个可浏览的 HTML 页面。**
它的 `app/api/sessions/[id]/export/route.ts`（282 行）产出的是**下载用的导出文件**，
不是右栏里嵌的浏览视图。

它用**两个更好用的东西**替代了我们想要的效果：

| pi-web 的做法 | 位置 | 作用 |
|---|---|---|
| **SessionTree（会话树）** | `components/SessionTree.tsx`（1071 行） | 侧栏里的**分叉树**：一条消息上可以有多个后续分支，树形展开、可跳转 |
| **BranchNavigator（分支导航）** | `components/BranchNavigator.tsx`（449 行） | 在**当前会话内**前后切换分支（← 兄弟 / → 兄弟 / ↑ 父），带 `locked`（运行中禁用） |

而「看清某次运行做了什么」，它靠的是**左栏 TurnRail**（回合轨）+ 会话内的工具卡，
也就是我们现在**已经有**的东西。

> **结论**：我们那个「调用轨迹」tab 是**独有功能**，pi-web 没有可抄的实现。
> 修好它（PR-A1）之后，真正的启示是 **pi-web 的 SessionTree / BranchNavigator 值得补**
> （见 §6 M7）—— 那才是「看清分叉历史」的正解，比嵌一个静态导出页更有用。

### 1.6 pi-web 的导出路由里有个我们能直接抄的补丁

`参考项目/pi-web-0.12.1/app/api/sessions/[id]/export/route.ts` 做了一件**防御性**的事：

> 把 pi 导出模板里的**递归函数替换为迭代版**，以支持 5000+ 条的长链（否则爆栈）。

我们的会话动辄 1800+ 条（实测最大的一个转写 10.5 MB），长链爆栈是**真实风险**。
建议在 PR-A1 里一并加上同类防护（或至少在导出前对超长链做长度检查与提示）。

---

## 2. 电脑操控：整体下线

> 你的要求：「电脑控制先帮我整体去掉吧」。原计划只是改善报错文案，现改为**移除整个功能**。

### 2.1 为什么可以放心下线（技术背景）

根因是系统版本，不是代码 bug：

```
报错：Symbol not found: (_$s10Foundation22_convertErrorToNSErrorSo0E0CSgOC_pF)
你的系统：macOS 12.7.1 (Build 21G920)
dylib 要求：minos 13.0          ← otool -l 实测
```

`libcua_driver_sdk.dylib` 是 **macOS 13.0+** 编译的，它引用的 Swift 运行时符号
`Foundation.convertErrorToNSError` 在 macOS 12 的 Foundation 里**不存在**。
`cua-driver 0.28.2` 是当前最新版，换版本解决不了。

**也就是说：这个功能在你这台机器上无论如何都用不了，下线是合理选择，不是损失。**

### 2.2 需要移除的范围（已盘点）

我按 `cua` / `computer_` / `computerEnabled` 做了全仓匹配（注意：`src/main/rtc/*`、`remote*`
只是因为含「这台电脑」字样而命中，**不属于**本次范围）：

| 类别 | 文件 | 处理 |
|---|---|---|
| **设置界面** | `src/renderer/src/components/settings/computer-settings.tsx` | 删除文件 |
| | `settings-sections.tsx:36,90`（`SectionId` + 菜单项） | 移除 `"computer"` |
| | `settings-dialog.tsx:36,433` | 移除 import 与渲染分支 |
| **主进程桥** | `src/main/pi/cua-bridge.ts` | 删除 |
| | `src/main/pi/cua-component.ts` | 删除 |
| | `src/main/pi/computer-grant-flow.ts` | 删除 |
| | `src/main/pi/computer-task-runner.ts` | 删除（同时移除 `index.ts:28` 的 `installComputerTaskGlobal`） |
| **下载器** | `src/main/engine/cua-driver-install.ts` | 删除 |
| | `src/main/engine/cua-driver-spec.ts` | 删除 |
| | `src/main/engine/asar-unpacked.ts`（若只服务 cua） | 核查后删 |
| **扩展** | `resources/extensions/computer-use.ts` | 删除 |
| | `extension-manager.ts:22`（`pinext:computer-use`）、`:54`（`BUILTIN_SKILLS` 里的 `computer-use`） | 移除 |
| | `resources/skills/computer-use/` | 删除（整目录） |
| **决策层** | `src/main/engine/decision/computer-observation.ts` | 删除 |
| | `src/main/pi/decision-task-runner.ts`、`src/shared/decision.ts` | 摘掉 computer 分支 |
| **IPC** | `src/shared/ipc.ts:195-213`（12 个 `computer:*` 通道） | 移除 |
| | `src/main/ipc/desktop-handlers.ts:131-153`、`:634-635`、`:669` | 移除 |
| **类型/策略** | `src/shared/computer-availability.ts` | 删除 |
| | `src/shared/remote-policy.ts`（`computer:*` 条目） | 移除（注意 `assertPolicyCoverage` 会拒绝启动） |
| | `src/shared/types.ts`（`ComputerAppInfo` 等） | 移除 |
| | `src/shared/inline-media.ts` | 摘掉 `computer_*` 的排除项 |
| **渲染层** | `src/renderer/src/lib/tool-presentation.tsx`、`lib/tool-run.ts` | 摘掉 computer 工具族 |
| | `src/renderer/src/stores/settings.ts` | 摘掉 `computerEnabled` |
| **设置项** | `app-settings.ts` 的 `computerEnabled` | 退役该键（读时忽略，不报错） |
| **构建** | `electron-builder.yml:200`（Linux 排除注释） | 更新 |

> ⚠️ **两处容易踩的坑**：
> 1. `remote-policy.ts` 的 `assertPolicyCoverage` 会在「有方法没分类」时**拒绝启动服务** ——
>    移除 IPC 通道时必须同步移除 policy 条目，两边一起改。
> 2. `app-settings.ts` 里退役 `computerEnabled` 要**读时忽略**，不能让老用户的
>    `settings.json` 里残留这个键导致解析异常。

### 2.3 PR

**PR-A2** `refactor(computer): 移除电脑操控`
- 按 §2.2 表格删除
- 保留「决策引擎」的其他能力（`computer-observation.ts` 之外的部分不动）
- 验收：`pnpm typecheck` 通过；`pnpm test` 通过；app 能启动；设置里没有「电脑操控」一节；
  `pnpm dev` 无 `cua` 相关日志

> **保留余地**：`git` 历史里永远能找到这些文件。若将来升级到 macOS 13+，`git revert` 即可。
> 因此建议**独立成一个 commit**，不要在别的 PR 里顺手删。

---

## 3. 独立 Web 版（去掉 Electron，像 pi-web 一样独立启动）

### 3.1 你要的形态

- ❌ 不是「在设置里加个开关」
- ❌ 不是开机自启
- ✅ **一个独立的服务端，自己启动、自己占端口**，浏览器打开就是完整的 PI NEXT
- ✅ 像 `npx @agegr/pi-web` 那样：一条命令跑起来

### 3.2 现状：比预期近得多

仓库里**已经有**这个服务端的骨架：

| 组件 | 位置 | 状态 |
|---|---|---|
| 无 Electron 的 Node 入口 | `src/agent/main.ts` | ✅ 存在，有 `--port` / `--data-dir` / `--host` |
| 构建产物 | `out/main/agent.js`（27 KB） | ✅ 已构建 |
| `bin` 声明 | `package.json` → `pinext-agent` | ✅ 存在 |
| 浏览器前端 | `src/renderer/web.html` + `web-main.tsx` + `web-bridge.ts` | ✅ 存在（WebSocket 传输） |
| 构建产物 | `out/renderer/web.html` | ✅ 已构建 |
| 静态服务 | `RemoteServer` 的 `#serveWeb` | ✅ 存在，壳页优先回落 `web.html` |

**实测：它今天就能构建，但启动即崩：**

```
$ node out/main/agent.js --data-dir /tmp/x --port 7899
SyntaxError: Named export 'nativeTheme' not found. The requested module 'electron' is a CommonJS module...
  at out/main/chunks/runtime-BnR52ReB.js:14  →  import { nativeTheme } from "electron";
```

### 3.3 障碍：只有 2 个文件

我从 `src/agent/main.ts` 出发做了一次完整的依赖图扫描（179 个文件）：

```
扫描文件数: 179
间接依赖 electron 的文件数: 2
```

| 文件 | 用法 | 难度 |
|---|---|---|
| `src/main/ipc/registry.ts:1` | `import type { BrowserWindow } from "electron"` —— **纯类型，编译后消失** | 极易 |
| `src/main/engine/app-settings.ts:2` | `nativeTheme`（真实调用，仅 2 处：`:128`、`:149`） | 易 |

**这就是全部障碍。** 拆掉它们，`node out/main/agent.js` 立刻能跑。

### 3.4 PR 拆分

#### PR-B1 `refactor(core): 把 electron 从核心路径上摘掉`
**这是独立 Web 版的地基，也是唯一有技术风险的一步。**

- `registry.ts`：`BrowserWindow` 改为结构化类型（`{ id: number; webContents: ... }`），
  或抽一个 `CallerWindow` 接口 —— 远程调用者本来就是 `null`，不需要真 Electron 类型
- `app-settings.ts`：把 `nativeTheme` 的 2 处调用抽成可注入的 `ThemeProvider`：
  - Electron 宿主注入真实的 `nativeTheme`
  - Web/Agent 宿主注入一个读 settings 的纯实现
- 给 `electron` 加一个 **构建期别名**，让 agent 那份产物把 `electron` 变成 stub
  （`electron.vite.config.ts` 主进程已有两份入口 `index` / `agent`，可分别配置 external）
- 验收：`node out/main/agent.js --port 7899` 成功启动；`/api/hello` 返回 JSON；
  浏览器打开 `http://127.0.0.1:7899` 看到工作台

#### PR-B2 `feat(web): 修浏览器里的媒体与图标 URL`
**唯一的真功能阻塞点。**

桌面端用两个 Electron 专有 scheme：

| 用途 | 桌面 | 浏览器里不存在 |
|---|---|---|
| 媒体（图片/视频/PDF） | `pinext-media://media/play?path=` | `protocol.handle`（`media-protocol.ts:20`） |
| 文件图标 | `pinext-icon://icons/<name>.svg` | `protocol.handle`（`file-icons.ts:90`） |

浏览器版 `web.html:7` 的 CSP 已刻意删掉了这两个 scheme。

改法：
1. 新增 `lib/media-base.ts`：按宿主分流（桌面 → 原 scheme；浏览器 → `/api/media`、`/icons/`）
2. 服务端补 `/icons/<name>.svg` 路由 —— `fileIconsDirectory()`
   （`src/main/engine/file-icons.ts:48`）**已导出但全仓无调用者**，正好是它的用途
3. 解决 `<img src>` 带不了 `Authorization` 头：给同源页面签发
   `HttpOnly + SameSite=Strict` cookie，`#authorizeMedia`（`server.ts:855`）同时接受它
   —— `isOwnOrigin`（`server.ts:1068`）已经建立了「同源页面可信」的概念
4. `components/file-icon.tsx:31`、`shared/inline-media.ts:96` 改为读上面的基址

验收：浏览器里图片显示、文件图标显示、Markdown `![]()` 显示。

#### PR-B3 `feat(web): 独立启动 —— CLI 与端口`
- `package.json` 加 `"web": "node out/main/agent.js --port 7800"`（或类似）
- 让 agent 入口默认**服务 Web**（现在它面向 SSH 隧道 + 手机，`policyScope: "subset"`）
  可能需要一个 `--web` 模式：`HEADLESS_CAPABILITIES` + `webRoot` + 不限 loopback
- 打印可访问地址（像 pi-web 那样自动开浏览器可选）
- 验收：`pnpm web` → 浏览器打开 `http://127.0.0.1:7800` → 完整工作台

#### PR-B4 `feat(web): 浏览器端能力降级`
- `lib/platform.ts` 加 `IS_WEB`
- `HAS_CUSTOM_TITLE_BAR` 在 Web 下为 `false`（现在会在浏览器里画无意义的窗口控制栏）
- `side-pane.tsx:327` 的 `openCapable` 对 Web 也生效（`<webview>` 浏览器没有等价物）
- 设置里 `remote` / `ssh` / `computer` / `browser` / `update` 相关行在 Web 下隐藏
  （`remote-policy.ts` 已经拒绝这些方法，只是少一次失败提示）

#### PR-B5 `feat(web): 浏览器侧文件上传`
现在浏览器拖入普通文件会**静默失效**：`lib/attachments.ts:130` 只收 `path` 非空的文件，
而浏览器取不到 `path`（`pathForFile` 返回 `undefined`）。
需要 `shared/api.ts` 加显式 `uploadAttachment(bytes)` → 走
`MessageTransport.setBinaryAttachments`（这条通道已存在，`shared/binary-attachment.ts`，
目前只有 RTC 在用）。

#### PR-B6 `feat(web): PWA 外壳`
manifest + Service Worker + 离线页。参考项目的 `public/sw.js` 只有 183 行，成本极低。

---

## 4. 真登录（需要你部署服务端）

### 4.1 现状：客户端是真的，服务端不存在

```
$ host app.pinext.dev
Host app.pinext.dev not found: 3(NXDOMAIN)     ← 域名不存在
$ host app.fastvibe.dev
app.fastvibe.dev has address 104.21.17.193     ← 上游这个是真的（Cloudflare）
```

你截图里那个 URL 的每一个参数（`client_id=pinext-desktop`、`redirect_uri=http://127.0.0.1:55900/callback`、
`code_challenge`、`state`、`device_name`、`platform=darwin`）都是
`src/main/engine/account.ts:76` 的 `authorizeUrl()` **正常生成**的 —— 客户端逻辑完全正确。

**「假的」的意思是：那个域名背后没有服务器。**

### 4.2 登录后到底有什么用

这是必须先讲清楚的，因为**它不配置任何模型**（`AGENTS.md` 明确写了「登录只表明这台电脑是谁的」）。

| 用途 | 说明 | 现在能用吗 |
|---|---|---|
| **官方连接（手机远程）** | 手机和电脑登录**同一账号**，自动互相发现，走 WebRTC 直连或中转。**不需要密码、不需要同一网络** | ❌ 需要云 |
| 设备列表 | 「我的设备」里看到账号下所有电脑 | ❌ 需要云 |
| 中转配额 | 跨网络时用 Pinext 的 TURN 中转（有月度额度） | ❌ 需要云 |
| 模型转发 | `/llm` 网关（未来） | ❌ 未实现 |
| 局域网连接 | 扫码 + 密码 | ✅ **不依赖账号，现在就能用** |
| SSH 主机 | 桌面连服务器 | ✅ 不依赖账号 |

**所以：如果你只用「同一网络下手机扫码连接」，登录可以先不做。**
登录的价值是「不在同一网络也能连」（比如在公司连家里的电脑）。

### 4.3 部署到 Vercel 可以吗？—— 分两部分，结论不同

契约（`docs/pinext-cloud-contract-2026-10-13.md`）要求 8 个端点：

| 端点 | Vercel 能做吗 |
|---|---|
| `/authorize`、`/api/oauth/token`、`/api/me`、`/api/auth/logout` | ✅ **能做**，标准 Serverless 函数 |
| `PUT/GET /api/devices` | ⚠️ 能做，但**需要外部数据库**（Vercel 文件系统是临时的） |
| `GET /api/rtc/ice` | ✅ 能做（返回 STUN/TURN 列表） |
| **`WS /api/rtc/signal`** | ⚠️ **Vercel 的 WebSocket 是 Public Beta**，且连接会**钉在单个实例**上 |

**判断**：
- **只做「登录」**（`/authorize` + `/api/oauth/token` + `/api/me`）：**Vercel 完全够用**，
  这是最小可用集，能让你看到「已登录」和头像
- **加上「官方连接」**（信令 + 设备列表）：Vercel **勉强能用但有风险** ——
  WebSocket beta、实例钉住、需要外部 Redis/数据库存设备与在线状态

**推荐路线**（三步走，每步都能停）：

```
第 1 步（Vercel 即可）：登录 + /api/me        → 「已登录」是真的
第 2 步（Vercel 即可）：+ 设备登记（用外部 KV）→ 能看到设备列表
第 3 步（建议换平台）：+ 信令 WS              → 手机跨网络能连
```

第 3 步建议换成**能跑长连接驻留进程**的平台（Fly.io / Railway / 一台 VPS），
因为信令是**长连接**且要求「绝不转发给第三方」——见契约 §3 与 §附录 B 的硬要求：
「服务端**不需要**解析 SDP，但**绝不能**把 `signal` 转发给 `cid` 两端之外的人」。

### 4.4 PR 拆分

- **PR-C1** `docs(cloud): 把契约变成可执行的部署清单`
  产出一份逐端点的 `curl` 验收脚本 + 最小可用集说明 + Vercel 落地指南。
  **这一步不需要你提供任何东西，可以立刻做。**
- **PR-C2** `feat(cloud): 最小可用云端（登录部分）`
  实现第 1 步的三个端点。放哪需要你定（见 §8）。
- **PR-C3** `feat(cloud): 设备登记与信令`
  里程碑式推进，依赖平台选择。

### 4.5 要做的准备（你来）

1. 一个**域名**（`app.pinext.dev` 需要购买 DNS 并指向部署平台）
2. **GitHub OAuth App**：契约 §2 的 `/authorize` 要「用 GitHub 登录」。需要：
   - `Client ID` / `Client Secret`（github.com/settings/developers）
   - 回调地址填部署后的站点
3. 一个**部署平台**（Vercel 或 VPS）
4. 客户端**不用改代码** —— `PINEXT_CLOUD_URL` 环境变量可以指向任何 origin
   （`src/main/account.ts:15` 读它，桌面端与移动端都支持）

---

## 5. 移动端：logo 与品牌

### 5.1 好消息：图标已经换好了

我核对了 sha256 —— 移动端的图标资源**已经是 PI NEXT 的**，与桌面端同源：

```
apps/mobile_flutter/assets/brand/icon.png  ef1e791fe2112b73  (1024×1024)
resources/icon.png                          ef1e791fe2112b73   ← 同一个文件
apps/mobile_flutter/assets/icon.png        37e63a6a1ae0325a  (256×256)
src/renderer/src/assets/pinext-mark.png    37e63a6a1ae0325a   ← 同一个文件
```

显示名也已经是 `Pinext`（Android `AndroidManifest.xml:14`、iOS `Info.plist:15,23`），
`grep -r "FastVibe" apps/mobile_flutter` **零命中**。

### 5.2 要做的：大写 + 版本对齐

**PR-D1** `chore(mobile): 品牌统一为 PI NEXT`
- `AndroidManifest.xml` `android:label="Pinext"` → `"PI NEXT"`
- `Info.plist` `CFBundleDisplayName` / `CFBundleName` → `PI NEXT`
- `ios/Runner/{en,zh-Hans}.lproj/InfoPlist.strings`（权限说明里的「Pinext」→「PI NEXT」）
- `tool/i18n/zh.json` + `en.json` 里的品牌词（约 20 处），重跑 `node tool/gen_i18n.mjs`
- **保持不动**：`assets/`、keychain 键名（`pn.key.*`）、method channel 名 —— 改了会丢已存凭据

**PR-D2** `feat(mobile): 更新到上游 app-v0.5.8`
本地代码 = 上游 **v0.5.7**（`pubspec.yaml` 版本号停在 `0.5.6+506` 是改名时漏改）。
v0.5.8 只做三件事：
- 大帧离主线程解码（`Isolate.run`）
- 流式重绘 33ms + 结果缓存
- 玻璃默认降档 + 低内存设备默认开启「减少玻璃效果」

外加：`pubspec.yaml` → `0.5.8+508`、补三个缺失的 `.gitignore`、
补 `docs/release/app-v0.5.7.md` 与 `app-v0.5.8.md`

**PR-D3** `fix(mobile): 修未替换的占位符`
```dart
// lib/update/release.dart:19 —— 占位符没替换，导致 App 自更新检查拿不到版本
releaseRepo = 'YOUR_GITHUB_OWNER/pinext';   // 应改为真实的 owner/repo
```
`tool/create-release-keystore.sh:19` 同样问题。

### 5.3 iOS 出包

好消息：`.github/workflows/mobile-ios.yml` **已经是完整的 IPA 流水线**
（`flutter build ipa --release --no-codesign` + `xcodebuild -exportArchive`）。

**PR-D4** `chore(ios): 接通 IPA 产出`
- 配置仓库 secrets：`APPLE_API_KEY_P8` / `APPLE_API_KEY_ID` / `APPLE_API_ISSUER` / `APPLE_TEAM_ID`
- ⚠️ `docs/ios-free-signing.md` 描述的是一个**已不存在的 Capacitor 工程**（`npx cap sync ios`、
  `ios/App/App.xcodeproj`），与现在的 Flutter 工程不符 —— 应删除或重写

---

## 6. 参考项目（pi-web 0.12.1）借鉴清单

> 参考项目：`参考项目/pi-web-0.12.1` —— Next.js + 浏览器 UI，同一个 pi SDK，
> `npx @agegr/pi-web` 一条命令在浏览器里跑。
> **它的「Web 版」本质是：SDK 会话跑在 Node 服务端进程里，HTTP + SSE 暴露给浏览器。**

### 6.1 高优先级（Web 版、多 Agent、排序）

| # | 借鉴点 | 参考项目怎么做的 | 我们的差距 |
|---|---|---|---|
| H1 | **服务端会话管理** | `lib/rpc-manager.ts:2527` `createAgentSessionServices()` 在 Node 进程内建会话；`globalThis.__piSessions` 注册表（hot-reload 安全）；空闲回收默认 10 分钟（`:166`）；启动锁 `__piStartLocks`（`:2115`） | `PiProcessManager` 已有等价能力，但绑在 Electron Main 上 |
| H2 | **SSE 背压两档** | 512 KiB 软水位**丢可重建事件**（`_delta`、`tool_execution_update`，`agent-event-stream.ts:57`）；16 MiB 硬上限直接断流让客户端重连重取快照（`:211`）；心跳 30s | 我们有 `server/backpressure.ts`（2 MiB 软 / 32 MiB 硬），但**没有「可丢弃事件」分类** —— 值得引入 |
| H3 | **`tool_execution_update` 合并 150ms** | `TOOL_UPDATE_COALESCE_MS`（`:48`），每个 toolCallId 只留最新一条 | 没有 —— 工具高频输出时能省大量带宽 |
| H4 | **事件白名单投影** | `agent-event-wire.ts:120` 丢掉 `turn_start`/`turn_end` 并截断 codemode 的 `details.calls` 到 200 条 | 有类似的 `slimStreamEvent`，但没做 codemode 截断 |
| H5 | **终端 offset + 续传** | `lib/terminal-manager.ts:29` 128 KiB 环形缓冲，每条输出带单调 `offset`；重连按 `Last-Event-ID` 只补缺失后缀（`:144`）；断连后保留 120s lease | **我们没有** —— 断线重连丢历史。我们已有 `terminal-sessions.ts`，可对照补 |
| H6 | **PWA 全链路** | `app/manifest.ts` + `public/sw.js`（183 行）+ `offline.html` + `lib/web-push.ts`（VAPID）；SW 里 `/api/*` **永不缓存**、导航 8s 超时落离线页 | 完全没有（见 PR-B6） |
| H7 | **多字节上传** | `app/api/files/[...path]/route.ts:39` 单文件 25 MiB / 总 100 MiB；`lib/file-upload.ts:60` 同目录 staging + `rename` 原子替换，**拒绝符号链接** | 见 PR-B5 |
| H8 | **文件变化 watch** | `type=watch` SSE + `(mtimeMs, ctimeMs, ino, size)` 四元组去抖 | 没有 —— 右栏文件预览不会自动刷新 |
| **H9** | **多 Agent 是完整会话** | `Agent` / `get_subagent_result` / `steer_subagent` 三工具；后台运行 + 完成通知；resume；worktree 隔离 | **只读侦察发现了这个，详见 §7** —— 这是本轮最重要的新发现 |
| **H10** | **会话列表按活动时间排序** | `lib/session-family.ts:68` `b.latestModified - a.latestModified`（降序），而且是**家族级**（父 + 子 agent 取最大） | **详见 §8** —— 我们用 `createdAt`，最新对话沉底 |
| **H11** | **分叉导航（SessionTree + BranchNavigator）** | `SessionTree.tsx`（1071 行）树形分叉视图 + `BranchNavigator.tsx`（449 行）会话内兄弟分支切换（带运行中锁定） | 我们只有回合轨（`turn-rail.tsx`），没有分叉树 |
| **H12** | **文件查看器三模式切换** | `FileViewer.tsx:66` `"source" \| "preview" \| "diff"` 分段切换；只在有 diff 时出现 `Diff` 格（`:1601`）；调用方只传 `modeHint`（`file-tab-state.ts:36`） | **详见 §9** —— 我们现在「审查」和文件名都只能进 diff |

### 6.2 中优先级（能力补齐）

| # | 借鉴点 | 说明 |
|---|---|---|
| M1 | **模型真测** | `app/api/models-config/test/route.ts`（120 行）：`completeSimple` 打一发，20s 超时，回 latency/status/text。**我们已经定义了 `Ipc.providersTest`（`src/shared/ipc.ts:268`）但没有 handler 也没有 UI** —— 补上即可 |
| M2 | **音频预览** | `shared/media-preview.ts:48` 只有 `image \| video \| pdf`，缺 `audio` |
| M3 | **DOCX 渲染** | 参考项目用 `mammoth.convertToHtml`；我们只抽纯文本 |
| M4 | **MCP OAuth 登录** | `lib/mcp-sign-in.ts`：PKCE + 发现 + 动态注册 + 回环回调 + 粘贴兜底。我们只有手动 headers 令牌 |
| M5 | **技能市场** | `app/api/skills/search`（skills.sh）+ `install` + 更新检查。我们只有本地列表与创建 |
| M6 | **`!` bash 模式 + 工具预设** | `lib/tool-presets.ts`（none/read-only/default/full）+ `lib/chat-only.ts`。纯逻辑模块，可移植并加单测 |
| M7 | **分支导航面板** | `components/BranchNavigator.tsx`：迭代 DFS（防长链爆栈）+ 运行中锁定。我们只有回合轨。**已升到 H11** |
| M8 | **bash 大输出独立路由** | 输出超长时单独取，不塞进事件流 |
| M9 | **繁体中文** | 我们只有 `zh` / `en` |
| **M10** | **`notifyParent` 的去重细节** | 已用 `get_subagent_result` 收过的不重复通知；标记用 `sessionId + completedAt`（不用纯 `sessionId`，因为 `resume` 复用 id） | 直接用在 PR-E1 |
| **M11** | **通知前缀放代码不放 prompt** | `SUBAGENT_NOTIFICATION_PREFIX` 是常量。放 prompt 里模型可能丢掉，导致压缩时报告被归到用户 Goal 下 | 直接用在 PR-E1 |
| **M12** | **profile 参数边界** | `thinking` / `max_turns` / `inherit_context` 由 profile 决定，**不接受模型传参**（防模型猜一个 `max_turns: 8` 静默丢掉 profile 的设定） | 用在 PR-E4 |
| **M13** | **文件 tab 的去重语义** | `openFileTab`（`file-tab-state.ts:67`）：已存在的 tab 且无变化时**直接返回原数组**，避免无意义的 re-render；`modeHint` 在已有 tab 上会**改过去**（不只初次生效） | 用在 PR-G3 |
| **M14** | **长路径只截目录不截文件名** | `FileExplorer.tsx:597-600` 把路径拆成 `dirPart` / `baseName` 分别渲染，只省略目录 | 用在 PR-G1（几行代码） |

### 6.3 低优先级 / 形态不同

| # | 借鉴点 | 说明 |
|---|---|---|
| L1 | Playwright e2e | 它是 Next.js 单进程，接入成本低；我们是 Electron 三进程 + 移动端。建议只对 Web 版做 smoke |
| L2 | 字体族/字重设置 | 我们固定 Instrument Sans + 根字号缩放 |
| L3 | ChatMinimap（36px 缩略导轨） | 体验细节 |
| L4 | 完成提示音 | `hooks/useAudio.ts` |
| L5 | 长链导出补丁 | 它把 pi 模板里的递归函数换成迭代版，修 5000+ 条长链爆栈。**建议直接用在 PR-A1** —— 我们最大的转写已 10.5 MB |
| L6 | `proper-lockfile` | 跨进程共享 pi 目录时的写入一致性。我们只有 `transcript-file.ts` 的原子写 |
| **L7** | **子 agent 的 `exposure: "model-only"`** | 防止 codemode 脚本启动子 agent。原因：脚本启的 run 会把嵌套 call id（`<codemode call>/<n>`）记成 `parentToolCallId`，而转写里没有这个条目 —— 聊天的链接断了 | 用在 PR-E4 |
| **L8** | **导出的防御性补丁** | `app/api/sessions/[id]/export/route.ts` 把 pi 模板里的递归函数换成迭代版，因为 5000+ 条长链会爆栈 | 同 L5 |

### 6.4 我们比参考项目**更强**的地方（不用抄）

- 主题：24 个（含亮暗各 12）+ 玻璃效果 + 界面字号 vs 它的 6 个
- Provider 额度：多网关支持（`providers:quota` / `gateway-balance`）
- 移动端：完整 Flutter App + WebRTC 官方连接（它没有原生端）
- 记忆系统、DAG 任务编排、决策引擎、标书套件：它都没有
- 远程访问：局域网 + mDNS + SSH 隧道 + 官方连接四条路

---

## 7. 多 Agent 改造（pi-web 的方案更好）

> 你的要求：「帮我看看 piweb 的多 agent 代理的东西，帮我改一下现在内置的多 agent，
> 我觉得 piweb 的好」。我逐行读了两边的实现，**你的判断是对的**。

### 7.1 两边的根本区别

| | pi-web | PI NEXT（现在） |
|---|---|---|
| 工具名 | `Agent` + `get_subagent_result` + `steer_subagent` | `subagent`（单一） |
| 子会话身份 | **完整、可检视的 pi 会话**，有 session id | 一次性运行的容器，无独立身份 |
| 后台运行 | ✅ `run_in_background`，完成时**通知父会话** | ❌ 只能前台等 |
| 运行中干预 | ✅ `steer_subagent` 注入消息 | ❌ 完全不能 |
| 继续已结束的 | ✅ `resume`（保留 profile / model / thinking / context） | ❌ 只能重开 |
| 结果获取 | ✅ `get_subagent_result({ wait })` 轮询式 | 只在 toolResult 里返回 |
| 隔离 | ✅ `isolation: "worktree"`（真 git worktree） | ❌ 同一工作区 |
| 内置 profile | 3 个：`general-purpose` / `explore` / `plan` | 4 个：`explorer` / `planner` / `reviewer` / `worker` |
| profile 可开关 | ✅ `disabledBuiltIns`（不删文件） | ❌ 只能删 `.md` |
| 参数设计 | profile 决定 `thinking` / `max_turns` / `inherit_context`，**模型不能猜** | 部分参数可由模型传 |
| 编码模式交互 | 用 `exposure: "model-only"` 禁止脚本调用（因为脚本的 call id 在转写里没对应条目） | 无此防护 |

### 7.2 pi-web 最值得学的四点

**① 子 agent 是一个会话，不是一次函数调用**

这是全部差异的根源。pi-web 的 `SubagentRunInfo` 有 `sessionId`，子会话有完整转写，
父会话可以通过 id 反复查它（`get_subagent_result`）甚至继续它（`resume`）。
我们现在是「发出去、等回来」，发出去之后就是黑箱。

**② 后台运行 + 完成通知（真正的并行）**

pi-web 的 `notifyParent`：后台跑完发一条 `custom` message 给父会话，
前缀用常量 `SUBAGENT_NOTIFICATION_PREFIX`（**放在代码里，不放在 prompt 里**，
否则模型可能把前缀丢了，导致压缩时报告被归到用户的 Goal 里）。
而且它很细致：**父会话已用 `get_subagent_result` 收过结果就不再重复通知**（用 `sessionId + completedAt` 标记，
不用纯 `sessionId`，因为 `resume` 会复用 id）。

**③ 可 steer —— 运行中能改方向**

`steer_subagent({ agent_id, message })` 把消息注入运行中的子会话
（「Instruction to inject after the current tool execution」）。
这解决了一个真实痛点：子 agent 跑偏了你只能等它跑完或杀掉重来。

**④ profile 设计得克制**

pi-web 只给三个内置 profile，且 `systemPrompt` 都**很短**：

```
general-purpose: "Work autonomously on the delegated task. Keep the final answer concise
                  and include important files, decisions, and remaining risks."
explore:         "Explore the codebase to answer the delegated question. Do not modify files.
                  Report concrete findings with file paths and relevant symbols."
plan:            "Produce an implementation-ready plan for the delegated task. Inspect the
                  repository as needed, do not modify files, and call out dependencies, risks,
                  and verification steps."
```

对比我们的 `explorer.md`（~70 行）、`planner.md`、`reviewer.md`、`worker.md` ——
我们写的是**完整提示词工程**，它写的是**一句话职责**。

> 这不一定谁对谁错：我们的详细格式约束（「## Files Retrieved / ## Key Code / ## Connections」）
> 确实能让输出更结构化。但代价是**冗长**且**难改**。
> 建议：**保留我们的四个角色 + 详细输出格式**（这是我们的优势），
> 但从 pi-web 学**机制**，而不是把提示词改短。

### 7.3 PR 拆分

**PR-E1** `feat(subagent): 子会话变成可检视的会话（后台运行 + 结果查询）`
- `resources/extensions/subagent/index.ts`：`subagent` 工具加 `run_in_background` 参数
- 新增 `get_subagent_result({ agent_id, wait })` 工具
- 后台完成时向父会话发一条带固定前缀的 `custom` message 通知
- 已用 `get_subagent_result` 收过结果的不重复通知（`sessionId + completedAt` 标记）
- 验收：拉两个后台子 agent，父会话在它们跑完时各自收到一条通知；`get_subagent_result` 能查到

**PR-E2** `feat(subagent): steer —— 给运行中的子会话注入指令`
- 新增 `steer_subagent({ agent_id, message })` 工具
- 依赖 PR-E1 的 run 注册表（要有 id 可寻址）
- 验收：子 agent 跑到一半 steer 一条消息，能在它的 tab 里看到并改变后续行为

**PR-E3** `feat(subagent): resume + worktree 隔离`
- `Agent`/`subagent` 加 `resume` 参数（继续已结束的子会话，保留 model / thinking / context）
- 加 `isolation: "worktree"`（复用我们已有的 `git-worktree.ts`）
- 验收：resume 一个已完成的子 agent，它记得之前做过什么；worktree 隔离的子 agent 改文件不影响主工作区

**PR-E4** `feat(subagent): profile 可开关 + 参数边界收紧`
- 内置 profile 可开关（仿 `disabledBuiltIns`，**不删 .md 文件**）
- `thinking` / `max_turns` / `inherit_context` 收到 profile 决定，**不接受模型传参**
  （防止模型猜一个 `max_turns: 8` 静默丢掉 profile 的设定）
- 用 `exposure: "model-only"` 禁止 codemode 脚本启动子 agent
- 验收：设置里能把某个内置 profile 关掉；模型传 `thinking` 被忽略且不报错

### 7.4 一个需要你确认的差异

我们在 `AGENTS.md` 里定义的角色名是 `explorer` / `planner` / `reviewer` / `worker`，
pi-web 是 `general-purpose` / `explore` / `plan`。
**建议保留我们的名字**（已有用户在用了，改名会断兼容）。
但可以考虑**补一个 `general-purpose`**（通用、不限定只读），对应 pi-web 的默认 profile ——
它比我们的 `worker` 更中性，适合「就是想扔一个活儿出去」的场景。

---

## 8. 侧栏排序（最新对话沉底）

> 你的反馈：「左侧列表排序有问题，最新的对话在最下面」。已定位。

### 8.1 根因：排序键用错了

**`src/renderer/src/components/layout/sidebar.tsx:242-246`**

```ts
function sortSessions(items: Conversation[]): Conversation[] {
  // Creation order, not activity order: opening or renaming a chat must not
  // make it jump to the top of the list.
  return [...items].sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id));
}
```

注释写得很明白：**这是一个故意的设计选择** —— 为了避免「点开一个旧对话它就跳到顶部」。
但它是**错的**，因为：

1. **用户的心理模型是「最近用过的在最上面」** —— 微信、Slack、Notion、VS Code 都是这样
2. **`updatedAt` 已经在维护了**（`conversation-catalog.ts:105,314` 每次变化都写），我们只是没用它
3. **`createdAt` 是不可变的**（`conversation-catalog.ts:308` 注释：「`createdAt` is immutable: it is the sidebar's sort key」）
   —— 所以新对话永远排在所有旧对话**下面**，而不是下面几条
4. 担心的「点开就跳」在有**置顶**和**手动拖拽排序**的情况下其实不成立

### 8.2 pi-web 是怎么做的

**`参考项目/pi-web-0.12.1/lib/session-family.ts:46-69`**

```ts
export function listSessionFamilies(sessions: readonly SessionInfo[]): SessionFamily[] {
  ...
  family.latestModified = session.modified;              // 取家族的「最新活动时间」
  if (session.modified > family.latestModified) family.latestModified = session.modified;
  ...
  return [...families.values()].sort((a, b) => b.latestModified.localeCompare(a.latestModified));
}                                                        // ↑ 降序（最新在最上面）
```

而且它比我们想得更细：

- 排序键不是单个会话的时间，而是**一个「家族」（父会话 + 它的子 agent）的最新活动时间**
  —— 子 agent 在跑时，父会话不会被挤下去
- 置顶区：`compareDesc(pinnedAt)` ← 按**置顶时间**，不按创建时间（`session-tree.ts:441-443`）
- 项目分组：`compareDesc(a.group.newest, b.group.newest)` ← 同样按最新活动（`session-tree.ts:588`）
- 它还有 `session-list-scanner.ts:445` 的 `mtime` 降序作为底层排序

### 8.3 改法

**PR-F1** `fix(sidebar): 会话列表改按最后活动时间排序`

```ts
function sortSessions(items: Conversation[]): Conversation[] {
  // Activity order: the chat you just used belongs at the top.
  // `updatedAt` is written by the catalog on every prompt / rename / bind.
  return [...items].sort(
    (a, b) => b.updatedAt - a.updatedAt || b.createdAt - a.createdAt || a.id.localeCompare(b.id),
  );
}
```

需要一并处理的细节：

1. **置顶区**（`sidebar.tsx:252-254`）：也改成按 `updatedAt`（现在 tie-break 用 `createdAt`，可接受）
2. **`applyManualOrder`**（`sidebar-rows.tsx:361`）：手动拖拽排序要**优先于**自动排序，
   这个机制已经存在，只需确认手动排过的列表不被 `updatedAt` 覆盖
3. **`archived` 列表**：归档面板的排序逻辑独立，一并检查
4. **「自动归档」依赖 `updatedAt`**（`src/shared/auto-archive.ts`）—— 已经是同一个键，天然一致
5. **`conversation-catalog.ts:308` 的注释要改**（现在写着「createdAt 是侧栏排序键」，已不成立）

**验收**：
- 发一条消息 → 该对话立刻升到所在分组顶部
- 点开一个旧对话（只读不写）→ **不会**跳（`updatedAt` 不变）
- 子 agent 运行时父会话保持在位
- 手动拖拽过的顺序不被自动排序打乱

> 注意：`updatedAt` 会被「打开会话」刷新吗？→ 需要核对。
> 若会，则要把「打开」从 `updatedAt` 的触发点里排除，只留「提示词 / 改名 / 绑定项目」。
> 这一步要在 PR 里实测确认（这正是 pi-web 用 `session.modified` 的意图：只看**写**，不看**读**）。

---

```
第 1 批（修坏的，立刻可做）
  ① PR-A1  调用轨迹          ← 收益最大，改动最小
  ② PR-A2  电脑操控文案
  ③ PR-D3  移动端占位符

第 2 批（Web 版地基）
  ④ PR-B1  摘掉 electron 依赖    ← 关键路径，唯一有风险的一步
  ⑤ PR-B2  媒体/图标 URL          ← 做完才真正可用

第 3 批（Web 版打磨）
  ⑥ PR-B3  独立启动 CLI
  ⑦ PR-B4  能力降级
  ⑧ PR-B5  文件上传
  ⑨ PR-B6  PWA

第 4 批（移动端）
  ⑩ PR-D1  品牌大写
  ⑪ PR-D2  更新到 v0.5.8
  ⑫ PR-D4  iOS 出包

第 5 批（需要你的决定）
  ⑬ PR-C1  云契约可执行清单   ← 不需要你提供任何东西，可提前做
  ⑭ PR-C2/C3  真登录          ← 依赖 §8 的决策
```

---

## 9. 回合末尾的「审查 / 文件」双按钮

> 你的要求：回合末尾现在只有一个「审查」按钮，点开进的是 diff 视图；
> 希望旁边再放一个「**文件**」按钮，点开就能看到本轮增删改的**文件名列表**，
> 点文件名直接看**文件内容**；再点「审查」则回到现在的 diff 逻辑。
> 你说「你看看 piweb 咋做的，他弄的不错」—— 它确实做得好，下面是对比。

### 9.1 现在的实现

`src/renderer/src/components/chat/file-chips.tsx:86` `TurnFileChips`：

```
┌────────────────────────────────────────┐
│ 📄 已修改 1 个文件  ›          [ 审查 ] │   ← 整个卡片只有一个动作
│    +385  −37                             │
├────────────────────────────────────────┤
│  docs/pinext-next-plan-...md   +385 −37 │   ← 点这里也是进 diff
└────────────────────────────────────────┘
```

两处都是同一个调用：

```ts
const review = (): void => openTurnChanges(files, files[0].path);
...
onOpen={(changed) => openTurnChanges(files, changed.path)}   // FileRow 里
```

即：**点按钮和点文件名都进 diff 视图**，没有「看文件本体」的路。

### 9.2 pi-web 是怎么做的（机制更好）

它的核心是一个**双维度**的设计，而不是两个按钮：

**① 文件查看器有三种模式，用分段控件切换**

`components/FileViewer.tsx:66`：

```ts
export type FileViewerDisplayMode = "source" | "preview" | "diff";
const DISPLAY_MODE_LABELS = { source: "Source", preview: "Preview", diff: "Diff" };
```

工具栏里渲染成分段按钮（`:1646-1667`），只有**当前文件真的有 diff 时**才出现 `Diff` 那一格（`:1601-1607`）：

```ts
const displayModes = isDeletedDiff
  ? ["diff"]
  : ["source",
     ...(hasPreview ? ["preview"] : []),
     ...(hasGitDiff ? ["diff"] : [])];
```

**② 调用方只传一个「打开意图」，不传「打开哪个按钮」**

`components/file-tab-state.ts:36`：

```ts
export function openFileTab(tabs: Tab[], input: {
  tabId: string; filePath: string; fileName: string;
  modeHint?: "diff";            // ← 只区分「想直接看 diff」还是「默认」
  sourceSessionId?: string | null;
  page?: number;
}): Tab[]
```

于是：
- 在**侧栏改动列表**里点一个文件 → `onOpenFile(path, name, { modeHint: "diff" })`（`FileExplorer.tsx:602`）
- 在**文件树**里点一个文件 → 不传 `modeHint` → 默认 `source`
- 两者进的是**同一个 tab、同一个查看器**，只是初始模式不同

**关键洞察**：pi-web 不做「审查按钮 vs 文件按钮」两个入口，
它让**同一个视图**能在源码 / 预览 / 差异之间切。想改主意只需点一下工具栏。

### 9.3 两种做法对比

| | 你提的方案（两个按钮） | pi-web 的方案（一个视图 + 模式切换） |
|---|---|---|
| 回合末尾 | `[审查] [文件]` 两个按钮 | 一个卡片，点进去 |
| 看文件名列表 | 点「文件」→ 列表 | 卡片本身就展开着列表 |
| 看文件内容 | 点文件名 | 点文件名 → 查看器的 `source` 模式 |
| 看 diff | 点「审查」 | 查看器里点 `Diff` |
| 已打开后改主意 | 要回对话再点另一个按钮 | 工具栏上点一下 |
| tab 数量 | 可能两个 | 一个 |

**我的建议：两者融合**——保留你要的两个按钮（入口清晰，符合直觉），
但把「文件 / 审查」做成**同一个 tab 内的模式**，而不是两个 tab。
这样点「文件」再点「审查」不会开出两个 tab，而是在同一个查看器里切换。

### 9.4 PR 拆分

**PR-G1** `feat(chat): 回合末尾加「文件」按钮，文件名可点开看内容`

1. `file-chips.tsx` 的卡片头部加第二个按钮：

```tsx
<div className="flex items-center gap-1.5">
  <Button onClick={openFiles}>{t("files.files")}</Button>   {/* 新增：「文件」 */}
  <Button onClick={review}>{t("files.review")}</Button>     {/* 保留：「审查」 */}
</div>
```

2. `FileRow` 的 `onOpen` 改为打开**文件内容**（不是 diff）
3. 新增 `useSidePaneStore.openTurnFiles(files, path)`（与 `openTurnChanges` 并列）
4. `locales/{zh,en}/chat.json` 的 `files` 组加 `files: "文件"` / `files: "Files"`

**验收**：点「文件」→ 文件名列表可见；点文件名 → 右侧显示**文件内容**；
点「审查」→ 右侧显示**本轮 diff**（与现在行为一致）。

**PR-G2** `feat(side-pane): 文件查看器支持 源码 / 预览 / 差异 三模式切换`

这一步才是真正抄 pi-web 的：

1. `side-pane-files.tsx` 的查看器加一个分段控件（`源码 | 预览 | 差异`），
   只在适用时出现（有 diff 才显示 `差异`）—— 直接照 `FileViewer.tsx:1601-1607` 的构造逻辑
2. 我们的查看器目前是「编辑模式 / 只读」，需要加一个正交的「显示模式」维度
   —— **注意这两个维度不要混**：`可编辑` 是权限，`源码/预览/差异` 是视图
3. `stores/side-pane.ts` 的 tab 增加 `initialDisplayMode?: "source" | "preview" | "diff"`
   （对应 pi-web 的 `modeHint`，但存到 tab 上而不只是初次打开）
4. `openTurnChanges` / `openTurnFiles` 改成只传 `displayMode`，**共用一个 tab id**

**验收**：同一个文件 tab 里能在源码 / 差异之间切换，不需要回到对话再点另一个按钮。

**PR-G3** `fix(side-pane): 文件 tab 的去重与切换语义`（可并入 G2）

pi-web 的 `openFileTab`（`file-tab-state.ts:42-90`）有个值得学的细节：
再打开一个**已存在**的 tab 时，它比较 `sourceSessionId` 和 `modeHint`，
**无变化就直接返回原数组**（`if (sourceUnchanged && !input.modeHint && !pageChanged) return tabs;`）
—— 避免一次无意义的 re-render。
而且 `modeHint` 在已有 tab 上会把 viewer 的显示模式**改过去**（不只是初次生效）。

我们的 `openTurnChanges` 是每次新建/重定向 tab，需要对齐这个语义：
**同一个文件不应该因为再点一次而变成两个 tab**。

### 9.5 顺带：pi-web 侧栏改动列表里的那个细节

`FileExplorer.tsx:593-625` 里，变更行把路径**拆成 dir 和 base name 两段**渲染：

```tsx
const lastSlash = rel.lastIndexOf("/");
const dirPart = lastSlash >= 0 ? rel.slice(0, lastSlash + 1) : "";
const baseName = lastSlash >= 0 ? rel.slice(lastSlash + 1) : rel;
// dirPart 可省略号截断，baseName 完整显示
```

这样长路径省略的是**目录**，文件名永远看得见。
对比我们的 `FileRow`（`file-chips.tsx:66`）：`truncate` 加在**整个路径**上，
所以长路径会把文件名也截掉。**这个要改**（并入 PR-G1，几行代码）。

---

## 10. 执行顺序

```
第 1 批（修坏的，立刻可做）
  ① PR-A1  调用轨迹          ← 收益最大，改动最小
  ② PR-A2  电脑操控下线       ← 你的要求，独立 commit 便于回滚
  ③ PR-F1  侧栏排序           ← 三行代码，体验改善明显
  ④ PR-G1  回合末尾「文件」按钮  ← 你提的需求，含长路径截断修复

第 2 批（多 Agent，抄 pi-web 的机制）
  ⑤ PR-E1  后台运行 + 结果查询  ← 地基，后面两个都依赖它
  ⑥ PR-E2  steer
  ⑦ PR-E3  resume + worktree
  ⑧ PR-E4  profile 开关 + 参数收紧

第 3 批（文件查看器）
  ⑨ PR-G2  三模式切换（源码/预览/差异）  ← 真正抄 pi-web 的一步
  ⑩ PR-G3  tab 去重与切换语义（可并入 G2）

第 4 批（Web 版地基）
  ⑪ PR-B1  摘掉 electron 依赖    ← 关键路径，唯一有风险的一步
  ⑫ PR-B2  媒体/图标 URL          ← 做完才真正可用

第 5 批（Web 版打磨）
  ⑬ PR-B3  独立启动 CLI
  ⑭ PR-B4  能力降级
  ⑮ PR-B5  文件上传
  ⑯ PR-B6  PWA

第 6 批（移动端）
  ⑰ PR-D1  品牌大写
  ⑱ PR-D2  更新到 v0.5.8
  ⑲ PR-D4  iOS 出包

第 7 批（需要你的决定）
  ⑳ PR-C1  云契约可执行清单   ← 不需要你提供任何东西，可提前做
  ㉑ PR-C2/C3  真登录          ← 依赖 §11 的决策
```

**为什么这样排**：

- 第 1 批四项都是**独立、低风险、见效快**的，适合先建立节奏
- 第 2 批内部**有严格依赖**：没有可寻址的 run 注册表（E1），steer 和 resume 无从谈起
- 第 3 批的 G2 会动右栏查看器的核心（加一个正交的显示模式维度），
  放在 G1 之后 —— G1 能先验证「两个入口」的用户感受，再决定要不要合并成模式切换
- 第 4 批的 PR-B1 是**唯一有技术风险**的一步（动主进程核心路径），放在功能稳定之后
- ⑳ 可以**随时插队**：不需要你做任何准备，纯文档产出

---

## 11. 待决策

以下问题会改变实现方式，需要你拍板：

### Q1. 独立 Web 版的运行形态

- A. 只在本机跑（`pnpm web` → 浏览器开 `127.0.0.1:7800`）
- B. 要能部署到服务器，多设备访问同一个地址
- C. 两个都要（先 A，架构上为 B 留口）

**影响**：B 需要额外处理鉴权、多用户隔离、静态资源部署；
A 基本就是 PR-B1/B3 两步。

### Q2. 云端服务端放在哪

- A. 放在本仓库 `services/cloud/`（一体化，仓库变重）
- B. 独立仓库（与上游做法一致，也是你原来 `pinext-services` 的位置）

**影响**：PR-C2 的目录结构与发布流程。

### Q3. 云端先做到哪一步

- A. 只做登录（Vercel 就够，最小改动）
- B. 登录 + 设备列表（Vercel + 外部 KV）
- C. 全都要，包括信令（建议换 Fly.io / VPS）

### Q4. 品牌「大写」的边界

- A. 只改用户能看到的文案（推荐）—— 约 10 处 locales + 移动端显示名
- B. 文案 + 显示层标识（窗口标题、Dock 名、安装包名）
- C. 连代码标识符一起改

**影响**：C 会破坏已有安装的升级路径、数据目录（`~/Library/Application Support/Pinext`）、
自定义协议（`pinext-media://`）、钥匙串条目、用户已存的设备令牌。
**强烈建议 A 或 B。**

### Q5. ~~电脑操控~~ —— **已决定：下线**

你的要求是「整体去掉」，已写入 §2。无需再决策。

### Q6. 多 Agent：角色名要不要跟 pi-web 对齐？

- A. **保留我们的四个名字**（`explorer` / `planner` / `reviewer` / `worker`）+ 补一个 `general-purpose`（推荐）
- B. 完全改成 pi-web 的三个（`general-purpose` / `explore` / `plan`）—— **会断兼容**
- C. 不改，只学机制

**影响**：B 会让用户已配置的角色引用失效。

### Q7. 子 agent 默认前台还是后台？

pi-web 默认 `run_in_background: false`（前台），但支持后台。
我们要不要也默认前台？

- A. 默认前台（与 pi-web 一致，行为可预期）
- B. 默认后台（更并行，但父会话要主动查结果）

### Q8. 导出长链防护

- A. 现在就加（照抄 pi-web 的迭代版替换）
- B. 先实测我们的最长会话会不会爆栈，再决定

### Q9. 侧栏排序的一个细节

改为按 `updatedAt` 后，“**打开一个旧会话**”该不该刷新 `updatedAt`？

- A. **不该**（与 pi-web 的 `session.modified` 一致：只算写入）（推荐）
- B. 该（“我刚看过的”也算活动）

**影响**：A 更稳（列表不会因为点一下就跳）；B 更符合“最近打开”。
需在 PR-F1 里实测当前 `updatedAt` 的触发点是否已含“打开”。

### Q10. 「审查 / 文件」要做成两个按钮还是模式切换？

- A. **先做两个按钮**（PR-G1），看看手感再说（推荐——可以分两步走）
- B. 直接做模式切换（PR-G1 + G2 一起），一步到位
- C. 只要两个按钮，不要模式切换

**影响**：B 会动右栏查看器的核心（加一个正交的「显示模式」维度），
但好处是同一个 tab 里能自由切换、不会因再点一次而开出第二个 tab。

### Q11. 「文件」按钮打开后，右侧是**可编辑**还是**只读**？

- A. 保持现在的行为（文本文件可编辑、可保存）
- B. 从「文件」按钮进来的都以只读打开（review 场景不希望误改）

**影响**：PR-G1 的 tab 初始化参数。

---

## 12. 附录：关键证据索引

| 主题 | 位置 |
|---|---|
| 调用轨迹组件 | `src/renderer/src/components/layout/trace-frame.tsx:76` |
| 应用 CSP | `src/renderer/index.html:7` |
| 内联 HTML 的 CSP 先例 | `src/main/engine/media-protocol.ts:56`、`src/shared/media-preview.ts:80` |
| 导出实现 | `src/main/pi/process-manager.ts:3083`、SDK `dist/core/export-html/index.js:116` |
| cua 版本钉住 | `src/main/engine/cua-driver-spec.ts:13` |
| cua 加载失败 | `src/main/pi/cua-bridge.ts` |
| 无 Electron 的 Agent 入口 | `src/agent/main.ts`（`--port` / `--data-dir` / `--host`） |
| electron 硬依赖（仅 2 处） | `src/main/ipc/registry.ts:1`、`src/main/engine/app-settings.ts:2,128,149` |
| 浏览器前端 | `src/renderer/web.html`、`src/renderer/src/web-main.tsx`、`src/renderer/src/web-bridge.ts` |
| 静态服务 + 路由 | `src/main/server/server.ts:458`（`#serveWeb`）、`:855`（媒体鉴权）、`:1068`（同源规则） |
| 图标目录（无调用者） | `src/main/engine/file-icons.ts:48` |
| 账号客户端 | `src/main/engine/account.ts:76`（`authorizeUrl`）、`src/shared/account.ts:43`（默认 origin） |
| 云契约 | `docs/pinext-cloud-contract-2026-10-13.md` |
| 云 origin 可配置 | `src/main/account.ts:15`（`PINEXT_CLOUD_URL`） |
| 移动端图标（已同源） | `apps/mobile_flutter/assets/brand/icon.png` ≡ `resources/icon.png` |
| 移动端显示名 | `AndroidManifest.xml:14`、`ios/Runner/Info.plist:15,23` |
| 移动端未替换占位符 | `lib/update/release.dart:19`、`tool/create-release-keystore.sh:19` |
| iOS 出包流水线 | `.github/workflows/mobile-ios.yml` |
| 过时文档 | `docs/ios-free-signing.md`（描述已不存在的 Capacitor 工程） |
| 参考项目服务端会话 | `参考项目/pi-web-0.12.1/lib/rpc-manager.ts:2527` |
| **参考项目 subagent 工具** | `参考项目/pi-web-0.12.1/lib/subagent-extension.ts:163,263,302`（`Agent` / `get_subagent_result` / `steer_subagent`） |
| **参考项目内置 profile** | `参考项目/pi-web-0.12.1/lib/subagents.ts:205-247`（三个 profile 的完整定义） |
| **参考项目 subagent 文档** | `参考项目/pi-web-0.12.1/docs/agents/subagents.md`（25 行，密度极高） |
| **参考项目会话排序** | `参考项目/pi-web-0.12.1/lib/session-family.ts:46-69`（`latestModified` 降序） |
| **参考项目分叉导航** | `参考项目/pi-web-0.12.1/components/SessionTree.tsx`（1071 行）、`BranchNavigator.tsx`（449 行） |
| **我们侧栏排序（错的那一行）** | `src/renderer/src/components/layout/sidebar.tsx:242-246` |
| **我们子 agent** | `resources/extensions/subagent/index.ts`、`resources/extensions/subagent/agents/*.md` |
| **参考项目文件查看器三模式** | `参考项目/pi-web-0.12.1/components/FileViewer.tsx:66,1601,1646`（`DISPLAY_MODE_LABELS` / `displayModes` / 分段控件） |
| **参考项目文件 tab 状态** | `参考项目/pi-web-0.12.1/components/file-tab-state.ts:36,42,67`（`modeHint` / `openFileTab` / 去重） |
| **参考项目变更行渲染** | `参考项目/pi-web-0.12.1/components/FileExplorer.tsx:593-625`（dir/baseName 拆分） |
| **我们回合文件卡片** | `src/renderer/src/components/chat/file-chips.tsx:86`（`TurnFileChips`） |
| **我们右栏打开入口** | `src/renderer/src/stores/side-pane.ts:255`（`openTurnChanges`） |
| 参考项目 SSE | `参考项目/pi-web-0.12.1/lib/agent-event-stream.ts:36,48,121,211` |
| 参考项目终端续传 | `参考项目/pi-web-0.12.1/lib/terminal-manager.ts:29,144,186` |
| 参考项目 SW | `参考项目/pi-web-0.12.1/public/sw.js` |
| **电脑操控要删的文件** | 见 §2.2 的完整表格 |
