# 上游 `agegr/main`（v0.9.1 之后）逐 commit 判定 · 我们 fork 的覆盖情况

- 生成时间：2026-10-01（只读审计，未改任何文件）
- 上游范围：`v0.9.1..agegr/main` 的 **123** 条非 merge commit（任务描述说 124，实际命令输出 123 条；下表 123 行一一对应，按时间正序）
- 我们这边：`main` @ `e34c1c6`，fork 基线 `v0.9.1`（`166abb8 Merge upstream v0.9.1`），之后 274 个 commit
- 判定口径：**行为标志物**（函数名 / 路由 / i18n key / CSS 类 / 新文件）grep + 读对应文件确认语义，不是 diff 字面比对
- 注意：本仓里 `pi参考项目/pi-web-main/`（上游整份源码的 vendored 副本）、`pi-web-pr-inbox/`、`build/`、`docs/` 都**不算我们自己的实现**，所有 grep 已排除它们

## 已知的两块「有意为之的分叉」

1. **登录/密码认证整段被删**（`proxy.ts:19-27` 有用户裁定注释：本产品没有登录）。所以所有 `PI_WEB_PASSWORD` / `/login` / `web-auth` / Basic Auth 相关的上游 commit 一律判 `缺失`，但**不要照抄**，那是刻意的产品决策。
2. **fork 有大量自己的换肤/设计系统改造**（`app/fork-ui.css`、`.pw-*` 件、`design/pi-web-design/` 画板），上游的 CSS/布局类改动多数被另一套实现取代。

---

## 判定表

