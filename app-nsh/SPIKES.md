# SPIKES — P0 可行性闸门

计划 §10（P0）：每一项写成 `nsh test`（headless）或最小 `nsh run` 脚本，结果记在这里。
**判据全部通过才进 P1。**

> 本机尚未安装 `nsh` CLI，下表全部为空。填表规则：先写命令（可复制粘贴），跑完写结论 + 数字 + 日期。

---

## S1 · `fetch` 本机 pi server：`GET /api/sessions`

- **验证什么**：1～5 MB 的 JSON 能解析，500 ms 内完成，无节点配额错误。
- **命令**：
  ```bash
  # 起一个 pi server（端口 30142，见 nsh.json 的 network.http 收窄）
  # node ../bin/pi-web.js --headless --port 30142
  cd app-nsh && nsh run --target macos
  ```
- **结论**：
- **数字**（耗时 / 字节数 / 节点数）：
- **日期**：

## S2 · SSE：`GET /api/agent/[id]/events` 用 `getReader()` 逐帧解析

- **验证什么**：收到 `connected` + 至少 3 类事件 + 30 s 心跳；中断后重连收到完整快照。
- **命令**：
- **结论**：
- **数字**（首帧延迟 / 事件类型数 / 心跳间隔）：
- **日期**：
- **退路**（失败时）：退化为 3 s 轮询 `GET /api/agent/[id]`。

## S3 · `TextView` 渲染真实助手回复（代码块 / 表格 / 公式 / 图片）

- **验证什么**：流式追加不掉帧；`streamingCaret` 正常。
- **命令**：
- **结论**：
- **数字**（帧率 / 单次追加耗时 / 节点数）：
- **日期**：
- **退路**（失败时）：分块渲染（`lib/markdown-blocks.ts` 思路）。

## S4 · `Terminal` + 现有 `/api/terminal` SSE + `POST input`

- **验证什么**：能跑 `ls`、`vim`、中文、颜色、resize。
- **命令**：
- **结论**：
- **数字**：
- **日期**：
- **退路**（失败时）：终端功能砍掉，用 WebView 兜底。

## S5 · `process.spawn("node", [...])` 启动 pi server 并读 `PI_WEB_READY`

- **验证什么**：桌面 target 上能起服务并连上。
- **命令**：
- **结论**：
- **数字**（冷启动到 ready 的毫秒数）：
- **日期**：
- **退路**（失败时）：用户手动起服务（v1 接受）。

## S6 · 体积 / 内存 / 启动基准（空壳 vs +1 MB TSX）

- **验证什么**：空壳 `.app` ≤ 35 MB、启动 < 1 s、得到「源码 → bytecode」系数。
- **命令**：
  ```bash
  cd app-nsh
  nsh package --target macos        # 空壳
  # 再加 1 MB TSX 打一次，比较两次产物大小
  # 桌面测 footprint / 启动耗时
  ```
- **结论**：
- **数字**（空壳大小 / +1 MB 后大小 / 系数 / 启动 / RSS）：
- **日期**：
- **退路**（失败时）：按计划 §2.5 的削减清单逐项砍。

---

## 待验证的 NSH API（`TODO(nsh): verify`）

本目录代码里所有 `TODO(nsh): verify` 都记到这里，验证后删掉对应行。

- [ ] `src/ui/colors.ts`：自定义 token 名（`user-bubble` / `assistant-bubble` / `tool-card` /
      `radius-card` / `destructive-foreground`）是否都写进了 `.nsh/types/nsh/tokens.d.ts`
      （已从 `crates/nsh-bundler/src/types.rs:58-76` 确认生成规则；没跑过 `nsh`，名字是否通过
      `theme.json` 的解析器未知）。
- [ ] `nsh.json`：`capabilities.process.execute` 里的 `"node"` / `"npx"` 是否要写成绝对路径
      （计划 §11 说 exec 名精确匹配，`/usr/local/bin/node` 要单独列一项）。
- [ ] `nsh.json`：`webview.input: false`、`windows.kinds: ["normal", "dialog"]` 在本版本
      `nsh build` 下是否都被接受（`access.rs` 的 `KNOWN` 与 `windows_grant` 有校验）。
- [ ] 样式：`w-72`（18rem）与 `px-3` / `py-2` / `gap-1` 这些 spacing class 在默认 Tailwind
      主题下是否都被 `nsh build` 认（`styles.md` 只保证“Tailwind v4 子集”，本机没跑过）。
