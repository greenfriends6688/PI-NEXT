# pinext 迁移详细计划（v3 · 宿主 = FastVibe，品牌 = pinext）

日期：2026-10-13（v3：按你 2026-10-13 的补充裁定修订，取代 v2）  
相关文档：`fastvibe-host-swap-2026-10-13.md`（可行性）、`fastvibe-vs-pinext-diff-2026-10-13.md`（能力差异）、`pinext-cloud-contract-2026-10-13.md`（自建云契约）

---

## 0. 这一版改了什么（相对 v2）

| 你的补充 | v2 写的 | 本版改为 |
|---|---|---|
| 「上下滑动」指的是输入框 | 误以为是要移植 CSS 自动增高 | **是输入框顶部上下拖拽缩放**（PI NEXT 的 `fork:pr23-resize` 手柄）；FastVibe 完全没有 → §4.D5 |
| MCP「不是要页面，风格沿用他的，只是功能」 | 移植 PI NEXT 的 MCP 页面 | **不动 FastVibe 的 MCP 页面**，只把缺的**功能**补进它的 `mcp-settings.tsx` → §6 |
| 移动端不去云，要加**自己的**云 | 规划成「移除账号/官方远程」 | **保留云代码，改指向你的服务**；契约已单独成文 → §7 |
| office 预览用我的，**编辑先不加** | 预览+工具一起规划 | 预览照搬；**编辑放到最后一个阶段且可选** → §5 |
| 命名：logo 用我的，品牌用文字 | 只写了改名 | 补 logo 与文字品牌资源与落点 → §2 |
| 会话目录先别动 / 给开关 | 建议共用 `~/.pi/agent` | **做成设置开关**，默认隔离，可随时切 → §3 |
| 电脑操控「要给我弄一个可用的」 | 只修报错文案 | **实现 macOS 12 可用的系统命令版**，cua-driver 可用时优先用它 → §4.D3 |

---

## 1. 总览：做什么、不做什么

**宿主 = FastVibe 0.19.5 源码**，设计 100% 沿用它的风格；PI NEXT 的代码作为 `src/main/pinext/**` + `src/renderer/src/pinext/**` **加**上去，对 FastVibe 原文件只做「登记点」修改（extension 注册表 / 通道表 / capability / remote-policy / 设置分节），便于以后 rebase 上游。

要加（你点名的）：**生图、IM 桥 + 入站机器人、免 key 联网搜索、定时任务、MCP 功能补齐、多 agent 增量、AI 身份、git 图、调用轨迹、导出 Markdown、输入框上下拖拽缩放、office/CSV 预览、电脑操控可用版、web 端、自建云**。

不做：审批三模式 / plan 模式、壁纸、繁体中文、PI NEXT 的 PWA+Capacitor 壳与其 LAN 配对闸门、PI NEXT 的终端工具与浏览器与会话导入与 todo（这些用 FastVibe 的）。

---

## 2. 品牌与资源

| 项 | 值 |
|---|---|
| 界面显示品牌 | **文字**（不做图形品牌占位） |
| Logo | **用你的**：`PI NEXT品牌/pinext的logo.png`（图标）与 `PI NEXT品牌/pinext的主品牌文字.png`（文字标） |
| 现成可复用的资源 | 仓库里已有 `public/pi-next-logo.png`、`public/pi-next-wordmark.png`、`public/icons/{icon-192,icon-512,apple-touch-icon}.png`、`public/favicon.png` |
| 代码标识 | `pinext`（包名 / 目录 / 二进制 `pinext-agent`） |
| 应用 id | `dev.pinext.desktop` / `dev.pinext.mobile` |
| 数据目录 | `~/.pinext`（见 §3 的会话目录开关） |
| App 协议 | `fastvibe.app` → `pinext.app`（**桌面与手机必须同改**） |
| 环境变量 | `FASTVIBE_*` → `PINEXT_*`（实测 20 个具名变量，含 `FASTVIBE_CLOUD_URL`） |

**落点**：Electron 图标（`electron-builder.yml` 的 `mac.icon` / `win.icon` → `resources/icon.icns` / `icon.ico`）、侧栏 logo、启动/关于页、Dock 图标、PWA manifest、Flutter 的 `flutter_launcher_icons`、Android/iOS 的 app name。

### 2.1 改名规模（实测）