| 上游 commit | 主题（中文一句话） | 判定 | 证据（我们树里的文件:行，或"grep 无命中"） | 备注 |
| --- | --- | --- | --- | --- |
| `135517b` | 新会话首屏的品牌行与输入框对齐（π 字符换应用图标） | 已有 | `components/ChatWindow.tsx:2672`（品牌行用 `mx-auto` + `var(--composer-max-width, 892px)` + `var(--s4)` 内边距） | 首屏已被 `fork:zc-17 EmptyStateGuide` / `fork:ui-newhome NewSessionHome` 整体重做；对齐目标由变量达成，`next/image` 那条路我们没用（也不需要 `images.unoptimized`，见 `e5a2434`） |
| `c04bab7` | 文件 API 路径保留 Windows UNC 根（`//host/share`） | 已有 | `lib/file-paths.ts:9-13`（`fork:upstream-0.9.2-unc-roots`，`%2F%2Fhost` 单分段编码）、`lib/file-paths.test.mjs` | 行为一致 |
| `c1e544b` | `pi_web_session` cookie 改 `SameSite=Lax` | 缺失 | grep 无命中；`app/api/web-auth/` 目录不存在 | **不适用**：`proxy.ts:19-27` 用户裁定删掉整套密码登录。别补 |
| `fcd94bf` | 扩展对话框标题保留换行（照 pi TUI） | 已有 | `components/ChatWindow.tsx:3044`（`whiteSpace: "pre-wrap", wordBreak: "break-word"`）+ `renderDialogTitle` | batch A+B 里的 `effbbc0`/`1fbc91c` 已摘 |
| `e5a2434` | 升 Next.js 16.3.5 + 关掉图片优化器 | 已有 | `package.json:79`（`"next": "16.3.5"`）；`next.config.mjs` 无 `images.unoptimized`，全树无 `next/image`（grep 只在 `pi参考项目/` 命中） | 依赖已是 16.3.5；因为我们压根不用 `next/image`，图片优化器这条路不存在，关掉它等价于不做 |
| `ed0eea9` | 扩展下拉获得焦点的选项不被滚动容器边缘裁掉 | 已有 | `components/ChatWindow.tsx:3122`（`scrollMargin: 14`） | batch C-1 `166e02f` 已摘 |
| `20ad98b` | 密码登录失败加全局指数退避 | 缺失 | `lib/auth-throttle.ts` 不存在；grep `Retry-After` / `tooManyAttempts` 无命中 | **不适用**：登录已删 |
| `744ee93` | worktree 新增前先 `git fetch origin` + 拉高 git 超时 | 已有 | `lib/worktree.ts:254`（`git(repoRoot, ["fetch","origin"], 60_000)`）、`:59`（`timeoutMs` 参数） | batch A+B `74a9b11` 已摘 |
| `860698a` | 扩展 widget 字号设置 | 已有 | `hooks/useChatAppearance.ts:14,67`（`--extension-widget-font-size`）、`components/SettingsPanel.tsx:756`、`app/globals.css:820` | batch C-1 `8bfde49` 已摘 |
| `b42d3f4` | 用户手动展开的工具卡在流式更新中保持展开 | 已有 | `components/ChatWindow.tsx:634`（`expandedToolIds` 提升到 ChatWindow，跨流式→历史重挂载存活）、`components/MessageView.tsx:992` | 实现形态不同（我们是受控提升 state，上游是 `lib/tool-call-expansion.ts` 模块），效果等价 |
| `e70c367` | GPT 的 `apply_patch` 工具调用渲染成左右分栏 diff | 已有 | `lib/apply-patch.ts:33,199`、`components/MessageView.tsx:1557`（`SplitDiff`）、`lib/tool-names.ts:30-33` | batch A+B `4b634e7` 已摘 |
| `d2056b6` | 输入框里预览图片附件 | 已有 | `components/ChatInput.tsx:3208`（`ImagePreview`）+ `:1483`（`URL.createObjectURL`） | batch A+B `b180805` 已摘 |
| `3f07a5f` | 流式时显示本轮的思考级别（只读） | 已有 | `components/ChatInput.tsx:3785-3795` + i18n `chat.currentReasoning`（`lib/i18n/messages/en.ts:893`） | batch C-1 `e221058` 已摘 |
| `b44017a` | 能看到另一个 pi 进程写的会话 | 已有 | `app/api/sessions/[id]/route.ts:52`（`readLatestSessionEntryId` + `diskLatestId` 判定）、`lib/session-reader-external-write.test.mjs` | batch A+B `29c31a9` + 我们自己的 `34dc76f feat(sessions): external session write path` |
| `5b96a9d` | AGENTS.md 补 `PI_WEB_IDLE_TIMEOUT_MS` 说明 | 缺失 | `AGENTS.md` 无该串；只在 `bin/pi-web-options.js:50` 的 help 里有 | 纯文档 |
| `6edbecb` | AGENTS.md 同步 `app/api` 路由图 | 缺失 | `AGENTS.md:73` 有 `app/api/` 目录树，但与上游 0.9.3 的路由集不同步（如无 `app/api/models/refresh/`、`app/api/web-auth/`） | 纯文档 |
| `ed7a4d7` | AGENTS.md 文件图补 plugin-updates | 缺失 | `AGENTS.md` 的 lib 清单无 `lib/plugin-updates.ts` | 纯文档 |
| `ffb2daf` | 文件面板加「全宽 / 恢复宽度」切换 | 缺失 | i18n 无 `files.expandPanel` / `files.restorePanelWidth`；`components/AppShell.tsx:291` 只有 `rightPanelOpen` 开关，**grep 无命中**全宽模式 | 用户可见功能 |
| `47a0bb2` | 手动码握手 token 改用 `crypto.randomUUID` | 已有 | `app/api/auth/login/[provider]/route.ts` 与上游 patch-id 完全一致（`2300b57`） | batch A+B 已摘 |
| `1f79174` | 关停时关掉所有 SSE 流，避免 Next 16 drain 卡僵尸节点 | 已有 | `lib/agent-event-stream.ts:32-38`（`CLOSER_REGISTRY` + `closeAllAgentEventStreams`）、`instrumentation-node.ts:23` | batch A+B `aa7ff0d` + 我们的 `7e3f1b0`（Edge/Node 分家） |
| `50a2fd4` | 会话尾部预算只数「可见消息」 | 已有 | `lib/session-reader.ts:723`（`countsTowardTail`）、`:759` | batch A+B `4ea5888` 已摘 |
| `eac6f14` | e2e 的 compaction 夹具按可见消息尾部重新定尺 | 缺失 | `e2e/run.mjs:101` 仍是 `for (let i = 0; i < 24; i++)` + `"result23"`；上游改 48 / `result47` | 只影响 e2e 夹具 |
| `974c8bb` | 用有上限的转写内容给会话命名 | 已有 | `lib/session-title.ts:15,29,33,203`（`TITLE_MAX_TOKENS` / `TRANSCRIPT_CHARS` / `buildTitleTranscript`） | 我们自己的 `64c2f9f feat(sessions): bounded session title derivation` |
| `a84093e` | 关停钩子不要进 Edge instrumentation 入口 | 已有 | `instrumentation-node.ts`（独立 Node 入口）+ `instrumentation.ts` | 我们的 `7e3f1b0` |
| `58c1a21` | `.gitignore` 忽略 `.agents/` 与 `skills-lock.json` | 缺失 | `.gitignore` 无这两项（grep 无命中） | 我们已有 `lib/skillhub` 一套自己的 ignore |
| `ed50d88` | 会话列表里的「会话 / 文件」两段可上下拖拽改高 | 缺失 | `components/SessionSidebar.tsx` 无 `useResizablePanel`（该 hook 只在 `components/AppShell.tsx:325,337` 用于左右两栏）；i18n 无 `layout.resizeSidebarSections` / `layout.resizeHeightHint`；`hooks/useResizablePanel.test.mjs` 不存在 | 用户可见功能 |
| `404923e` | RISC-V 上关掉 Wasm 懒编译 | 已有 | `bin/pi-web-node-args.js` + `lib/pi-web-node-args.test.mjs`，与上游 patch-id 一致（`1d7b436`） | batch A+B 已摘 |
| `fce666a` | Windows 下归一化插件 `relativePath` 分隔符 | 已有 | `app/api/plugins/route.ts` patch-id 一致（`313c5c6`） | batch A+B 已摘 |
| `d11d344` | 工具卡折叠时也显示工具返回的图片 | 已有 | `components/MessageView.tsx:1349`（`{resultImages.length > 0 && <ResultImages .../>}` 在折叠区外）、`:1609`、`:1644`（`PairedResult` 已不再收 images）；`components/MarkdownBody.tsx:99-105`（Markdown 图也走 `ImagePreview`，`insideLink` 时跳过） | batch A+B `d95f7db` 已摘 |
| `f2d600b` | `/auto-compact` 斜杠命令开关自动压缩 | 已有 | `components/ChatInput.tsx:427`、`hooks/useAgentSession.ts:356,1319`、`hooks/useAgentSession.test.mjs:672` | batch A+B `cb4b592` + `f2bbf86` 已摘 |
| `79894b9` | 设置与 auth 路由纳入扩展注册的 provider | 已有 | `lib/model-runtime.ts` 与上游 patch-id 一致（`89940d1`） | batch A+B 已摘 |
| `c844973` | 回复被输出上限截断时明确告知用户 | 已有 | `lib/message-display.ts`（`isAssistantTruncated`）、`components/MessageView.tsx:913`、i18n `chat.truncatedByOutputLimit`（`en.ts:711`） | batch C-1 `e18cd88` 已摘 |
| `afd2575` | Windows 上跑 npm 更新检查不依赖 `npm.cmd` shim | 已有 | `lib/node-cli.ts` + `lib/node-cli.test.mjs` 与上游 patch-id 一致（`66c2bd3`） | batch A+B 已摘 |
| `002400d` | 流式首块不再重复一次 | 已有 | `lib/streaming-message.ts`，patch-id 一致（`c955034`） | batch A+B 已摘 |
| `8df5132` | 扩展 widget 更新时保持顺序 | 已有 | `lib/extension-widgets.ts` patch-id 一致（`0370aca`） | batch A+B 已摘 |
| `5e9b997` | 文件查看器认 PDF 链接里的 `#page=` 片段 | 已有 | `lib/file-links.ts`（`parsePdfPageFragment`）、`components/FileViewer.tsx:1287`、`components/TabBar.tsx:21`、`components/AppShell.tsx:1463` | 我们的 `dd2aa10`（`fork:pdf-page-fragment`），只差上游那份 `e2e/pdf-page-fragment.mjs` |
| `6e95fba` | 显示 OpenCode Go 的 provider 用量配额 | 已有 | `lib/provider-usage-ids.ts` + `components/ProviderUsageSummary.tsx`，patch-id 一致（`a7f1d11`） | 我们的 `a7f1d11` |
| `b4a4539` | PWA 的导航/静态资源 fetch 加超时，避免上游挂死 | 已有 | `public/sw.js:16-17`（`NAVIGATION_TIMEOUT_MS`/`ASSET_TIMEOUT_MS`）、`:189`（`fetchWithTimeout`） | batch A+B `44b1c13` 已摘 |
| `9d282da` | provider 流错误在子代理侧报为失败而非完成 | 已有 | `lib/subagent-runtime.ts:91`（`lastAssistantError`）、`:373-379`、`:516-522`（`status: "failed"`） | 我们的 `95f724c`（#886） |
| `20a2579` | 子代理前台完成文案带上 session ID | 已有 | `lib/subagent-extension.ts`，patch-id 一致（`09bcf08`） | batch A+B 已摘 |
| `31f0505` | 抬高 Next 代理的请求体缓冲，大上传才不 413 | 已有 | `next.config.mjs:25`（`proxyClientMaxBodySize: resolveMaxBodySize()`）、`lib/next-config.test.mjs:18` | batch A+B `4873b02` 已摘 |
| `be38e5d` | 变更文件行加「提及」按钮 + 路径中间省略 | 已有 | `components/FileExplorer.tsx:815-950`（`ChangeRow`，含 `MentionIcon` + `t("files.insertPath")` + `dirPart`/`baseName` 两段省略） | batch A+B `78d4166`/`314a6a9` 已摘 |
| `f3a4ff6` | 选区浮动工具条压在会话侧栏之上 | 已有 | `components/ChatWindow.tsx:2565`（`zIndex: 260`）+ 门禁 `components/ChatWindow.quoted-branch.test.mjs:25-32` | batch C-1 `166e02f` 已摘 |
| `38cba2b` | 插件面板显示包描述 | 已有 | `app/api/plugins/route.ts:150`（`readPackageMetadata`）、`:286`、`components/PluginsConfig.tsx` | 我们的 `95f724c` + `8d761ca`（测试） |
| `1eb5e66` | 「滚动到最新」悬浮按钮 | 已有 | `components/ChatWindow.tsx`（`chat-scroll-to-bottom`）+ `app/globals.css:1335-1387` + `components/ChatWindow.scroll-to-latest.test.mjs` | batch C-1 `64e6cd7` 已摘 |
| `ef1de89` | 每个浏览器 tab 记住自己打开的会话 | 已有 | `lib/tab-session.ts`、`components/AppShell.tsx:87-88,896-903,1131,1435`、`components/AppShell.tab-session.test.mjs` | 我们的 `20e4f41 feat(shell): per-tab session memory` |
| `0611857` | 子代理通知后仍保留更早的回复可见 | 已有 | `lib/message-display.ts`（`isMessageGroupAnchor` 认 `pi-web:subagent-notification`）+ `components/ChatWindow.tsx:1446,2136,2169` | 我们的 `95f724c`（#891） |
| `50f6cce` | Settings → Models 里的 `enabledModels` 开关 | 已有 | `components/ModelsConfig.tsx:1928,2056`（`<EnabledModelsSection>`）+ `app/api/models/enabled/route.ts` + `lib/enabled-models*.ts` | 我们的 `2791591` |
| `da1b28b` | pi SDK 升到 0.87.0（含转写回放迁移） | 已有 | `package.json:71-74`（4 个 `@earendil-works/*` 全 `0.87.0`，`node_modules` 实装也是 0.87.0）；`lib/exact-system-prompt.ts` 已在 | 我们的 `9eada23 chore(deps): bump pi 0.85.1→0.87.0` + `7e3f1b0` |
| `8b084d3` | provider 用量不是今天更新时显示相对时间 | 已有 | `lib/i18n/format.ts:70`（`formatUpdatedTime`）+ `components/ProviderUsageSummary.tsx:117` | 我们的 `dd2aa10` |
| `5933184` | 滚动条可抓握、聊天区显出一条 | 已有 | `app/globals.css:567-621`（`fork:upstream-0.9.2-scrollbar`，10px 盒 + 透明边框画 6px 拇指） | 我们的 `95f724c`（#932） |
| `0b307d5` | Strict Mode 副作用重跑时重开会话事件流 | 已有 | `hooks/useAgentSession.ts`（`sessionHookMountedRef` + `maintainEventsConnected`）+ 门禁 `hooks/useAgentSession.test.mjs:380-409` | 我们的 `95f724c`（#933） |
| `f07d4a2` | 逐个关掉内置子代理 | 已有 | `components/AgentsConfig.tsx:189,554,664`（`builtInEnabled` / `t("agents.disable")`）+ `lib/subagent-settings.ts` + `app/api/subagents/settings/route.ts:15` + `docs/adr/0005-built-in-subagent-disable.md` | 我们的 `2f77fea` |
| `54aa49c` | 子代理后台结果标成「非用户消息」 | 已有 | `lib/subagent-extension.ts:133-137`（`SUBAGENT_NOTIFICATION_PREFIX`）+ `lib/subagent-runtime.ts` | 我们的 `95f724c`（#935） |
| `03a9f5d` | 新会话不再覆盖 settings.json 的 `defaultTools` | 已有 | `hooks/useAgentSession.ts:345,709,830`（`CONFIGURED_TOOL_PRESET`）+ i18n `chat.configuredTools`（`en.ts:862`） | 我们的 `dd2aa10`（#700） |
| `12d3599` | 已回收结果的子代理不再重复弹完成通知 | 已有 | `lib/subagent-runtime.ts:120-131` + `lib/subagent-extension.ts:278`（`markResultConsumed`） | 我们的 `95f724c`（#937） |
| `058341d` | Models 面板加「手动刷新目录」按钮 | 已有 | `components/EnabledModelsSection.tsx:307,400-403` + `app/api/models/refresh/route.ts` + `lib/model-catalog-refresh.ts` | 我们的 `2791591` |
| `1bd40e4` | 小地图悬停预览显示每回合工具调用数 | 已有 | `components/ChatMinimap.tsx:409,759-766`（`tooltipTurn.toolCount` + `chatMinimap.toolCalls`） | 我们的 `b2939ca style(minimap)` + `95f724c`（#939） |
| `234e19e` | 会话侧性能大改（视图缓存 / 摘要扫描 / 项目树摘要 / 会话修订号） | 已有 | `lib/session-view-cache.ts`、`lib/session-revision.ts`、`lib/perf.ts`、`lib/session-reader.ts:254`（`listSessionSummaries`）、`app/api/sessions/route.ts:32`、`hooks/useAgentSession.ts:664,2469` | 我们的 `0d124c5 feat(sessions): view cache + summary list scanner + project tree` |
| `040fadd` | Release v0.9.2（版本号 + lockfile） | 缺失 | `package.json` 版本是 fork 自己的 `0.1.6` | **不适用**：fork 有自己的发版线与 `scripts/publish-release.mjs`。别照抄 |
| `79c2a44` | 精简生产安装 + 升 next/semver/undici 小版本 | 缺失 | `package.json:79,88,91` 仍是 `next 16.3.5` / `semver 7.8.0` / `undici 8.10.0`（上游 16.3.6 / 7.8.5 / 8.11.0）；`files` 白名单已精简 | 只有补丁版本号差，无行为差异 |
| `ea8a278` | 细滚动条：静止时透明，悬停/滚动才显形 | 缺失 | `hooks/useScrollbarVisibility.ts` 不存在；`app/globals.css` 无 `.scrollbar-subtle` / `.scrollbar-visible`（grep 无命中） | 我们的滚动条是常显的 10px 版（`app/globals.css:567`）。这是**观感**差异：上游默认透明、我们默认可见 |
| `f101948` | 会话列表滚动降负（虚拟列表） | 已有 | `components/SessionSidebar.tsx:36-60`（`SESSION_LIST_ITEM_HEIGHT` / `getSessionListIndices`）+ `components/SessionSidebar.test.mjs:7-18` | 我们的列表本来就是虚拟化的 |
| `beb32a9` | Basic Auth 与登录表单共用失败限流 | 缺失 | `proxy.ts` 无 `Authorization` / `recordAuthFailure`（grep 无命中） | **不适用**：登录已删 |
| `3e1f436` | 拒绝解析到别的源的登录跳转 | 缺失 | `lib/login-destination.ts` 不存在；`app/login/` 不存在 | **不适用**：登录已删 |
| `6ad18cd` | `PI_WEB_PASSWORD` 不进 agent bash / 终端 shell | 缺失 | `lib/project-command-env.ts` / `lib/terminal-manager.ts` 无该变量（grep 无命中） | **不适用**：这个 secret 在我们产品里根本不存在，shell 干净是自动成立的 |
| `499aa4f` | 像 pi 那样读 models.json（BOM/注释/尾逗号），且绝不覆盖读不出来的文件 | 缺失 | `lib/models-config-store.ts:64-72` 仍是裸 `JSON.parse` + `catch` 返回空配置；`app/api/models-config/route.ts:8` 无 422/409 分支；`components/ModelsConfig.tsx` 无 `loadError`（grep 无命中） | **数据丢失风险**：带注释的 models.json 读成空 → 下一次保存把整份 draft 覆盖回去、所有 provider 消失 |
| `a3f24ea` | 一个监听器在 emit 中退订时，其余监听器仍要收到事件 | 缺失 | `lib/rpc-manager.ts:251`（`private listeners: EventListener[] = []`），`:489` 仍按数组遍历、`:673-674` 用 `indexOf`/`splice` 退订（上游改成 `Set`） | SSE 流在 `session_shutdown` 里关掉自己时，同一事件后面的流会漏收 |
| `b908729` | pi SDK 升到 0.87.1 | 缺失 | `package.json:71-74` 仍是 `0.87.0` | 补丁版本 |
| `0876cf4` | Release v0.9.3（版本号 + lockfile） | 缺失 | 同 `040fadd` | **不适用** |
| `4857da3` | GitHub Pages 静态 demo（`demo/` 整棵树 + CI） | 缺失 | `demo/` 不存在；`.github/workflows/` 只有 `ci.yml` | 若 fork 不打算发布 Pages demo，则**不适用** |
| `96966e5` | demo 的 CI typecheck / Pages 下载 / README 自动 tab | 缺失 | `demo/` 不存在 | 同上，**不适用** |
| `fd037e4` | 输入框回车自动续 Markdown 列表 | 已有 | `lib/markdown-list.ts` + `components/ChatInput.tsx:99,2634-2640`（`continueMarkdownList`）+ `lib/markdown-list.test.mjs:7-14` | 我们的实现在 `lib/markdown-list.ts`（模块名不同） |
| `6a1246e` | 新会话里选的模型不再被写进全局默认值 | 缺失 | 无 `app/api/models/default/route.ts`、无 `lib/default-preferences.ts`、i18n 无 `chat.saveDefaultModel` / `chat.saveDefaultThinking`（grep 无命中）；`components/ModelSelector.tsx` 仍走 `onModelChange` 直接改会话 | 需要确认：我们的 `AGENTS.md:186` 还写着 `lib/startup-preferences.ts` 会持久化选择，而上游这个 commit 正是删掉它（该文件在我们树里也已不存在）——**很可能是残留 bug** |
| `433d09e` | 「使用默认目录」改建 `~/pi-cwd/<YYYYMMDD>`（本地日期），走正常选目录流程 | 缺失 | `app/api/default-cwd/route.ts:10-15` 仍是 `new Date().toISOString().slice(0,10)` + `~/pi-cwd-YYYYMMDD` + `allowFileRoot(dir)`；`lib/file-access.ts:36-39` 仍在扫 home 里的 `pi-cwd-\d{8}`（上游全删） | 两个可见问题：① UTC+8 在早上 8 点前文件夹名是「昨天」；② 家目录被 `pi-cwd-*` 铺满；③ 文件白名单靠扫 home |
| `a0c00f3` | 侧栏「在系统文件管理器里打开工作区」 | 已有 | `app/api/open-in-explorer/route.ts` + `lib/open-in-file-manager.ts` + `components/SessionSidebar.tsx` + `components/DismissButton.tsx` | 我们的 `71f748a feat(explorer): 移植上游 PR #907`（含我们自己的 loopback 限制） |
| `69882b9` | 锚点落在首页之外的那个回合也要成组渲染 | 已有 | `components/ChatWindow.tsx:2236`（`const virtualAnchor = idx === 0 && !isMessageGroupAnchor(msg)`）+ `:2241-2246` | 我们的 `fork:process-window-group`，是同一件事的另一写法 |
| `162a749` | `ext:` 子代理工具选择器要对着真实扩展源解析 | 缺失 | `lib/subagents.ts:290-292` 只有字面量 `parseExtensionToolSelectors(...).toLowerCase()` 一道闸；无 `extensionCandidateNames` / `addressableNames` / `normalizeExtensionSelector` / `disallowedExtensionTools` 下发（grep 无命中） | 后果：`ext:codegraph` 与 `ext:@scope/pi-codegraph` 认不出同一个扩展，别名/作用域写法能绕过禁用名单 |
| `46b5235` | 超长扩展对话框标题要能收缩，不能把选项和取消按钮挤出可视框 | 不确定 | 我们的头部走 `design/pi-web-design/assets/board.css:635` 的 `.pw-modal-head`（`display:flex; align-items:center`，**没有** `max-height` / `overflow`）；`components/ChatWindow.tsx:3040` 内联只有 `alignItems:flex-start`；正文区 `:3066-3069` 有 `flex:"1 1 auto", minHeight:0, overflowY:"auto"` | 需要人工在浏览器里造一个 40 行 ASCII 标题的扩展对话框量高度：若头部被内容撑到超过对话框、选项/取消被 `overflow:hidden` 裁掉，就是缺陷 |
| `342fc9a` | 截断且没有回答时，提示改为「去压缩」并给压缩按钮 | 缺失 | 无 `hasAssistantAnswer`、i18n 无 `chat.truncatedWithoutAnswer`（grep 无命中）；`components/MessageView.tsx:913` 统一显示 `chat.truncatedByOutputLimit` | 用户会看到「再追问一次」的误导建议，实际该做的是压缩上下文 |
| `bd85004` | 输入了 provider 名直接按 Save 也能存下（不必先按 Rename） | 缺失 | `components/ModelsConfig.tsx:386+` 的 `ProviderDetail` 里 `const [editingName, setEditingName] = useState(name)`（正是上游点名要搬走的写法）；无 `providerNameDraft` / `renameProviderEntry` / i18n `models.providerNameTaken`（grep 无命中）；`handleSave`（`:2382`）只带 `collectModelRenames`，不带上改名 | 改名被静默丢弃 |
| `4cc0770` | 带子模块的 worktree 强删前要弹确认 | 缺失 | `lib/worktree.ts` 无 `worktreeRemovalRequiresForce`；`app/api/worktrees/route.ts:97` 的正则仍只认 `is dirty` / `contains modified or untracked files`（grep 无命中） | 删子模块 worktree 时不会弹确认，直接失败 |
| `2e66e40` | 自动压缩期间状态栏说「压缩中」而不是「等待模型」 | 缺失 | `components/ChatWindow.tsx:127` 的 `phaseLabel(phase, t)` 没有 `isCompacting` 形参；`:2517` 调用点也没传（grep `chat-phase-label` 无命中） | 自动压缩时 UI 读起来像卡死 |
| `7303179` | 编辑历史消息时，到真正发送才开分支 | 缺失 | `components/MessageView.tsx:598-604` 仍是 `onNavigate!(entryId!).then(navigated => onEditContent(...))`（点「从这里编辑」立刻分叉）；`onEditContent` 签名没有 `entryId` 第二个参数 | 用户点一下取消草稿，分支已经建出来了 |
| `fe288c0` | #907/#946/#968 的复审补丁（先查白名单再 stat、npm source 解析、截断文案） | 缺失 | `app/api/open-in-explorer/route.ts:38` 仍先 `stat(target)` 再查白名单（先泄露路径存在性）；`lib/npm-source.ts` 不存在；`chat.truncatedWithoutAnswer` 无命中 | 三条都是它所修问题的后续，宿主 commit 也都缺失 |
| `0bae9b6` | 回合出现回答后自动折叠过程详情 | 已有 | `components/ChatWindow.tsx:2395`（`defaultExpanded={!finalAnswerMessage}`）+ `:528` + 门禁 `components/ChatWindow.process-details.test.mjs:8-11` | 已有 |
| `92ae057` | 移动端打开模型选择器不要自动弹键盘 | 缺失 | `components/ModelSelector.tsx:292` 仍是无条件 `autoFocus`（上游改 `autoFocus={!isMobile}`） | 手机上一点模型下拉，键盘先弹、列表被顶出屏幕 |
| `4a5081a` | GFM 自动链接在 CJK 标点处截断（`https://a.com，见这里` 不吞正文） | 缺失 | `lib/markdown.ts` 无 `splitAutolinkLiteralsAtCjkPunctuation` / `cjkPunctuationPattern`（grep 无命中） | 中文界面高频踩雷：URL 后面的中文被吞进 href，点进去是死链 |
| `6a97d0b` | 行内数学不吞货币金额（`$20 ... $6` 不配对） | 缺失 | `lib/markdown.ts:367,372` 仍是裸 `remarkMath`，无 `remarkCurrencySafeMath` | 聊价格时 `$20 和 $30` 会被当公式渲染坏 |
| `6f92983` | 会话第一条消息之前也要报出系统提示词 | 已有 | `lib/rpc-manager.ts:871-875`（`exactSystemPrompt ?? inner.systemPrompt ?? agent.state?.systemPrompt ?? ""` 三层回退）+ `lib/exact-system-prompt.ts` + `components/AppShell.tsx:2208,2811` | **注意**：我们的顺序与上游相反（上游改成 state 优先、getter 兜底）。这是我们 `300493c fix(chat): 系统提示词面板显示为空` 的有意决策，不是漏摘 |
| `c8ff7e8` | 「已回收」标记按 run 而非 session 计 | 缺失 | `lib/subagent-runtime.ts:83,120-131` 的 `__piSubagentConsumedResults: Set<string>` 仍以 `sessionId` 为键，`markResultConsumed(sessionId)`；无 `SubagentRunIdentity` / `completedRun`（grep 无命中） | 同一子会话跑第二轮时，第一轮的「已取走」会误吞第二轮的通知 |
| `00156d5` | 重启遗留的 running/queued 子代理 run 报为 interrupted | 缺失 | `lib/subagent-runtime.ts` 无 `settleOrphanedRun`；`get_subagent_result({wait:true})` 会一直轮询（grep 无命中） | 进程重启后，子代理面板永远转圈 |
| `2a71c57` | 后台报告来自恢复的 run 时要说明 | 缺失 | `lib/subagent-extension.ts:133-137` 的 `subagentFinalText` 无 resumed 判定（grep 无命中） | 恢复的 run 回来时文案与新 run 一模一样，用户会以为重复了 |
| `680db65` | 目录选择器里能新建目录 | 已有 | `app/api/cwd/directories/route.ts:44` + `lib/directory-browser.ts:91`（`createDirectory`），`components/DirectoryPicker.tsx` 有对应 UI | 我们还多做了删除/重命名，上游这条是子集 |
| `390e70f` | 移动端输入框不被键盘顶出屏幕 + 输入区更宽 | 缺失（部分） | `hooks/useViewportHeight.ts:16-21` 的 `shouldUseVisualViewportHeight` 要求 `Math.abs(viewportScale - 1) < 0.01`，**页面一旦缩放就完全不采信 visualViewport**；没有 `KEYBOARD_MIN_HEIGHT_PX` 阈值，也没有 `SETTLE_DELAYS_MS = [48,120,240,420,720]` 的稳定重读链 | 已有部分：`hooks/useViewportHeight.ts` 存在、`html.keyboard-open` 类已接（`app/fork-ui.css` 消费）、`components/MobilePwaLayout.test.mjs` 有门禁。缺的是 iOS 缩放场景与 WebKit 动画未落定时的重读 |
| `6b0c6a5` | 给每个客户端的 SSE 积压设上限 | 缺失 | `lib/agent-event-stream.ts`（179 行）无 `backlogLimitBytes` / `BACKPRESSURE` / `PI_WEB_SSE_BACKLOG_LIMIT_BYTES`（grep 无命中） | 慢客户端能把服务端内存吃光 |
| `5df8278` | 设置里可选发送键（Enter 或 Ctrl+Enter） | 缺失 | `hooks/useEnterSendMode.ts` 不存在；i18n 无 `settings.enterSendMode`（grep 无命中） | 用户可见功能 |
| `d8f89c5` | 模型发现端点从 pi 的 provider 目录解析 | 已有 | `lib/model-discovery-auth.ts:20`（`resolveModelDiscoveryAuth`）+ `app/api/models-config/discover/route.ts:56` + `lib/model-discovery.test.mjs:40` | 已有 |
| `9ede521` | 关掉空闲关停后，仍要回收 Stop 收不回的 run | 缺失 | `lib/rpc-manager.ts:511-517` 的 `resetIdleTimer()` 在 `SESSION_IDLE_TIMEOUT_MS === 0` 时直接 return；`:728`（`get_state`）、`:1246` 等每条命令都会把定时器往后推，无 `forcedIdleTimerArmed` | 设 `PI_WEB_IDLE_TIMEOUT_MS=0` 后，卡住的 run 会一直跑到服务重启 |
| `f5e768e` | Stop 能结束被幸存进程占住 stdout 的命令 | 缺失 | `lib/project-command-env.ts` 无 `ABORT_SETTLE_GRACE_MS` / `abortSettleGraceMs` / `released` 闸（grep 无命中） | 子进程自己开新 session 时，按 Stop 卡住，后续 steer 全部排队 |
| `faeff03` | 用户消息里手打的换行要保留 | 缺失 | `lib/markdown.ts` 无 `keepLineBreaks` / `PHRASING_BLOCK_TYPES` / `markdownUserRemarkPlugins`（grep 无命中）；`components/MarkdownBody.tsx` 无 `markdownUserRemarkPlugins` | 用户按 Shift+Enter 排的版会被折成一行 |
| `f52fd84` | Safari / iOS 16.2 能加载（换掉 gfm-autolink 的 lookbehind 正则 + browserslist） | 缺失 | `lib/gfm-autolink-email-loader.cjs` 不存在；`next.config.mjs` 无 `turbopack.rules` / `webpack(...)` / `transpilePackages: ["mermaid", ...]` / `browserslist`（grep 无命中）；`lib/markdown.ts` 仍有 `(?<![\\`])` 之类 lookbehind | iOS 16.2 上整页白屏 |
| `13bc2b0` | 文件树用 Git 决定隐藏什么（`git check-ignore --stdin`），不再按固定名单过滤 | 缺失 | `lib/file-tree-visibility.ts` 不存在；`app/api/file-index/route.ts:17` 只有一句注释「Git-tracked repos rely on .gitignore」；文件列表路由里无 `check-ignore`（全树只有 `scripts/clean-disk.mjs:85` 命中） | 被 git 跟踪的 `build/`、`dist/`、`vendor/` 永远打不开；反过来生成的目录一直显示 |
| `eceac13` | Skills / Plugins 的「全部启用 / 全部停用」批量操作 | 缺失 | `app/api/skills/route.ts:32` 的 PATCH 只收单个 `filePath`；`app/api/plugins/route.ts` 无 `packages: [...]` 批量入口；i18n 无对应 bulk key；`components/SkillsConfig.bulk.test.mjs` 不存在 | 逐个开关 |
| `687af27` | 允许操作员打开指向项目外的符号链接目录 | 缺失 | `lib/linked-directory.ts` 不存在；`app/api/files/[...path]/route.ts:229` 仍写死「符号链接祖先不可能逃出工作区」；`?type=allow-link` / `outsideLinkTarget` grep 无命中 | 用软链把别的目录收进项目的仓库，展开后是空白且吞掉错误 |
| `b9622a1` | Skills / Plugins 的分组开关改挂在侧栏行上（不再挂在标题） | 缺失 | i18n 无 `skills.groupSwitchOn/Off`、`plugins.groupSwitchOn/Off`；`components/SettingsUi.tsx` 无 `ConfigSidebarGroupSwitch` / `ConfigSidebarBulkActions` / `ConfigSidebarGroupStatus`（grep 无命中） | 跟 `eceac13` 配套 |
| `d0bf6be` | 流式过程中也能改思考级别（作用于下一轮） | 缺失 | `components/ChatInput.tsx:3785-3796` 流式时渲染的是**只读** `<span className="pw-select">`；`:3800` 的按钮仍 `disabled={isStreaming}`、`:3805` `onClick={() => !isStreaming && ...}`（上游删掉这三个守卫） | 用户可见功能 |
| `2bb48f5` | pi SDK 升到 0.99.1（引入 `exposure` 工具暴露模型 + `resolveDefaultToolEntries`） | 缺失 | `package.json:71-74` 仍是 `0.87.0`；`lib/pi-types.ts` 无 `exposure?: "direct" | "model-only" | "codemode" | "deferred" | "hidden"`；无 `resolveDefaultToolEntries` | 这是下面 73104ba / 18758b7 / 62542da 的前置。升级本身有风险，要单独立项 |
| `4de9f77` | 把 Skills / Plugins 的分组开关做大 | 缺失 | `components/SettingsUi.tsx` 无 group switch 组件（宿主 `b9622a1` 就没摘） | 随 `b9622a1` 一起做 |
| `19774b8` | 会话正在跑的时候也能分叉出新会话 | 缺失 | `lib/rpc-manager.ts:897,947` 仍是 `throw new Error("Cannot fork while the session is running")`；无 `UNSAVED_SESSION_FORK_ERROR` / `keepSource`（grep 无命中） | 用户可见功能 |
| `94c1f5c` | 选中历史编辑时保留已打的草稿（可取消编辑） | 缺失 | `components/MessageView.tsx` 无 `onCancelEdit` / `isEditing` / `canCancelEdit`（grep 无命中）；`components/ChatWindow.tsx:622` 的 `handleEditContent` 直接 `replaceMessage` 覆盖草稿 | 选了历史消息，草稿就没了 |
| `89bd25b` | ADR 0006：记录 MCP 与 Code mode 的支持方式 | 缺失 | `docs/adr/` 只有 `0001/0002/0003/0005` | 纯文档 |
| `62542da` | 子代理控制工具注册为「仅模型可见」 | 已有 | `lib/subagents.ts:113`（`SUBAGENT_CONTROL_TOOLS`）、`:536,557` | 已有 |
| `b3c7255` | 不再把「系统消息 / 非编码工具结果」里提到的路径当作授权 | 缺失 | `lib/session-file-references-core.ts:62-69` 的 `isFilePathReferencedByEntries` 对**每一条** entry 的所有字符串做匹配，无 `CODING_TOOL_NAMES` / `PATH_REPORTING_TOOL_NAMES` / `nestedCalls` 判定（grep 无命中） | **安全问题**：MCP / 第三方扩展的返回文本里塞一个路径，就能让那个路径被算作「会话引用过」，进而被授权访问 |
| `85f9cb1` | 加载 SDK 未导出的 MCP 模块 + 清洗 stdio 环境 | 缺失 | `lib/mcp-transport.ts`、`lib/pi-sdk-internals.ts`、`lib/__fixtures__/mcp-env-server.mjs` 都不存在（grep 无命中） | 我们的 MCP 走自己的通道，不吃 SDK 内部模块 |
| `73104ba` | `withExtensionTools` 不再强制打开所有未激活的扩展工具 | 缺失 | `lib/rpc-manager.ts:232-243` 仍是 `[...selectedToolNames, ...extensionToolNames]`（`extensionToolNames` = `getAllTools()` 全量减去编码工具），无 `resolveActiveToolNames` / `ACTIVE_ON_REGISTRATION_EXPOSURES`（grep 无命中） | **依赖 `2bb48f5`**（`exposure` 模型在 pi 0.87 里没有）。今天的效果：装上 codemode / tool_search 就会被强制打开，且换预设会丢用户/扩展刚激活的工具 |
| `aed0f3c` | 一旦开始关停就认为 wrapper 已死，并给 `session_shutdown` 设上限 | 缺失 | `lib/rpc-manager.ts` 无 `SESSION_SHUTDOWN_DEADLINE_MS` / `emitSessionShutdown` / `PI_WEB_SHUTDOWN_DEADLINE_MS`（grep 无命中）；`lib/rpc-manager-lifecycle.test.mjs` 不存在 | 关停卡住时不会超时返回 |
| `b8e0b71` | 精简嵌套工具事件 + 合并工具更新 | 缺失 | `lib/agent-event-stream.ts`（179 行）无 `TOOL_UPDATE_COALESCE_MS` / `flushToolUpdates` / `CODEMODE_SNAPSHOT_CALL_LIMIT`（grep 无命中）；`lib/agent-event-wire.ts`（119 行）无对应裁剪 | 长回合的 SSE 流量没被压 |
| `70470ca` | 扩展对话框 / 自定义面板按 request id 排队 | 缺失 | `hooks/useAgentSession.ts:1099` 仍是 `setExtensionDialog(request)` 直接覆盖，`:1132` 同理；`lib/extension-ui-queue.ts` 不存在；i18n 无 `chat.extensionMoreWaiting`（grep 无命中） | 同时来两个扩展请求时，第一个被静默顶掉，用户回不上话 |
| `197a3e5` | 设置面板共用块 + Plugins/Skills 全量本地化 | 缺失（部分） | 已有 `components/SettingsUi.tsx`（`ConfigFooter`/`ConfigButton`/`ConfigSwitch`/`ConfigDetail*`/`ConfigPanelShell` 等 25 个共用件）；**缺**：`ConfigFooterStatus` / `ConfigNotice` / `ConfigScopeTag` / `ConfigScopeSwitch` / `ConfigScopeOption` / `ConfigDetailGrid` / `ConfigAddSourcePanel` / `ConfigSidebarBulkActions` / `ConfigSidebarGroupStatus`（全部 grep 无命中）、`components/OAuthPastePanel.tsx`、`lib/display-path.ts`；i18n 缺 `plugins.status.loaded/installed/missing/disabled`、`skills.discoverHint`、`config.source/examples/name/scope` | 共用骨架已有大半，欠的是 scope 三件、grid、add-source、OAuth 粘贴面板，以及 Plugins/Skills 面板里的硬编码英文 |
| `18758b7` | 只带活跃工具，并跨导航保留会话自己的工具 | 缺失 | 无 `carriedToolNames` / `resolveActiveToolNames` / `SESSION_TOOL_NAMES`（grep 无命中） | **依赖 `73104ba` 与 `2bb48f5`**；今天 `navigate_tree` 后分支记录的工具集会被我们的预设覆盖 |
| `34c8fdf` | 重新打开会话前，先等正在关停的 wrapper | 缺失 | `lib/rpc-manager.ts` 无 `closingSessionWaits` / `CLOSING_SESSION_WAIT_MARGIN_MS` / `closingRpcSessionWait`（grep 无命中）；`lib/rpc-manager-lifecycle.test.mjs` 不存在 | 快速切走再切回会拿到一个正在关闭的 wrapper |
| `e17d2cc` | 丢弃服务端在断流期间已关闭的扩展 UI 请求 | 缺失 | 无 `removeExtensionUiRequest` / `pendingExtensionUiIds` / `retainExtensionUiRequests`（grep 无命中）；`hooks/useAgentSession.ts:1643` 只在收到 `extension_ui_closed` 事件时清 | 重连后弹出一个服务端早已作废的对话框 |

---

## 汇总

### 缺失清单（判定为 `缺失` 的，按档分组）

#### A. 用户可见功能（10 条）

| 上游 commit | 一句话：用户能得到什么 |
| --- | --- |
| `ffb2daf` | 文件面板可以一键切成全宽、再点恢复原宽度 |
| `ed50d88` | 会话侧栏里「会话列表 / 文件浏览」两段之间有横向分隔条，能拖高拖低 |
| `5df8278` | 设置里可选发送键：Enter 直发，或 Ctrl+Enter 才发 |
| `d0bf6be` | 模型在跑的时候也能改思考级别，改完作用于下一轮 |
| `19774b8` | 会话正在跑的时候也能「新会话（分叉）」，源会话的运行不被掐断 |
| `94c1f5c` | 选中某条历史消息编辑时，已经打了一半的草稿不会被冲掉，还能取消 |
| `433d09e` | 「使用默认目录」不再把家目录铺满 `pi-cwd-*`，且在 UTC+8 早上 8 点前也拿到「今天」的文件夹 |
| `4a5081a` | 中文里紧跟 URL 的中文标点不再被吞进链接，正文还是正文 |
| `6a97d0b` | 聊价格时 `$20 和 $30` 不会被当成公式渲染坏 |
| `92ae057` | 手机上点开模型选择器不会先弹键盘把列表顶掉 |
| `eceac13` + `b9622a1` + `4de9f77` | Skills / Plugins 面板有「全部启用 / 全部停用」，开关挂在侧栏行上而不是标题上 |
| `ea8a278` | 细滚动条默认透明，鼠标移进去 / 开始滚动才显形（我们现在是常显一条灰条） |
| `342fc9a` | 截断且没有回答时，提示改成「去压缩上下文」并直接给压缩按钮，而不是让用户「再追问一次」 |
| `2e66e40` | 自动压缩期间状态栏说「压缩中」，不再显示「等待模型」让人以为卡死 |
| `7303179` | 编辑历史消息时点「取消」不会已经把新分支建出来 |
| `d8f89c5` → 已有（不列） | — |
| `687af27` | 项目里用软链收进来的目录能展开，并显示它指向哪里、可一键授权浏览 |

#### B. 修复 / 安全（11 条）

| 上游 commit | 一句话：用户能得到什么 |
| --- | --- |
| `499aa4f` | 带注释的 models.json 不会再读成空、然后被一次保存抹掉所有 provider；读不出来时直接禁用保存并报原因 |
| `b3c7255` | **安全**：MCP / 第三方扩展返回文本里提到的路径不再自动获得文件访问授权 |
| `a3f24ea` | 一个 SSE 流在关停时退订自己，不会让同批的其它流漏掉这条事件 |
| `9ede521` | 关掉空闲关停后，Stop 收不回来的 run 也会在默认延时后被回收，不会跑到服务重启 |
| `f5e768e` | 子进程自己开新 session 时按 Stop 也能停，steer 不再排队 |
| `c844973` → 已有（不列） | — |
| `faeff03` | 用户消息里 Shift+Enter 排的版不会被折成一行 |
| `f52fd84` | iOS 16.2 / Safari 16.2 上能正常打开（现在会白屏） |
| `13bc2b0` | 被 git 跟踪的 `build/`、`dist/`、`vendor/` 在文件树里打得开；生成的目录不再一直显示 |
| `be38e5d` → 已有（不列） | — |
| `4cc0770` | 删带子模块的 worktree 之前会弹确认，不会直接失败 |
| `c8ff7e8` | 同一个子会话跑第二轮时，第一轮的「结果已取走」不会吞掉第二轮的通知 |
| `00156d5` | 进程重启后残留的 running 子代理报为「已中断」，`get_subagent_result` 不再永远轮询 |
| `2a71c57` | 恢复的 run 回来时文案会说明是恢复的，不会让人以为重复了 |
| `2e66e40` → 已列 A | — |
| `fe288c0` | **安全**：打开文件夹前先查白名单，不再用 400/500/403 的差别探测路径是否存在 |
| `73104ba` + `18758b7` | 装上 codemode / tool_search 不再被强制打开；换工具预设和切分支不再丢用户刚激活的工具（**依赖 `2bb48f5` 的 SDK 升级**） |
| `70470ca` | 同时来两个扩展对话框时两个都在排队，不会静默丢掉第一个 |
| `34c8fdf` / `aed0f3c` | 快速切走再切回会话不会拿到一个正在关闭的 wrapper；关停卡住会超时返回 |
| `e17d2cc` | 重连后不会弹出一个服务端早已作废的扩展对话框 |
| `be38e5d` → 已有 | — |
| `4a5081a` / `6a97d0b` → 已列 A | — |
| `162a749` | 子代理的 `ext:` 禁用名单认得出扩展别名与 npm 作用域写法，不能被绕过 |
| `bd85004` | 在 provider 名输入框里打了字直接按 Save 也会存下，不会静默丢弃 |
| `b8e0b71` | 长回合的 SSE 流量被压下来，慢客户端不再把服务端内存吃光（`6b0c6a5` 同） |
| `6a1246e` | **待确认**：新会话里选的模型不再被写进全局默认（我们树里 `AGENTS.md:186` 还在描述已被上游删掉的 `startup-preferences.ts` 持久化路径） |

#### C. 重构 / 内部（13 条）

| 上游 commit | 一句话 |
| --- | --- |
| `2bb48f5` | pi SDK 0.87.0 → 0.99.1，带进 `exposure` 工具暴露模型与 `resolveDefaultToolEntries`（`73104ba`/`18758b7` 的前置；单独立项，别顺手做） |
| `197a3e5` | 设置面板共用块补齐（scope 三件 / detail grid / add-source / OAuth 粘贴面板），Plugins 与 Skills 面板里硬编码的英文全部 i18n 化 |
| `eac6f14` | e2e 的 compaction 夹具按「可见消息尾部」重新定尺（24 → 48） |
| `79c2a44` | next 16.3.5→16.3.6 / semver 7.8.0→7.8.5 / undici 8.10.0→8.11.0 |
| `b908729` | pi SDK 0.87.0 → 0.87.1 |
| `58c1a21` | `.gitignore` 补 `.agents/` 与 `skills-lock.json` |
| `5b96a9d` / `6edbecb` / `ed7a4d7` | `AGENTS.md` 补 `PI_WEB_IDLE_TIMEOUT_MS`、`app/api` 路由图、`lib/plugin-updates.ts` |
| `89bd25b` | ADR 0006：MCP 与 Code mode 的支持方式 |
| `4857da3` / `96966e5` | GitHub Pages 静态 demo（`demo/` 整棵树 + CI）。**若 fork 不发布 Pages demo，这三条属「不适用」** |

#### D. 刻意移除、不要补（6 条）

`c1e544b`、`20ad98b`、`beb32a9`、`3e1f436`、`6ad18cd`、`040fadd`/`0876cf4`（版本号）。
前五条是 `PI_WEB_PASSWORD` 登录体系（`proxy.ts:19-27` 用户裁定删除），后两条是 fork 自己的 0.1.x 发版线。

### 不确定清单（判定为 `不确定` 的）

| 上游 commit | 需要人工看哪个文件的哪个函数才能定 |
| --- | --- |
| `46b5235` | 开浏览器 → 造一个扩展 `select` 请求，标题塞 40 行 ASCII（或一段多行 SQL）→ 在 DevTools 量 `.pw-modal-head`（定义在 `design/pi-web-design/assets/board.css:635`）的实际高度与 `components/ChatWindow.tsx:3020-3070` 里 `ExtensionDialog` 的对布局：若头部高度撑破对话框、选项与取消键被 `overflow:hidden`（`:3035`）裁掉，就是缺陷 —— 需要的是**视觉实测**，读代码判不了 |
| `6a1246e` | 读 `hooks/useAgentSession.ts` 里新会话创建后有没有把 model/thinking 写进 `~/.pi/agent/settings.json` 的路径，以及 `lib/models-cache.ts` / `app/api/models/route.ts` 的 `defaultModel` 写入方。目前证据是：i18n 无 `chat.saveDefaultModel`、无 `app/api/models/default/route.ts`、无 `lib/default-preferences.ts`，但 `AGENTS.md:186` 仍描述持久化行为 —— 需要跑一次「新建会话 → 选模型 → 重开」看 settings.json 有没有变 |

---

## 判定方法备注

- **patch-id 精确命中**（10 条，可信度最高）：`79894b9`、`fce666a`、`20a2579`、`afd2575`、`47a0bb2`、`6e95fba`、`404923e`、`002400d`、`8df5132`（+ `c1e544b`，但该特性已被整段删除，见 `c1e544b` 行）
- **fork 自己的对位提交**：batch A+B（27 picks，`35d73c1`）、batch C-1（6 picks，`3a5f332`）、`95f724c`、`7e3f1b0`、`dd2aa10`、`2791591`、`0d124c5`、`2f77fea`、`20e4f41`、`34dc76f`、`64c2f9f`、`a7f1d11`、`71f748a` —— 这批的 patch-id 多半已被我们重写，所以逐条回到行为标志物去核对
- **上游 `demo/` 整棵树**（`4857da3`、`96966e5`）在我们仓库里是 `pi参考项目/` 的 vendored 副本，grep 已排除，不能算「已有」