- [ ] `src/ui/icons/drawer.tsx`：`props.tint ?? colors.text` 在 `draw` 里读 `props` 与 `token()`
      时是否重绘（`canvas.md:3-6` 说 `draw` 会在它读的信号变化时重跑）。

---

## 环境前置：本机没有 nsh（2026-11-14 实测）

| 步骤 | 结果 |
|---|---|
| `rustup` 安装 | ✅ rust 1.100.0（`~/.cargo/bin`，需 `source ~/.cargo/env` 或把 `~/.cargo/bin` 放进 PATH） |
| `curl -fsSL https://nsh.dev/install.sh \| sh` | ❌ 卡在 GitHub release 下载：`nsh-macos-arm64.tar.gz` 0 字节、`Broken pipe` |
| Homebrew | ❌ 本机无 `brew` |
| **可行退路** | ✅ 用仓内 `重构/nsh-main` 源码自编：`RUSTUP_TOOLCHAIN=stable CARGO_HTTP_MULTIPLEXING=false cargo build --release -p nsh-cli --bin nsh` → `重构/nsh-main/target/release/nsh` |

注意两点：
1. `重构/nsh-main/rust-toolchain.toml` 要求 iOS + Android target，rustup 会去下 6 个 `rust-std`。想跳过就 `RUSTUP_TOOLCHAIN=stable`（只拿默认 target）——**只是本机构建省时间，打包 iOS/Android 时仍需要它们**。
2. crates.io 在本网络下偶尔报 `Stream error in the HTTP/2 framing layer`，加 `CARGO_HTTP_MULTIPLEXING=false CARGO_NET_RETRY=20` 可过。

装好后把它软链进 PATH：`ln -sf "$PWD/重构/nsh-main/target/release/nsh" ~/.local/bin/nsh`

---

## S6 体积基准（实测，2026-11-14，nsh 0.5.1，Apple Silicon）

命令：`nsh package . --target macos -o /tmp/nshpkg`（骨架应用，含 13.7k 行 TS 搬迁件 + API 层）

| 项 | 实测 | 计划 §2.5 的估算 | 偏差 |
|---|---|---|---|
| `.app` 磁盘 | **47 MB** | 25–38 MB | 高估了乐观程度 |
| 压缩后（zip ≈ dmg 的量级） | **19 MB** | 11–16 MB | 同上 |
| 应用 JS | 28.2 KB | 2–4 MB | 预估把 bytecode 想大了 |
| 应用 bytecode | 33.8 KB | — | |
| `Contents/Resources` 合计 | 44 KB | — | 几乎全部是 `bundle.nshc` + `app.json` |

**结论：47 MB 全部是 `Contents/MacOS/Pi` 这一个 Rust 二进制**（`du` 显示 47M/47M）。也就是说：
- 应用代码多寡对体积几乎无影响（我们 13.7k 行 TS 只占 62 KB）；
- **47 MB 是 0.5.1 的 macOS 目标地板**，压不动，除非 NSH 自己减 feature；
- `nsh package` 没有 strip/opt/size 参数（`--help` 里没有）。

对比：现在 Electron 版 `PI NEXT.app` = 463 MB、dmg 218 MB → **NSH 版是它的 1/10（磁盘）和 1/11（下载）**。pi-gpui = 16 MB 磁盘 / 7.3 MB 下载（它没有 JS 引擎，也没有 platform 层）。

## ⛔ 硬阻塞：macOS 13 跑不起来

本机 `sw_vers -productVersion` = **13.7.8**；NSH 的 README 写的是 **macOS 14+**。实测两次都崩在同一个地方：

```
-[NSApplication activate]: unrecognized selector sent to instance 0x…
fatal runtime error: Rust cannot catch foreign exceptions, aborting
```

- `nsh run --target macos` → `the macOS host exited with signal: 6 (SIGABRT)`
- 打包后的 `/tmp/nshpkg/Pi.app/Contents/MacOS/Pi` → 同样崩

所以**这台机器上无法验证 native macOS 目标**。可行路径：

| 路径 | 是否可行 | 说明 |
|---|---|---|
| 升级到 macOS 14+ | ✅ 最直接 | 之后 `nsh run --target macos` 即可 |
| `--target web`（浏览器） | ✅ macOS 13 可用 | 需要 `web` 组件（14.6 MB，GitHub 下载中） |
| `--target tui`（终端） | ✅ 任意系统 | 需要 `tui` 组件（17.9 MB，GitHub 下载中） |
| `--target gpui` | ？ | 需另下 24.5 MB；GPUI 自身门槛未知 |