| 目标 | 命中 |
|---|---|
| `fastvibe`（大小写不敏感） | 1165 处 / 226 文件 |
| `~/.fastvibe` | 325 |
| `fastvibe_mobile` | 122 |
| `fastvibe-agent` | 20 |
| `dev.fastvibe` | 14 |
| `fastvibe.app`（协议） | 8 |
| `app.fastvibe.dev` | 11（§7 改指向你的云） |
| PI NEXT 侧 `pi-web` / `PI_WEB_` / `pi-next` / `PI NEXT` | 352 / 91 / 31 / 104 |

### 2.2 ⚠️ 两类**不能无脑 sed**

1. **出处标注**：PI NEXT 里的 `fork:fastvibe-stack` 表示「这段是从 FastVibe 搬来的」，应改成 `fork:from-fastvibe`，**不能**变成 `fork:pinext-*`，否则丢掉出处、以后无法跟上游比对。
2. **文件名 `lib/themes-fastvibe.ts`**：它就是「FastVibe 的 24 套主题的移植」，改名会让人误以为是自研。**保留文件名**，只在文件头注明来源。

---

## 3. 会话目录：做成设置开关（你要求的）

**两种模式的差别（你问的好处/坏处）**：

| | 共用 `~/.pi/agent` | 隔离到 `~/.pinext/agent` |
|---|---|---|
| 好处 | 与 **pi CLI / TUI** 实时互通——终端里开的会话，桌面里立刻能看到，反之亦然；已有会话/配置直接可用 | 桌面应用自己的世界，不会被 CLI 的迁移/清理碰到；卸载不牵连 |
| 坏处 | pi CLI 的迁移会整写会话文件，两边同时写有冲突风险；配置（`settings.json` / `mcp.json`）改动会影响 CLI | 与 CLI/TUI **不互通**，需要导入才能看到彼此 |

**方案**：设置 → 通用 里加一个开关「与 pi CLI/TUI 共用会话目录」：

- 默认**关**（隔离，`~/.pinext/agent`）。
- 打开时用共用目录；**切换需要重启引擎**（会话目录在引擎启动时读一次），UI 上用「重启后生效」徽标说明，与 FastVibe 现有「需要重启」的提示同一套口径。
- 首次打开时提示可**复制**现有 `~/.pi/agent/sessions` 到 `~/.pinext/agent`（一次性、只复制不移动），避免用户以为会话丢了。
- 实现落点：`src/main/engine/paths.ts`（`agentDir` 已经是集中定义的）+ 一个 `pinext-preferences.json` 里的布尔 + 设置行（照 FastVibe 的 `SettingsRow` 写）。

---

## 4. 必须真修的缺陷

### D1 · opencode-go 400（少请求头）

**根因定位到文件**：

```
node_modules/@earendil-works/pi-ai/dist/providers/opencode-headers.js
  const OPENCODE_SESSION_HEADER = "x-opencode-session";
  // 仅在 options.sessionId 存在、且走「原生 opencode / opencode-go provider」时注入
```

FastVibe 的 `src/main/engine/providers.ts` 会把供应商**物化进 `models.json`**（`renderModelsJson()` / `migrateBuiltin()`）。一旦 opencode-go 成了「自定义供应商」，pi 就不再走原生 provider 的那层包装，头就丢了 → 上游按未知模型回 400，响应体回显 `{"model":"deepseek-v4.1-flash"}`。

**修**：让 `opencode` / `opencode-go` 永远以 `kind:"native"` 存在，`renderModelsJson` 跳过它们；兜底是在 engine 的模型请求路径上 `providerId.startsWith("opencode")` 且头缺失时显式补 `x-opencode-session`。
**验收**：opencode-go 真实跑通一轮对话；换别的供应商不受影响。

### D2 · 模型余额（含 opencode-go）

PI NEXT 已有完整实现，**按功能移植**（不是搬页面）：`lib/provider-usage.ts`（462 行，10 家供应商，**已含 opencode-go** 的 `https://opencode.ai/zen/go/v1/usage` + `normalizeOpenCodeGo` 三窗归一化）、`provider-usage-ids.ts`、`components/ProviderUsageSummary.tsx`。

落点：新增通道 `providers:usage` + capability/policy 登记；UI 放进 FastVibe 的「供应商」设置页（照它的 `SettingsRow` 规格）。保留 PI NEXT 的 `isOfficialProviderUsageOrigin()` 闸门。注意 opencode-go 是目录型套餐——baseUrl 挂在模型上，取不到供应商 baseUrl 时回退到第一个模型。

