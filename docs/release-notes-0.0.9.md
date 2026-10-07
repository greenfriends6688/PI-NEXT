# PI NEXT v0.0.9

这一版先解决了一个「装着却用不了」的打包级根因：**打包后窗口还在、界面还在，所有接口却静默失效**，
点什么都像坏了。随后把 Markdown 流式渲染的卡顿做掉，定时任务补上生命周期，记忆面板能自动保存、
也不再被 agent 悄悄覆盖。

## 新增

- **定时任务生命周期**：反复运行时复用同一个会话，失败自动暂停，另加限次与运行超时两道闸；
  完成通知接到 Web Push，默认只在失败时响，可切成四档。
- **记忆面板**：编辑器停手约一秒自动保存；agent 改过磁盘上的记忆文件时不再静默覆盖，
  改为弹冲突横幅并可重新加载；另加「记忆周检邀请」——超过三天没整理、有新会话、冷却期也过了才提醒，
  只邀请，绝不代你写入。
- **图片与 PDF 预览缩放**：Ctrl/⌘ + 滚轮缩放、拖拽平移、双击复位；
  认不出的二进制与未知类型改用降级卡片，列出元数据并可用系统应用打开。
- **思考块自动展开**：流式期间自动展开，结束后一秒折叠，悬停即预取。
- **MCP 启用前先握手**：开启一个服务前真实连一次，失败不再假装已启用。
- **内置技能目录**：许可核查后收录 2 个可再分发的技能，需要时显式播种，不会自动塞给你。
- **会话自动命名与提示音**：首轮回复后自动命名会话，另加 4 类语义提示音。
- **性能探测与错误边界**：加一个查询参数即可打开性能探测；同时补上应用级错误边界，
  出问题不再整页白掉。

## 改动

- **Markdown 流式性能**：文本节流、代码高亮错峰、流式期间不做同步公式排版、预览行号按需生成，
  500+ 消息的长会话边流边读不再卡。
- **文件树与 git 状态**：文件树接上目录变更的实时订阅，改完文件树里立刻出现；
  git 状态单独去抖，不再跟着其它刷新一起抖。
- **字号与颜色收口**：一批内联字号和硬编码颜色收进统一的设计变量，五套主题各配一组
  危险 / 成功态对比色。
- **弹层焦点管理**：打开移焦、Tab 循环、Esc 关闭、背景不可交互、关闭后焦点还原，
  全部模态弹层都已接入。
- **对比度与触控**：浅色三套主题的次要文字对比度修到 WCAG AA 并接入门禁，触控目标补到 44px。

## 修复

- **打包后「按钮点不了」**：打包排除规则误伤了运行时代码目录，钩子加载失败、内嵌服务起不来，
  表现为窗口还在但所有接口静默失效。已修复并重新打包验证，另加构建期硬门禁、九项接口冒烟
  与导航拦截留痕，避免再次静默发版。

## 已知

- 本版是**纯源码发布，没有 dmg**，需要自行打包。

---

## English

This release first resolves a packaging-level root cause of "installed but unusable": **after packaging the window is still there and the UI is still there, but all APIs silently fail**, and clicking anything feels broken. Afterwards the Markdown streaming render stutter was eliminated, scheduled tasks got a lifecycle, and the memory panel can auto-save and is no longer silently overwritten by the agent.

### Added

- **Scheduled task lifecycle**: repeated runs reuse the same session, failures auto-pause, plus two gates—a run count limit and a run timeout; completion notifications are wired to Web Push, which by default only fire on failure and can be switched among four levels.
- **Memory panel**: auto-saves about one second after the editor stops typing; when the agent has changed the memory file on disk it no longer silently overwrites but instead shows a conflict banner and allows reloading; also adds a "weekly memory checkup invitation"—it only reminds when it has been more than three days without tidying, there is a new session, and the cooldown has passed; it only invites and never writes on your behalf.
- **Image and PDF preview zoom**: Ctrl/⌘ + scroll wheel to zoom, drag to pan, double-click to reset; unrecognized binaries and unknown types now use a fallback card that lists metadata and can be opened with the system app.
- **Thinking block auto-expand**: automatically expands during streaming and collapses one second after it ends; hovering prefetches.
- **MCP handshake before enabling**: really connect once before turning on a service, so a failure no longer pretends it has been enabled.
- **Built-in skill catalog**: after license review, 2 redistributable skills are included; they are seeded explicitly when needed and are not automatically pushed to you.
- **Session auto-naming and notification sounds**: sessions are automatically named after the first reply, plus 4 types of semantic notification sounds.
- **Performance probing and error boundary**: adding a query parameter opens performance probing; an app-level error boundary is also added, so problems no longer blank out the whole page.

### Changed

- **Markdown streaming performance**: text throttling, staggered code highlighting, no synchronous formula typesetting during streaming, preview line numbers generated on demand; long sessions with 500+ messages no longer stutter while streaming and reading.
- **File tree and git status**: the file tree is wired to a real-time subscription for directory changes, so edits appear in the tree immediately; git status is debounced separately and no longer stutters along with other refreshes.
- **Font sizes and colors consolidated**: a batch of inline font sizes and hardcoded colors is moved into unified design variables, and each of the five themes gets its own set of danger / success state contrast colors.
- **Overlay focus management**: move focus on open, Tab cycling, Esc to close, non-interactive background, and focus restoration on close—all modal overlays are now wired in.
- **Contrast and touch**: secondary text contrast in the three light themes is fixed to WCAG AA and wired into a gate, and touch targets are brought up to 44px.

### Fixed

- **"Buttons can't be clicked" after packaging**: the packaging exclusion rule mistakenly hit the runtime code directory, so hook loading failed and the embedded service couldn't start, showing up as the window still being there but all APIs silently failing. Fixed and re-verified with a fresh package, plus a hard build-time gate, nine API smoke checks, and navigation-interception logging to avoid another silent release.

### Known

- This release is a **source-only release with no dmg**, and you need to package it yourself.