### ✅ 已自行打补丁，macOS 13 现在可以跑（2026-11-14）

三处改动，详见 [`../nsh-macos13-patch.md`](../nsh-macos13-patch.md)：

| 文件 | 改动 |
|---|---|
| `crates/nsh-platform-macos/src/app.rs` | `pub(crate) fn activate(&NSApplication)`：有 `activate` 用它（14+），否则 `activateIgnoringOtherApps(true)`（13）；两个调用点改走它 |
| `crates/nsh-platform-macos/src/surface.rs` | 帧时钟抽象 `FrameClock`：14+ 用 `CADisplayLink`，13 用 60 Hz `NSTimer`（`tick:` / `tock:` 两个选择器） |
| `crates/nsh-cli/src/apple.rs` | `MACOS_MINIMUM` `"14.0"` → `"13.0"`（否则打包的 app 被系统拒绝启动） |

**实测（macOS 13.7.8）：**

| 检查 | 结果 |
|---|---|
| `nsh run --target macos` | ✅ 不崩，host 常驻 |
| JS 执行 | ✅ `js BEFORE MOUNT` |
| 组件挂载 | ✅ `SHELL MOUNT` → `PANEL MOUNT` |
| 到 pi-web 的请求 | ✅ `PROBE OK 200 /api/sessions?summary=1` |
| 应用自己的 `listSessions()` | ✅ **`FETCH OK 886`**（本机 886 个会话） |

**代价 / 已知降级**
1. 13 上帧率固定 60 Hz（`NSTimer` 没有 `preferredFrameRateRange`），120 Hz 屏不自适应、不与 vsync 对齐。
2. 必须**同时**自编 `nsh-cli`：main 的 host 认识 `capabilities.application`，v0.5.1 的 CLI 不认识，混用会报 `not granted (one of a newer NSH, or a typo)`。
3. 覆盖已签名二进制要先删再拷 + `codesign --force --sign -`，否则被 SIGKILL（exit 137）。
4. `nsh package` 用的 `runtime/macos/nsh-macos-app`（release runner）**仍是上游 14+ 版本**，要发 13 版安装包还得 `cargo build --release -p nsh-macos-app` 替换。

**另一个发现**：`nsh test` 的宿主**没有网络栈**（`TypeError: Network request failed: this host has no network stack`），所以依赖真实 HTTP 的验收点只能通过 `nsh run` + `console.log`（加 `-v` 可见 `info … js <日志>`）或真实窗口验证。

---

## P2–P6 全功能接线（2026-11-14，5 个子代理并行 + 集成）

### 交付规模

| | |
|---|---|
| `src/` 代码（不含测试） | **18,473 行 / 68 个文件** |
| 构建产物 | 371.4 KB js + 1.4 MB bytecode |
| `tsc -p tsconfig.json --noEmit` | **0 error** |
| `nsh build` | **0 warning**（= 所有 static class 都被 Tailwind 子集识别） |

### 各块

| 区域 | 文件 | 行数 |
|---|---|---|
| 聊天 + 流式 | `state/agent.ts`、`screens/chat/{ChatView,MessageView,ToolCallView}.tsx` | 688 + 384 + 502 + 257 |
| 输入条 | `screens/chat/{Composer,ModelPicker}.tsx`、`state/composer.ts`、`api/models.ts` | 407 + 232 + 482 + 102 |
| 文件 / Git | `api/{files,git}.ts`、`screens/files/{FileTree,FileView,ChangesView,state}.tsx` | 247 + 88 + 268 + 278 + 246 + 24 |
| 终端 | `api/terminal.ts`、`screens/terminal/TerminalView.tsx` | 222 + 263 |
| 设置 7 节 | `api/config.ts`、`screens/settings/*` | 493 + 1,659 |
| 外壳 | `screens/Shell.tsx`、`state/session.ts` | 160 + 45 |

### 实测（macOS 13.7.8，前面补丁之后）