### D3 · 电脑操控（你要「可用的」）

**现状**：你是 **macOS 12.7.1 / arm64**；`@trycua/cua-driver-darwin-arm64` 的 `libcua_driver_sdk.dylib` 构建在更新的 Foundation 上，`dlopen` 必然失败（`Symbol not found: …convertErrorToNSError`）。而 `src/shared/computer-availability.ts` 只判断平台是 `darwin` 就返回 `supported: true` —— 所以开关能打开，然后在第一次调用时炸出 dylib 原文。

**方案：双引擎，自动择优**

| 引擎 | 条件 | 能力 |
|---|---|---|
| A. cua-driver（FastVibe 原版） | 仅当 `dlopen` 探测成功 | 无障碍树 elementToken、后台投递、窗口级操作、`computer_task`（决策模型逐步执行） |
| B. 系统命令版（**新增**） | macOS 10.15+（含你的 12.7.1） | 用系统自带 `screencapture` + `osascript`(System Events) + `pbpaste`/`pbcopy` 实现同一批工具名 |

**可用性判定改成**：平台是 darwin/win32 **且**（A 探测成功 → 用 A）**或**（macOS ≥ 10.15 → 用 B）；两者都不行才 `supported: false`，并给出**可读原因**（例如「需要 macOS 13 才能使用完整驱动；已切换为基础模式」）。

**B 要实现同一批工具名**（保持模型侧提示词不变，`resources/extensions/computer-use.ts` 那份中文描述**逐字沿用**）：

| 工具 | B 的实现 |
|---|---|
| `computer_screenshot` | `screencapture -x -t png <tmp>` |
| `computer_list_apps` | `osascript` → `System Events` 取 `name` / `unix id` |
| `computer_list_windows` | `System Events` 取每个进程的 `windows`（标题/位置/尺寸）与 `id` |
| `computer_window_state` | `System Events` 遍历 `UI elements`，生成**同样的 elementToken**（令牌编码 路径而非指针，因为 System Events 没有 AXUIElement 句柄） |
| `computer_click` | 优先 elementToken（按令牌路径重新定位元素后 `click`）；否则 `cliclick` 不可用时用 `osascript` 的 `click at {x,y}` |
| `computer_type` | `keystroke "…"`（或 `set value of … to "…"` 走元素） |
| `computer_key` / `computer_hotkey` | `key code N using {cmd down, shift down}`（键名→key code 表内置） |
| `computer_scroll` | `System Events` 的 `scroll` / 方向键回落 |
| `computer_menu` | `click menu item "…" of menu "…" of menu bar 1` |
| `computer_clipboard_read/write` | `pbpaste` / `pbcopy` |
| `computer_batch` | 把多个动作合成**一段** osascript 执行（一次进程，减少授权弹窗与延迟） |
| `computer_task` | **降级**：B 模式下不支持（它依赖决策引擎逐步执行）；调用时返回明确说明，让模型改用逐步工具 |

**权限**：`osascript` 驱动 System Events 需要「辅助功能」；`screencapture` 需要「屏幕录制」。两者 macOS 12 都有。首次调用若被拒，设置页给一键跳转系统设置的引导（FastVibe 已有 `computer-grant-flow.ts` 的形状可复用，把 cua 的 drag-overlay 换成系统设置深链）。
**风险**：B 模式**不能后台投递**（会抢焦点），要在工具描述里如实说明，并让上层加一次 `foreground` 语义的确认。
**验收**：在你的 macOS 12.7.1 上真跑——列出窗口、截图、按 elementToken 点一个按钮、输入一段中文、读剪贴板。

### D4 · 设置改成弹窗

FastVibe 的设置虽叫 `SettingsDialog`，但渲染是**整屏覆盖层**：

```
src/renderer/src/components/settings/settings-dialog.tsx:146
  <div data-settings-overlay className="fixed inset-x-0 bottom-0 z-50 flex bg-background" …>
```

改成用 FastVibe 已有的 `@base-ui/react` Dialog 包一层居中弹窗（`max-w-5xl` ≈1024px、`max-h-[85vh]`、圆角与阴影沿用它的 `.overlay-surface` 规格），**内部左导航 + 右内容两栏原样保留**，窄屏仍走它已有的 `narrow` 单栏分支。其他覆盖层（右栏、命令面板）不动。