| 检查 | 结果 |
|---|---|
| `nsh run --target macos` | ✅ host 常驻，无告警 |
| 会话列表 | ✅ 886 条（`FETCH OK 886`） |
| 自动打开最近会话 | ✅ 新加的 `effect`：未选中时选第一条 |
| 聊天渲染 | ✅ **`CHAT READY 100 messages`**（读取 + 渲染真消息） |
| 全仓 tsc | ✅ 0 error |

### 集成时遇到的问题（记下来）

1. **`Button` 从 `"nsh"` 导入会报错**，必须是 `from "nsh/base"`（`nsh` 只导出 View/Text/Scroll/Overlay/Image/WebView/Video/List/Canvas 等 host element）。
2. **`classList` 的值必须是布尔，不能是 accessor**：`{"bg-accent": rightPane() === x}` ✅；`{"bg-accent": () => …}` ❌（`TS2322`）。
3. **图标表缺 3 个**（`folder` / `git-branch` / `terminal`）：`examples/gallery/lucide.ts` 只收了 gallery 用到的子集。已换成表里已有的 `file-text` / `square-code` / `code`。要真图标就扩 `scripts/` 里的生成脚本，**不要手写 path data**。
4. **两个 `selectedSessionId` 信号**：侧栏原本自己定义了一个，聊天面板读的是 `state/session.ts` 的。已统一到 `state/session.ts`（否则点会话不切换聊天）。

### 仍未实现（子代理报告里明确留下的）

- 上传（`FormData` + `Picker` 未在 NSH 上验证）、PDF/DOCX 预览（需要 `WebView`）、Mermaid（`eval` 被移除，v1 降级为代码块）
- 输入框的修饰键（NSH 的 `Input.onKeyPress` 只给文本/Backspace/Enter，没有 Shift/Ctrl/Alt）、`@` 文件补全、图片粘贴
- 设置里的重活：MCP add/remove/undo/sign-out、skills/plugins 的安装与搜索、配对码/二维码
- 终端触摸端的额外键条
- 会话分页：pi 0.0.4 的 `/api/sessions/[id]` **没有 `?before=` 游标**，所以上翻是「`tail` 翻倍」（50→100→200…，上限 1000）

---

## 第二轮：改用 NSH 现成组件库 + 对齐 pi-next（2026-11-14）

### 上一版错在哪

第一版让子代理用 `nsh/base` 裸原语（`View`/`Text`/`Button`）+ 手写 Tailwind class 拼界面，结果零散、样式不成体系。

NSH 里本来就有现成的：

| 位置 | 是什么 |
|---|---|
| `examples/nsh-gallery-ui/`（**7,189 行**） | 一整套**样式化组件库**：`index.tsx`（`Card Inset Section Row Badge Status Spinner Button RoundButton ToggleButton IconTile Sheet Tip Meter …`）、`demo.ts`（`field inputLook listRow plainRow sectionSurface menuPopup menuItemLook toolbarTrack dialogCard toastLook tabsLook …`）、`theme.ts`（`colors ui tint finish`）、`look/*`（button/field/menu/overlay/switch/listbox/tabs/surface/workspace…）、`tree.tsx`、`command.tsx`、`popup.tsx`、`icons.tsx`（761 行 Lucide） |
| `website/demos/home-chat.tsx`（402 行） | NSH 官方的 **AI 聊天应用**（线程 + 气泡 + 玻璃控件 + 输入条 + 多端形态） |
| `examples/gallery/demos/chat/*` | 消息部件（`markdown.tsx` 流式、`parts.tsx` 工具卡、`glyphs.tsx`） |

已把整个 `nsh-gallery-ui` 搬到 `app-nsh/src/ui/kit/`，并把 `theme.json` 从 22 个 token 扩到 **64 个**（保留 pi 的颜色值，补上 kit 需要的 `inset/raised/field/line/faint/brand/brand-fill/on-brand/track/knob/code/info/warn/up/down/violet/scrim/chart-1..5/window-*/…-tint/hover/pressed`）。

### 规模（第二轮后）

| | |
|---|---|
| `src/` 代码 | **28,826 行 / 90 个文件**（含 kit 7,189 行） |
| 构建 | 697 KB js + 2.4 MB bytecode，**0 warning** |
| `tsc --noEmit` | **0 error** |

### 7 个子代理并行改的

| 区域 | 结果 |
|---|---|
| 聊天区 | `ChatView/MessageView/ToolCallView` 改用 kit（`Card Row Inset Badge Spinner IconTile Press`）；内容列 820、气泡 72%/圆角 12、正文 13.5/23 |
| 输入条 | `Composer/ModelPicker` 用 `fieldLook/inputLook/menuPopup/listboxProps`；最大宽 820、输入条圆角 14、按钮 30 |
| 文件/Git | `FileTree/FileView/ChangesView` 用 `TreeRow treeItemClass`、`diffViewStyles`、`dataTableClasses`、`textViewLinkClasses`；行高 28、缩进 14、git 徽标 16 |
| 设置 8 节 | 全部 kit（`Card plainRow switchLook listboxProps numberInputClasses sliderLook Badge Status`）；侧栏 220 + 内容 640，行 11/13/11 |
| 外壳 + 侧栏 | `sectionSurface listRow iconButtonLook tabsLook`；pane 圆角 16、inset/gap 8、chrome 44、侧栏 268（窄屏 240）、右栏 420、手机抽屉 |
| 终端 | `toolbarTrack iconButtonLook`；新增 `TerminalExtraKeys`（触摸端 Ctrl/Alt/Esc/Tab/方向，序列取自 pi 的 `lib/terminal-extra-keys.ts`） |
| 浮层 | 新建 `CommandPalette`（⌘K）、`ExtensionDialog`（extension_ui_request 全 method）、`Toasts`；用 `command.tsx popupSurface dialogCard toastLook` |

### 实测（macOS 13.7.8）

```
nsh build                  ✅ 0 warning
tsc --noEmit               ✅ 0 error
nsh run --target macos     ✅ 无错误
SHELL MOUNT                ✅ 外壳挂载
CHAT 103                   ✅ 聊天渲染 103 条消息
token 解析                 ✅ background=#ffffffff / brand=#245bceff / radius=16 / radius-card=12
```

### 集成时补的

- 浮层三个组件**无条件挂载一次**（`CommandPalette` 自己持有 `mod+k` 绑定），`Toasts` 放最后。
- `theme.json` 必须补 kit 的 token，否则 `token()` 返回 undefined → 界面透明（`tokenprobe` 单测确认全部解析）。

---

## 第三轮：官方组件复用 + nsh test 驱动修复（2026-11-14）

### 用户指出的两个真问题（已确认是我做错）

1. **没用 NSH 官方组件**。`https://nsh.dev/gallery` 的源码就是 `examples/gallery`（`website/src/components/Gallery.astro:2`），
   其中的 **AI chat** = `demos/Chat.tsx` + `demos/chat/{parts,markdown,glyphs}.tsx`。第一版让子代理用 `nsh/base` 裸原语自己拼样式，
   既没复用它们，也没复用 `examples/nsh-gallery-ui` 那套样式化组件库。第二轮才搬：`src/ui/kit/`（7,189 行）+ `src/ui/chat/`（官方聊天部件）。
2. **"用了组件"是假的**（`tsc` 过但界面不像）。已用 `nsh test` 真跑校验，并把 4 个真 bug 修掉（见下）。

### 用 `nsh test` 跑出来的真 bug（4 个，全部已修）

| # | bug | 根因 | 修法 |
|---|---|---|---|
| 1 | 选会话约 2 秒后 Send 变 Stop，消息发不出去 | `/api/agent/[id]` 的 `running` 是"RPC 会话存在"，对所有打开的会话恒为 true；composer 把它 OR 进了运行态 | 只看 `isStreaming / isPromptRunning / isCompacting`（与 `useAgentSession.ts:1565,1711` 一致）；`applyQueueUpdate` 不再置 running |
| 2 | 文件树单击文件不出预览（用户报告的"文件预览坏了"） | `onSelectedChange` 只移动选中，只有 `onAction`（双击/回车）才 `openFile` | 单击文件即 `openFile`，文件夹仍走 `onAction` 展开 |
| 3 | 侧栏一打开就崩（`cannot read property 'push' of null`） | 新 turn 折叠里 `flush()` 把 `current` 置 null 后仍 `current.push()` | 先建数组再 push |
| 4 | 搜索被"show more"窗口截断，命中行看不见 | 侧栏每组只显示 6 行 | 有查询词时不设窗口（过滤就该给全部命中） |

### 组件与字体