### D5 · 输入框上下拖拽缩放（你澄清的那一项）

**你说的就是它**：PI NEXT 的 `fork:pr23-resize` —— 输入卡**上边缘有一个手柄，向上拖变大**，且手动高度会持久化；高度归手柄所有时，textarea 改为内部滚动、与自动增高互斥。

FastVibe **完全没有**这个：它的 textarea 是 `field-sizing-content max-h-56 min-h-13`（只能自动增高到 56×4px 上限，用户不能拖）。

**移植要点**（照 PI NEXT 的三处实现）：
- 手柄：`components/ChatInput.tsx:5164` 那枚 `chat-input-resize-handle`（骑在卡片上边缘，绝对定位；卡片补 `position: relative`）
- 状态：`useResizableHeight({ minHeight, getMaxHeight, storageKey, targetRef })` —— 上下限分别是「桌面最小高度 / 视口高度的某个比例且不超过硬上限」，并存 localStorage
- 互斥：手动模式下卡片挂内联固定高度，textarea 交给 CSS `height: 100% !important` 内部滚动；自动模式不写 height，保持内容驱动
- 不生效的形态：引用回答（compact）与移动端不渲染手柄

**顺带**：把 FastVibe 的 `field-sizing-content` 换掉（它在 Safari/Firefox 无效，web 端会一直一行高），改用 PI NEXT 的 `ta.style.height = Math.min(ta.scrollHeight, …)` 循环（覆盖输入、粘贴、切换会话、拖入附件等场景）。

---

## 5. office / CSV 预览（用你的）与「按需安装」

**先纠正一个事实**：FastVibe 的预览只有 **文本/代码、图片、PDF、视频**（`src/main/engine/file-preview.ts`），**没有 docx、没有 csv**。所以这两样是从 PI NEXT 拿进来的。

**你指定的做法**：预览用 PI NEXT 的；**编辑先不加**（放到最后且可选）。

**按需安装**：应用只带一个**渲染层插件宿主**——
- 启动时扫 `<userData>/plugins/*/`，对每个插件用 `import(/* @vite-ignore */ url)` 加载，读它导出的契约注册进「预览注册表」；
- 契约（约 30 行）：`export default { id, match(path), Preview }`；
- **不新造安装 UI**：复用 FastVibe 已有的 `engine:install-extension-package` 与 pi 包市场（`pi.dev/packages`），给包加一个 `pinext.renderer` 字段指向渲染层入口，安装时把入口落到 `<userData>/plugins/<id>/`。

首批插件包：`pinext-preview-docx`（同源 sandbox iframe + 选中引用，来自 PI NEXT `FileViewer.tsx` 的 office 分支 + `document-docx.ts`）、`pinext-preview-csv`（来自 `lib/csv-preview.ts`）。**PDF 不做**——FastVibe 的浏览器查看器已经能用。

**编辑最后做**（可选阶段 P12）：PI NEXT 的 `edit_docx` / `write_xlsx` 等工具打包成 pi 包 `pinext-document-tools`，同样按需安装。

---

## 6. MCP：页面不动，只补功能

**你指定的口径**：页面风格沿用 FastVibe 的 `settings/mcp-settings.tsx`（635 行，一个 Form + JSON 双页签的添加对话框，很干净），**只把缺的能力补进去**。

实测差异（`docs/fastvibe-vs-pinext-diff-2026-10-13.md` 的 MCP 段）：