- `src/ui/kit/`：官方样式化组件库（`Card Inset Section Row Badge Status Spinner Button RoundButton ToggleButton IconTile Sheet Tip Meter`、`field/inputLook/listRow/sectionSurface/menuPopup/toolbarTrack/dialogCard/toastLook/tabsLook/diffViewStyles/dataTableClasses`、`look/*`、`tree.tsx`、`command.tsx`、`popup.tsx`、`icons.tsx`）。
- `theme.json` 从 22 个 token 扩到 **64 个**（kit 需要 `inset/raised/field/line/faint/brand/track/knob/code/info/warn/up/down/violet/scrim/chart-*/window-*/*-tint/hover/pressed`），`tokenprobe` 单测确认全部解析。
- **中文字体**：`src/ui/fonts.ts` —— macOS/iOS `PingFang SC → Hiragino Sans GB → Helvetica Neue`、Windows `Microsoft YaHei UI → Segoe UI`、Linux/Android `Noto Sans CJK SC`、Web 全并集；mono 用 `JetBrains Mono` + CJK 等宽回退。依据 `docs/dev/macos.md:214`（CoreText cascade list）。**不再依赖系统回退**（那是"默认字体不是中文"的原因）。
- **NSTextView 的疑问**：`Input` 在 macOS 上就是 `NSTextField`，多行是 `NSTextView`（装在 `NSScrollView` 里，`docs/dev/macos.md:221`）；`Text`/`TextView` 走 CoreText 绘制并带 AppKit 选择/复制/右键菜单（`:214`）。这是 NSH 的设计，不是我们没用原生控件。

### 测试

`tests/` 共 **18 条**，`nsh test`（无头）与 `nsh test --target macos`（真 AppKit 窗口）都跑：

```
18 tests: 18 passed, 0 failed
```

- `tests/support.ts`：`network: "live"` 连真 pi-web；`FIRST_SESSION = "id:session-row >> nth=0"`（侧栏行有共享 testID）。
  **不硬编码会话标题**——标题来自机器历史（子代理会话、项目改名、家族折叠都会改变它），这是上一轮 16 条一起挂掉的原因。
- `tests/{shell,composer,files,palette,settings,panels,fonts,i18n}.test.tsx`。
- 发现 `nsh test` 的宿主默认**没有网络**（`this host has no network stack`），必须 `network: "live"`。

### 规模

| | |
|---|---|
| `src/` 代码 | **36,518 行**（含 kit 7,189） |
| 构建 | 982 KB js + 3.6 MB bytecode，0 warning |
| `tsc --noEmit` | 0 error |
| 剩余 `TODO(nsh)` | 32（均为小项：批量删除、模型 clear/prune、插件 standalone 列表、终端 DECCKM 等） |

---

## 第四轮：全部界面中文化 + 功能补齐（2026-11-14）

### 中文（用户报告"都是英文的"）

**根因**：`src/i18n/` 的 1,721 个键早就搬进来了，但**没有一处界面调用 `t()`**——所有文案是硬编码英文。

**做法**：
1. 新建 `src/ui/i18n.ts`：`locale` 信号 + `t(key, params)`，词典就是 pi-next 的 `src/i18n/messages/{en,zh-CN,zh-TW}.ts`。
   `t()` 必须在 JSX 绑定里调用（组件体只跑一次），这样切语言只重算读文案的绑定。
2. 默认语言**跟随系统**（`localeSettings().languages`，`docs/dev/js-modules.md`），存在 `pi-locale` 偏好里；无偏好时中文系统 → `zh-CN`。
3. 6 个子代理分区接入：外壳/侧栏、聊天区、文件/终端、设置 9 节、浮层/新建会话。共 **约 400 处 `t()`**。
4. 词典从 1,721 → **2,265 键**，三语一致（新增的键都真翻译成简/繁中文）。
5. **General 里加语言切换**（English / 简体中文 / 繁體中文），选择写入偏好。

**踩到的坑**（QuickJS 的 `Intl` 是子集）：`formatRelativeTime` 原本用 `Intl.RelativeTimeFormat`，在 NSH 里**不存在**，启动即抛 `not a function`。
已改为词典驱动（`i18n.secondsAgo` / `minutesAgo` / `hoursAgo` / `daysAgo` / `inHours` …）。`Intl.Collator/PluralRules/ListFormat/DisplayNames/Segmenter` 同样不可用，不要用。

### 功能对照（按路由覆盖衡量）

pi-next 有 **73 个 API 路由**，app-nsh 从 53 → **71** 个接上（剩 `push/config`、`push/subscribe`，PWA 专用，NSH 用系统通知替代）。本轮补的：