| # | FastVibe 缺的能力 | 现状 | 从 PI NEXT 移植 |
|---|---|---|---|
| 1 | **从其他工具发现并导入** | 只能手粘标准 JSON | `lib/mcp-discovery.ts`（Claude Code / Codex / Cursor / VS Code / Windsurf / Gemini / opencode）+ `lib/mcp-import-{core,cli,json,links}.ts`（URL / 命令行 / `mcp add` / 各种 JSON / 安装链接）— **最大价值** |
| 2 | **精选目录 + 凭证字段一键添加** | 无 | `lib/mcp-catalog.ts`（10 项）+ `lib/mcp-catalog-credentials.ts` |
| 3 | **OAuth 登录/登出** | 无 | `lib/mcp-auth-command*.ts` |
| 4 | **密钥不出主进程** | `env`/`headers` **明文**回给渲染层，且明文落 `userData/mcp.json` | `lib/mcp-secrets.ts` + `mcp-secret-mask.ts` — **安全项** |
| 5 | **配置原子写 + 0600** | 直接 `writeFile`，默认权限 | `lib/mcp-config-file.ts`（同目录 staging + rename + chmod 0600；解析失败只回 `malformed JSON`，永不回显文件内容） |
| 6 | 只读会话下的写保护 | 无 | `lib/mcp-read-only-policy.ts` |
| 7 | 显式「测试连接」 | 只在加载时隐式连接 | `lib/mcp-live-test.ts` + `test-redact`（错误与 stderr 打码、返回工具清单） |
| 8 | 日志查看器 | 只有 12KB stderr tooltip | 日志尾巴接口 + 弹窗（分页） |
| 9 | 删除后 60 秒撤销 | 无 | `lib/mcp-undo.ts` |
| 10 | exposure 第四档 `hidden` + 逐工具曝光 + codemode 面板 | 只有 direct/deferred/codemode 三档 | PI NEXT 原生化那套（`McpExposureField` + codemode 设置面板） |
| 11 | 项目级 server + 信任门 | 无 | `.pi/mcp.json` 项目作用域 + `lib/project-trust-mcp.ts` |

**⚠️ 一个必须先决定的结构问题**：第 3、7、11 项与第 10 项的 `hidden`/`readOnlyHint`，都建立在 **pi SDK 的内置 `mcp` 扩展**之上；而 FastVibe **刻意不用它**（`src/main/pi/mcp-manager.ts` 自己维护每引擎一条连接，见其 AGENTS.md 的 MCP 段）。二选一：

- **甲（推荐）**：切到 pi 的 `builtin:mcp`（PI NEXT 的做法）—— 上面 11 项都能直接落地，代价是放弃 FastVibe 的「每引擎一条共享连接」设计；
- **乙**：保留 FastVibe 的连接管理，在 `@earendil-works/pi-mcp`（它自带 `oauth/`）上自己重实现 OAuth 与工具注解。

**这一条会决定 §6 的工作量（甲约 4 天，乙约 6–8 天），请先定。**

---

## 7. 接上你自己的云（新增，不是去掉）

**保留 FastVibe 的整套账号 + 官方远程代码，只把 origin 换成你的服务。** 完整服务端契约已单独成文：**`docs/pinext-cloud-contract-2026-10-13.md`**（8 个端点、OAuth+PKCE 含 loopback 拼写坑、信令消息表、超时与关闭码、ICE/TURN 语义与配额、服务端必须强制的安全项、最小可用配方）。

工程侧要做的：

| 项 | 落点 |
|---|---|
| origin 可配 | `src/main/account.ts` 读 `FASTVIBE_CLOUD_URL` → `PINEXT_CLOUD_URL`；`src/shared/account.ts:29` 的默认值换成你的域名 |
| 手机 origin | `apps/mobile_flutter/lib/account/account.dart:19`；构建参数 `--dart-define=PINEXT_CLOUD_URL=…` |
| client_id / 自定义 scheme | `fastvibe-desktop` / `fastvibe-mobile` → `pinext-*`；`fastvibe://oauth/callback` → `pinext://oauth/callback`（iOS/Android 清单同步改） |
| 服务端 | **你的活**；建议按契约 §9 的顺序做（先信令 + 设备 + STUN，再登录，再 TURN） |
| 兜底 | TURN 未就绪前，局域网直连与「隧道」仍然可用（§9.6 会从 PI NEXT 移植 cloudflared tunnel，正好补这块） |

要不要我把**最小服务端**（一个 Node 进程：端点 + 信令 + coturn 配置）也写出来作为起点？契约已经细到可以照着实现。

---

## 8. 移动端

复用 FastVibe 的 Flutter 应用（6 条路由 / 24 个 chat 文件 / 21 个单测文件 + 1 集成测试）。改动只有三处：**改名**（`fastvibe_mobile`→`pinext_mobile`、`dev.fastvibe.mobile`→`dev.pinext.mobile`、界面文案与图标用你的）、**协议名同步**（`fastvibe.app`→`pinext.app`，两端同改）、**云 origin 换成你的**（§7，而不是删掉）。

---

## 9. 从 PI NEXT 移植的清单

原则：只加不改，落在 `src/main/pinext/**` 与 `src/renderer/src/pinext/**`。

### 9.1 你点名的功能（低耦合，优先）

| 功能 | 源 | 行数 | 备注 |
|---|---|---|---|
| 生图 | `lib/imagegen-{config,extension,shared}.ts` | 929 | 6 预设 / 3 方言 |
| 免 key 联网搜索 | `lib/websearch/**` + `websearch-{extension,settings}.ts` | 1,060 | 保留 SSRF 闸门 |
| IM 桥（出站） | `lib/im-bridge{,-shared}.ts` + `im-extension.ts` | 579 | `im_send` 工具 + 设置 |
| 入站机器人 | `lib/chat-channel{,-shared,-register}.ts` + `bot-channel-runtime.ts` + `telegram/weixin/feishu-channel.ts` | 1,770 | 保留「首个发信人自动绑定」白名单语义 |
| 定时任务 | `lib/automation-*.ts`（7 文件） | 2,203 | 接 FastVibe 的 `process-manager-events.ts` 作可用性信号 |
| 多 agent 增量 | `lib/subagent-mail.ts` | — | `agent_mail`：子→父 / 子→兄弟 / 父→全体（FastVibe 的 `subagent` 只有父→子） |
| AI 身份 | `lib/identity.ts` + `identity-settings.ts` + `useIdentity.ts` + 设置面板 | — | 名字 / 头像 dataURL(≤512KB) / 同步本机名首字母；三态收敛在一个纯函数，渲染与预览读同一份 |
| git 图 | `components/GitGraphTab.tsx` + `lib/git-graph*.ts` | — | FastVibe 有 git 写操作但没图谱 |
| 调用轨迹 | `components/TraceFrame.tsx` + export 的 `inline=1` | — | 同源 iframe 装 pi 导出的完整历史页，页头刷新 + 全屏 |
| 导出 Markdown | `lib/session-markdown.ts` | — | 与 HTML 导出并列，进会话动作菜单 |
| 输入框缩放 | `fork:pr23-resize` 三处 | — | §4.D5 |
| 余额查询 | `lib/provider-usage.ts` 等 | 462 | §4.D2 |

### 9.2 MCP 功能补齐

见 §6（页面不动）。

### 9.3 管理面与基础设施

| 功能 | 源 | 行数 |
|---|---|---|
| 隧道（cloudflared） | `lib/tunnel-manager.ts` | 421 |
| 文件层深度 | `file-tree-visibility.ts`（git 决定可见性）、`linked-directory.ts`（项目外软链一次性授权）、`file-mutations.ts`、`file-archives.ts`、`file-fuzzy.ts`、`file-watch-filter.ts` | ~1,500 |
| 预览插件宿主 + docx/CSV 两个插件包 | §5 | — |
| 功能开关（8 个） | `lib/feature-toggles.ts` + 设置面板 | — |

### 9.4 i18n

统一到 FastVibe 的 react-i18next 机制，**只保留 `zh` / `en`**（不迁 PI NEXT 的 zh-TW）；移植来的功能补这两套 key。

---

## 10. 阶段与 PR 清单（优化后）

估计 **30–40 个工作日**（比 v2 多：输入框缩放与 MCP 功能补齐单列，云改成自建对接，电脑操控要真做出来）。