| 区域 | 补了什么 |
|---|---|
| 认证 | `auth/providers`、OAuth 登录 SSE（授权地址/设备码/进度/粘贴 code）、API key 保存/删除、登出 —— 新的 **Providers** 设置节 |
| 新建会话 | `home`、`default-cwd`、`cwd/browse`（含盘符）、`cwd/validate`、`open-in-explorer` —— 目录选择器 + 新会话面板 |
| 信任 | `project-trust` 读写 + 信任对话框（列出项目 MCP 服务器） |
| 工作树 | `worktrees` 列表/新建/删除（409 分支占用、dirty 强制删除） |
| 模型配置 | `models-config` 读写、models.dev 目录搜索、Discover、Test |
| 会话 | `export`（WebView 预览 + 存到 dataDir）、`auto-name` |
| 延迟数据 | 思考块、工具结果图片、bash 完整输出（含下载） |
| 杂项 | `cache-miss-notices` 开关、`provider-usage` 配额、`app-update` |
| 错误文案 | 新建 `src/ui/errors.ts`：超时/连不上/401/403/404/cwd 丢失/413… 22 个键，替换 20+ 处 `String(error)` |

### 又修的 3 个真 bug

1. **「Settings」按钮有两份**（顶栏 + 侧栏底）→ 删顶栏那个，与 pi-next 一致（只在侧栏底）。
2. server 端 `cwd` 已不存在的项目：错误直接画在顶栏 → 现在走 `errorText()`，可读。
3. 侧栏「自动选最近会话」与「新建会话」互相打架 → 新建时置 `freshSession`，自动选中让位。

### 状态

```
src/             45k+ 行
tsc --noEmit     0 error
nsh build        1.7 MB js + 5.6 MB bytecode，0 warning
nsh test         21 tests: 21 passed
词典             2,265 键 × 3 语言
```

### 测试如何不依赖语言

`nsh test` 宿主的 `localeSettings()` 报 `en-US`，所以测试跑英文、用户机器跑中文（跟随系统，正确行为）。
为此：关键控件加 `testID`（`session-row`、`search-sessions`、`open-settings`、`new-session`、`pane:files|changes|terminal`、`composer-input`），
测试只用 testID 或 `label:/Connected|已连接/` 这类双语正则，不再硬编码某一语言的文案。

---

## 第五轮：右栏 dock、文件 tab、输入条、设置与动效（2026-11-14）

按用户逐条反馈做的（"右栏不行/缺侧聊子代理"、"文件预览别放下面"、"发送按钮要最右/上传按钮看不见/模型与强度合一/强度只显示低中高/无法引用文件/排队别一堆按钮"、"模型只有 9 个/新增与管理分开/技能插件 MCP 子代理不全"、"动效没有/思考不能折叠/没有 minimap/没有模型速度"）。

| 区域 | 做了什么 |
|---|---|
| **右栏 dock** | 新的 `src/screens/panel/`：`PanelDock` + `PanelTabs`，tab 种类 `files / changes / terminal / branches / system / tools / session / file:<path> / agent:<id> / side:<id>`；侧聊与子代理是**独立 tab**（`SideChatPanel`、`AgentPanel`），从侧栏行菜单/子代理卡打开；关最后一个 tab 收起右栏 |
| **文件面板** | 树占满面板，**每个文件一个 tab**（`screens/files/tabs.ts`，按 cwd 记忆、上限 20、可关、回到树）；不再有"树 + 下面查看器" |
| **输入条** | 一行：`+` 附件（回形针，可见）→ 模型/强度**合一个 split chip** → 空白 → **发送/停止在最右**；强度只显示 `关 / 中 / 高`（7 档内部映射，精确档在菜单里）；运行中发送变 ●，旁边的 chevron/长按出「排队 / 引导」——原来三个并列按钮删掉 |
| **@ 引用** | 修了三个 bug：菜单要求"已加载"才开（首次 `@` 永远不开）、rows 读的是非响应式 Map（加载完不刷新）、目录选中反而关闭菜单。现在加载中也开、有 loading 行、目录保持打开可下钻 |
| **设置** | Models 合成一页（默认模型 + 全部模型 98 个（`?scope=all`）+ 提供方登录 + models.json 编辑器）；"模型只有 9 个"的根因是旧页面只读 `enabled` 与 `modelList`，而 models.dev 预设只在 `models-config/catalog`；Skills 加 SKILL.md 全文 + 目录跳转；Plugins 加资源清单；MCP 加工具列表 + exposure；Agents 加提示词/工具只读预览 |
| **聊天** | 思考块可折叠（`Collapsible` + 记住 `pi-thinking-expanded`）；**minimap**（右侧 30pt 轨道，按轮次刻度、点击 `scrollToIndex`、`Mod+Shift+M` 开关、桌面显示）；**tok/s** 在统计条（流式显示，结束后保留 5s）；新消息淡入上移、折叠高度 `LayoutAnimation`（`src/ui/motion.ts`，`reduceMotion()` 时直接到位） |