```
P0  去他人依赖 + 接自己的云（1 天）
    自动更新源 tyuan511/fastvibe → 你的仓库（或先关闭）；SSH 运行时下载源移除；
    删除 fastvibe.dev 的 builtin 供应商迁移分支；加 NOTICE 写明基于 FastVibe(MIT)；
    PINEXT_CLOUD_URL 指到你的域名（服务端按契约自行实现，见 §7）
    验收：全仓 grep 不到 tyuan511；自动更新不再指向别人；账号页能连上你的 origin

P1  品牌改造（1.5 天）
    文字品牌 + 你的 logo（Electron / 侧栏 / 关于 / 图标 / Flutter / manifest）；
    §2.1 的标识符逐项改名；§2.2 两类人工复核
    验收：pnpm typecheck + pnpm test 绿；标题/数据目录/协议/环境变量全为 pinext

P2  宿主落位（1 天）
    git worktree 建分支 pinext；FastVibe 源码整体进入；保留本仓 history 与 docs/
    验收：pnpm typecheck + pnpm test 全绿

P3  Web 端（2 天）★ 地基
    web 入口 + createFastVibeApi(AppClient over WS) bootstrap + CSP + headless 托管
    验收：浏览器里列出会话并跑通一轮真实对话

P4  五个缺陷（6–8 天）
    D1 opencode-go 头（1）· D2 余额（1）· D4 设置弹窗（1）· D5 输入框上下拖拽缩放（1）
    D3 电脑操控双引擎（2–3，含 macOS 12 的系统命令版与真机验收）

P5  会话目录开关 + i18n 收编（1.5 天）
    §3 的共用/隔离开关（重启生效 + 首次复制提示）；i18n 只留 zh/en

P6  工具扩展四件（4 天）
    生图 → 联网搜索 → IM 桥 → 入站机器人（每项一个 PR，六件套）

P7  定时任务 + 隧道（3 天）
    验收：interval 任务真跑一次；手机经隧道连上你的桌面

P8  MCP 功能补齐（4–8 天，取决于 §6 的甲/乙选择）
    导入 → 密钥不出主进程 → 目录 → OAuth → 锁「测试连接」与日志
    验收：从 Claude Code 配置导入一个 server 并连上；渲染层拿不到任何明文密钥

P9  多 agent 增量（1.5 天）
    agent_mail；验收：子代理给父代理发信并被唤醒

P10 四项界面增量（4 天）
    AI 身份 → 导出 Markdown → 调用轨迹 → git 图（Electron 与 Web 两种宿主都要能用）

P11 文件层深度 + 预览插件宿主（4 天）
    git 可见性 / 软链授权 / 增删改 / 索引 / 监听 → 插件宿主 → docx + CSV 两个插件包
    验收：未装时提示安装，装后能预览，卸载回提示

P12 收尾（3 天）
    移动端改名 + 云 origin 切换 + 打包（mac/win 安装包、Web 产物、APK）
    可选：office「编辑」工具包（你指定放最后）

P13 验收与归档（1 天）
    三端连通回归、远程策略登记核查、路线图归档
```

**顺序理由**：P0/P1 是法律与品牌底线；**P3 是地基**（跑不通就立刻退回「只做桌面」）；P4 是你最直观的痛点且 D3 需要真机验收；P6 起每项独立可交付。

---

## 11. 验收（每阶段共用）

| 层 | 手段 |
|---|---|
| 类型 | `pnpm typecheck`（node + web 两套 tsconfig） |
| 单测 | `pnpm test`（`node --test test/**/*.test.ts`）+ 随迁的 PI NEXT `.test.mjs`（同为 `node --test`） |
| 移动端 | `flutter analyze` + `flutter test` |
| **运行时工具可见性** | 起独立端口宿主，`get_tools` 确认新工具真的露给模型（**编译绿、单测绿都不证明模型看得见**） |
| 三端连通 | Electron / 浏览器 / 手机分别发消息并流式收回 |
| 远程策略 | 每个新通道同时登记 `remote-policy` 与 `capabilities`（漏了宿主拒绝启动） |
| 真机 | D3 电脑操控在 macOS 12.7.1 上实跑；打包后 `hdiutil verify` + 真窗口点击验证 |

---

## 12. 风险

| 风险 | 缓解 |
|---|---|
| P3 Web 端不成立 | 第一个功能交付物，失败只损失 2 天 → 回退到「只做桌面」 |
| MCP §6 的甲/乙选错，返工 | 先在 P8 第一项做最小验证（切 builtin:mcp 后能否保住现有连接行为），再铺开 |
| 自建云未就绪期间远程不可用 | 局域网 + 隧道（P7）先顶着；契约 §9 给了可先做的子集 |
| 电脑操控系统命令版抢焦点 | 工具描述如实写明不能后台投递；需要 foreground 语义时加一次确认 |
| 会话目录开关切换丢数据 | 首次切换提供「复制一份」而不是移动；开关默认隔离 |
| 改名破坏出处标注 / 上游可比性 | §2.2 两类人工复核，脚本只做批量部分 |
| 与 FastVibe 上游演进脱节 | 移植区独立成 `src/main/pinext/**`，原文件只加不改 + 每处标 `fork:` |

---

## 13. 待你定（三条，都可以边做边界定）

1. **MCP 结构**：走**甲**（切 pi 内置 `mcp` 扩展，功能补齐快、约 4 天）还是**乙**（保留 FastVibe 自己的连接管理，约 6–8 天）？
2. **自建云**：要不要我把**最小服务端**（端点 + 信令 + coturn 配置）也写出来当起点？
3. **office 编辑**：确认放到 P12 之后作为可选（默认不做）？