### 又修的问题

- `transitionProperty: "width, background-color, opacity"` 触发 NSH 警告（只支持颜色/透明度/transform/阴影）→ 去掉 width。
- 顶栏与侧栏的「新建会话」语义不同（一个是打开面板、一个是立刻建会话），testID 拆成 `new-session` / `new-session-now`。

### 测试怎么跟上 UI 变化

单个「空闲会话显示 Send 不是 Stop」的假设不成立：最新会话往往就是**正在运行的这个**。改成断言"Send 与 Stop 恰有一个"
（`send + stop === 1`）。文件测试改为新行为：树占满 → 单击开 tab → 关 tab 回树。

```
tsc --noEmit   0 error
nsh build      1.8 MB js + 6.4 MB bytecode，0 warning
nsh test       21 tests: 21 passed
```

---

## 第六轮：接入 NativeScript 桥（原生视图）— 2026-11-15

克隆并跑通了 `https://github.com/nstudio/native-shell-with-ns`（把 **NativeScript** 装进 NSH 的 JS VM，
于是 TSX 里能直接调 AppKit / UIKit / Android 的类，并把**平台自己的视图**放进 NSH 布局）。

### 做了什么

1. 对方仓库需要 **NSH 的三个钩子**（`patches/nsh-hooks.patch`）：`nsh-engine::run_on_engine` + `Message::Run`、
   `nsh-js::set_context_hook`、以及有钩子时 `Host::drop` 里 `mem::forget(runtime)`。已把这套打进**我们自己的**
   `重构/nsh-main`（不是用它 vendor 的 nsh）。
2. 把 `crates/nsh-ns`（桥本体 + `c/` 里的 Node-API/baton C 源）作为 workspace 成员搬进我们的树，
   `Cargo.toml` 的 `../../vendor/nsh/...` 路径改为 `../...`。
3. 它依赖 NSH 平台层，而 0.4/0.5 都用了 macOS 14 才有的 API → 把我们的 **macOS 13 补丁**也打进桥用的那棵树
   （`activate()` 回退、`FrameClock` 用 60 Hz `NSTimer`），否则在这台 13.7.8 上直接崩。
4. 编出 `重构/nsh-main/target/release/nsh-ns`（46 MB）。
5. 应用侧：`src/screens/native/NativeView.tsx`（`NativeView` 容器 + `makeSlider/makeSwitch/setSlider/setSwitch`，
   按 macOS/iOS/Android 分支）、`NativePanel.tsx`（设置 › Native），并在 `SettingsDialog` 加导航项与文案（三语 10 键）。

### 验证

| 检查 | 结果 |
|---|---|
| 对方 showcase 在 `nsh-ns` 下 | ✅ 起来（`MKMapView` 报 no native counterpart，是其示例的 MapKit 类型，与桥无关） |
| TSX 里直接建 AppKit 控件（探针） | ✅ `NSSlider=true value=42 os=Version 13.7.8 NSValue=function` |
| 我们的应用在 `nsh-ns` 下 | ✅ 无 JS 错误、到 pi-web 2 条连接 |
| 我们的应用在 `nsh run` 下 | ✅ 设置 › Native 提示“未含桥”，退回 NSH 控件（不会白屏） |

### 不在本机做 iOS/Android 的原因

无 Xcode（只有 CLT）、无 Android SDK、无移动端 rust target。代码路径已按平台写好（`UISlider`/`UISwitch`、
`SeekBar`/`Switch`，容器按 `NSValue`/`NsBridge.hostView` 挂载），需要带 Xcode/SDK 的机器才能编译验证。

### 文档

`app-nsh/docs/native-views.md`：两个运行器的区别、构建步骤、三个钩子、macOS 13 补丁、按平台的代码路径与限制。
