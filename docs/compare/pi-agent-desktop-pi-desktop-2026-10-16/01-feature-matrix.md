# 功能对照矩阵（Pinext × pi-agent-desktop × PI-Desktop）

阅读顺序：先 `FACTS.md`（三条硬约束）。本文只列**功能**，实现细节见各项目自带文档。

图例：`✅` 有且完整 · `◐` 部分/另一形态 · `❌` 无 · `—` 不适用

> 2026-10-16 二次修订：参考 A 侧已对照到 **0.12.1**（原基线 0.10.0），补入 §1 实时 t/s、§4 MCP 项目级覆盖、§6 模型收藏、§7 `!command` 四行的复核结论，汇总表增加 `PX-22…PX-25`。

---

## 1. 会话、转录与分支

| 能力 | Pinext | pi-agent-desktop | PI-Desktop | 结论 |
|---|---|---|---|---|
| 会话列表/恢复/归档/置顶 | ✅ `src/main/engine/conversation-catalog.ts`、`lib/pinned.ts` | ✅ `/api/sessions`、`SessionSidebar.tsx` | ✅ 自建表 + Projects 页 | 三家都有，形态不同 |
| 转录分支（回到某条消息重开） | ✅ `engine:branch`（`shared/ipc.ts:62`）+ 重试回退 | ✅ `BranchNavigator.tsx` | ✅ 分支命令 | 三家都有 |
| 独立分叉（新 session 文件，复制所选分支） | ✅ `engine/session-fork.ts`（保留 usage 身份 `pinextUsageSessionId`） | ✅ `writeForkedSession()` | ✅ | Pinext 的分叉比参考 A 多「用量不重复计」 |
| 编辑某条用户消息并重发 | ✅ `message-row.tsx:670` | ✅ `ChatWindow.quoted-branch` | ✅ | 都有 |
| **消息引用 / 批注 / 浮动批注索引** | ❌ | ❌（曾有，上游未采用） | ❌ **ADR 0268 明确删除** | **不做**：PI-Desktop 自己都删了 |
| 辅助对话（side chat） | ✅ `stores/side-pane.ts:863` `selection-side-chat` | ❌ | ❌ ADR 0268 删除 | Pinext 领先，不借鉴 |
| 会话全文搜索 | ✅ `engine/conversation-transcript-search.ts` + 命令面板 | ✅ `lib/session-search.ts` | ✅ `session-content-search` ADR | 都有 |
| 会话导出 HTML / Markdown | ✅ `engine/export-html-patch.ts`、`export-markdown.ts` | ✅ `/api/sessions/[id]/export` | ✅ | 都有 |
| 上下文环 / 压缩 / 自动压缩 | ✅ | ✅ `ContextUsageRing.tsx` | ✅ | 都有 |
| **流式实时速度（流中 t/s 显示）** | ◐ 只有回合结束后的统计（`chat/composer.tsx` 统计弹层 `formatSpeed`），流中没有 | ✅ `lib/stream-token-rate.ts` + `MessageView.tsx:845`（估算 tokens 旁 `N.N t/s` 徽标，仅 `isStreaming`） | ◐ | **参考 A 0.12 有（小），PX-24** |
| **运行中状态的一致性（`agent_settled` 而非 `agent_end`）** | ✅ AGENTS.md「会话是否在运行」整节 | ✅ AGENTS.md `isRunning()` 一节（同一个坑） | ✅ session 状态机 spec | 三家独立踩过同一个坑，Pinext 的处理最完整 |

**建议动作**：`PX-24` 流式实时 t/s（0.12 复核补记，小）。

---

## 2. 子代理与任务编排

| 能力 | Pinext | pi-agent-desktop | PI-Desktop | 结论 |
|---|---|---|---|---|
| 委派工具（角色 + 并行 + 链式） | ✅ `resources/extensions/subagent/index.ts` | ✅ `Agent` / `get_subagent_result` / `steer_subagent` | ✅ `contributes.agentTools` | 都有 |
| 运行中注入指令（steer） | ✅ `steer_subagent` | ✅ | ✅ | 都有 |
| 后台运行 + 结果回收 | ✅ `get_subagent_result` | ✅ `run_in_background` | ◐ | 都有 |
| 子会话右面板（只读转录 + 停止） | ✅ `side-pane-subagent.tsx` | ✅ 子代理面板标签 | ✅ work panel | 都有 |
| 内置角色按名开关（不删文件） | ✅ 提交 `778c2bb5` | ✅ ADR 0005 `disabledBuiltIns` | ◐ | 都有，语义一致 |
| 子代理连 MCP / 只读 MCP 策略 | ❌ 未找到 | ✅ `lib/mcp-read-only-policy.ts` + profile `mcp:` | ✅ | **参考 A 有** |
| 角色可声明 `thinkingLevel` | ✅ AGENTS.md 有 | ✅ profile `thinking:` | ✅ | 都有 |
| **依赖图编排（DAG：依赖/写路径/验收/协调者）** | ✅ `docs/` DAG 整节 + `resources/extensions/dag.ts` | ❌ | ❌ | **Pinext 独有** |
| 任务级预算（时限/重试/并发槽） | ✅ DAG 预算 + 重试 | ◐ `max_turns` | ◐ | Pinext 领先 |

**建议动作**：`PX-06` 只读 MCP 策略（子代理 + 只读会话）。

---

## 3. 定时任务

| 能力 | Pinext | pi-agent-desktop | PI-Desktop | 结论 |
|---|---|---|---|---|
| 创建/编辑/暂停/删除/立即运行/历史 | ✅ `components/schedules/tasks-page.tsx`、`engine/scheduled-tasks.ts` | ✅ | ✅ `docs/guide/automations.md` | 都有 |
| 规则类型 | **once / daily / weekly**（`src/shared/schedules.ts:2`） | once / **cron 表达式** / daily / weekly（`lib/scheduled-tasks/cron.ts`） | hourly / daily / weekly / manual | **缺 cron** |
| 时区 | ✅ IANA（`scheduled-tasks.ts:98`） | ✅ | ✅ 本机时区 | 都有 |
| 错过（睡醒/重启）处理 | ◐ 塌缩成 `missed`（`scheduled-task-manager.ts:124`），**不补跑** | ✅ **catch-up 补跑一次**（`catch-up.ts:46`） | ✅ 「错过的跳过，启动不补」——与 Pinext 同 | **参考 A 领先** |
| 单调度器租约（多进程不重复触发） | ❌ | ✅ `lib/scheduled-tasks/lease.ts` | ◐ host 单进程 | **参考 A 有** |
| 连续失败自动停用 | ❌ | ✅ `consecutiveFailures` 达 5 自动 `enabled=false` | ❌ | **参考 A 有** |
| 单次最长时长 | ❌ | ✅ `maxDurationMin`（默认 30，超时 abort） | ❌ | **参考 A 有** |
| 每任务工具预设（默认只读） | ❌ 用会话默认 | ✅ `toolPreset` 默认 `read-only` | ✅ permission mode（Ask/Auto） | **参考 A 有** |
| 每任务模型/思考层级 | ❌ | ✅ `model` / `thinkingLevel` | ✅ | **参考 A 有** |
| Agent 侧管理工具 | ✅ `schedule_create/list/update/run_now/stop/history/remove` | ✅ 同 | ✅ ScheduledTask* | 都有 |
| 结果回投到发起会话 | ✅ `reportBack` | ◐ 通知 | ✅ 打开会话 | 都有 |
| 托盘保活 | ✅ `src/main/schedule-tray.ts`（仅任务启用时） | ✅ 隐藏到托盘 | ✅ 常驻 | 都有 |

**建议动作**：
- `PX-02` 定时任务硬化（cron + 补跑 + 租约 + 失败停用 + 时长上限）——**最高性价比**
- `PX-03` 每任务工具预设 / 模型 / 思考层级（依赖 `PX-07` 的工具预设）

---

## 4. MCP

| 能力 | Pinext | pi-agent-desktop | PI-Desktop | 结论 |
|---|---|---|---|---|
| stdio + streamable-http | ✅ `src/main/pi/mcp-manager.ts` | ✅ | ✅ | 都有 |
| 工具名空间 | `mcp_<id>_<tool>` | `mcp__<server>__<tool>`（pi 1.0） | — | 形态不同 |
| exposure（direct/deferred/codemode） | ✅ `tool-modes.ts` | ✅ ADR 0006 | ◐ | 都有 |
| 连接测试 | ✅ `engine:test-mcp` | ✅ `MCP_TEST_*`（含 20s 期限、close 等待上限） | ✅ | 都有 |
| 从别的 agent 配置文件发现 | ✅ 6 个来源（claude/codex/cursor/windsurf/vscode/opencode，`pinext/mcp/discovery.ts:38-54`） | ✅ `mcp-import.ts` | ✅（并入设置页） | **Pinext 覆盖更宽** |
| 粘贴导入 + 校验预览 + 密钥引用 | ◐ `parseMcpJson`（JSON 形状）+ `serverFromEntry` | ✅ 完整（含 `claude mcp add` / `codex mcp add` / VS Code `--add-mcp` **CLI 命令解析**，`lib/mcp-import-cli.ts` 731 行；`secretReferences`；host-env 确认） | ✅ | **参考 A 明显更强** |
| **MCP OAuth 登录** | ❌ AGENTS.md 明说「Not done: OAuth sign-in」 | ✅ `lib/mcp-sign-in.ts` + `McpOAuthCredentialStore` | ✅ | **最大缺口** |
| MCP 市场（浏览/安装 registry） | ❌ | ❌ | ✅ `docs/guide/mcp-market.md`（官方 registry 协议 + catalog JSON + 内置目录） | **参考 B 独有** |
| 只读 MCP 工具策略 | ◐ 记录 `readOnlyHint`（`mcp-manager.ts:224`），**无策略层** | ✅ `mcp-read-only-policy.ts` | ✅ | **参考 A 有** |
| **MCP 项目级覆盖**（项目 `.pi/mcp.json` 只改全局同名服务器的 `enabled`/`exposure`/`toolExposure`） | ❌（`pinext/mcp/discovery.ts` 只把项目文件当**导入来源**，运行时不读） | ✅ `lib/mcp-override.ts`（pi 1.0.1 `loadMcpConfig()` 语义：无 `command`/`url`/`type` 的条目即覆盖） | ◐ | **参考 A 0.12 有，PX-25（低优先）** |

**建议动作**：`PX-04` MCP OAuth 登录 · `PX-05` MCP 粘贴导入（CLI 解析 + 校验 + 引用）· `PX-06` 只读策略 · `PX-10` MCP 市场 · `PX-25` 项目级覆盖（低优先）。

---

## 5. 技能与插件

| 能力 | Pinext | pi-agent-desktop | PI-Desktop | 结论 |
|---|---|---|---|---|
| 技能列表/新建/编辑/导入文件夹/删除 | ✅ `src/main/pi/skill-manager.ts` | ✅ `DefaultResourceLoader` | ✅ | 都有 |
| 技能市场搜索安装 | ❌（有内置 `find-skills` 技能，靠 npx 手装） | ✅ `/api/skills/install`（`npx skills add`）+ skills.sh 搜索 | ✅ | **参考 A 有** || `disable-model-invocation` 逐技能开关 | ❌ | ✅ surgical 改 frontmatter | ✅ | **参考 A 有** |
| pi 包（extension/skill/prompt/theme）安装 | ✅ `extension-manager.ts` + `package-catalog.ts`（解析 pi.dev/packages 的 HTML） | ✅ `SettingsManager` + `DefaultPackageManager` | ✅ | 都有 |
| **声明式插件 SDK（manifest + 权限 + 视图槽）** | ❌ 插件 = pi extension（进程内受信任代码） | ❌ 同 | ✅ `packages/plugin-sdk`：`views/commands/agentTools/skills/themes/providers/mcpServers/services/bus/globalShortcuts/composerTransforms/renderer` + `permissions/fs/net` + 沙箱面板 | **参考 B 独有** |
| 插件市场 | ✅ pi.dev 包目录 | ❌ | ✅ marketplace + 签名/更新 | 形态不同 |
| 宿主自绘 UI 槽（插件往应用里画组件） | ❌ | ❌ | ✅ renderer slots（composer 控件、消息操作条、工具卡、代码块渲染器） | **参考 B 独有** |

**建议动作**：`PX-08` 技能市场 + 逐技能开关 · `PX-11` 插件 SDK（评估，见 PLAN §4）。

---

## 6. 模型与供应商

| 能力 | Pinext | pi-agent-desktop | PI-Desktop | 结论 |
|---|---|---|---|---|
| 自定义供应商 + 模型增删排序 | ✅ `providers-settings.tsx`、`provider-detail.tsx` | ✅ | ✅ | 都有 |
| 每供应商 enable/disable | ✅ `provider-detail.tsx:315` | ✅ `EnabledModelsProviderSwitch` | ✅ | 都有 |
| **每模型开关（pi `enabledModels` glob + `:level` pin）** | ❌（模型列表即启用集，但无 scope 语义） | ✅ `lib/enabled-models.ts`（最小编辑 + `resync` 修复重命名） | ✅ | **参考 A 有** |
| **模型收藏 / 收藏置顶** | ❌（只有每供应商拖拽排序 `provider.modelOrder`，无跨供应商收藏） | ◐ 星标 = **设为默认模型**（`ModelSelector.tsx` + `SelectorRow.tsx`）；列表保持 pi 的 /model 顺序、只标记不重排（`lib/model-scope.ts:174-185`） | ❌（`docs/spec/04-ux/08-component-spec.md:3602` 直说 `No model favorites/pinning`） | **三家都没有 → Pinext 自设计（用户提出），PX-22** |
| OAuth（订阅登录） | ✅ `providers:oauth-*` | ✅ `/api/auth/login/[provider]` | ✅ | 都有 |
| 目录刷新（models.dev） | ✅ 每小时 + 手动 | ✅ 「Refresh catalog」按钮 | ✅ | 都有 |
| 用量/余额查询 | ✅ `provider-usage.ts` + gateway 余额 + OpenAI 配额 | ✅ `lib/provider-usage.ts` | ✅ | Pinext 更全 |
| 成本/价格阶梯 | ✅ `engine/pricing.ts` + models.dev tiers | ◐ | ✅ | Pinext 领先 |
| **非聊天模型（分类器 / 生图模型）独立设置页** | ◐ 生图 ✅ `imagegen-settings.tsx`；分类器走决策引擎 | ✅ `NonChatModelsDetail.tsx`（classifier + image + codemode 偏好） | ✅ | **参考 A 有** |
| 模型详情（协议/上下文/输出/推理/模态/思考强度） | ✅ `model-detail-dialog.tsx` | ✅ | ✅ | 都有 |
| 导入其他客户端凭据（cc-switch） | ✅ `cc-switch-import-dialog.tsx` | ❌ | ❌ | Pinext 独有 |

**建议动作**：`PX-09` 每模型启用开关 · `PX-12` 非聊天模型页（低优先） · `PX-22` 模型收藏（自设计，置顶 + 行内星标）。

---

## 7. 文件、预览与编辑器

| 能力 | Pinext | pi-agent-desktop | PI-Desktop | 结论 |
|---|---|---|---|---|
| 文件树（懒加载、.git/node_modules 隐藏） | ✅ `side-pane-files.tsx` | ✅ `FileExplorer.tsx` | ✅ | 都有 |
| 代码高亮 | ✅ Shiki + `@shikijs/stream` | ✅ `lib/syntax-highlighting.ts` | ✅ | 都有 |
| diff 渲染（非高亮） | ✅ `diff-view.tsx` + `lib/diff.ts` 行号 | ✅ `DiffPanel.tsx` | ✅ | Pinext 处理更细 |
| 图片 / 视频 / PDF 预览 | ✅ `shared/media-preview.ts`（流式，不 base64） | ✅ | ✅ | 都有 |
| 音频预览 | ❌ | ✅ `AUDIO_EXT_TO_MIME` | ◐ | **参考 A 有（小）** |
| office 文件（docx/xlsx/pptx） | ✅ 抽取为 markdown/csv（`file-preview.ts:62`） | ✅ docx 渲染 | ✅ | 都有 |
| HTML 沙箱预览 | ✅ `pinext-media://` + `INLINE_HTML_CSP`（无 `allow-same-origin`） | ✅ `srcDoc` + `HTML_PREVIEW_SANDBOX` + 引导脚本 | ✅ | 都有，Pinext 的 CSP 更严 |
| **Mermaid 渲染** | ❌ | ✅ `MermaidBlock.tsx` | ✅ | **缺口（小，收益高）** |
| **Markdown 代码围栏里的 HTML/SVG/React 内联预览** | ❌（只预览**文件**与 `present` 的东西） | ✅ `HtmlPreviewBlock.tsx`：完整 HTML / SVG / 自包含 React 模块围栏自动加预览按钮 | ◐ | **参考 A 有** |
| **React/JSX 预览运行时**（内置 React+Sucrase+Tailwind） | ❌ | ✅ `public/preview-runtime/`（≈660 KiB，内联注入，import map 指 `esm.sh`） | ❌ | **参考 A 独有** |
| **Artifacts（`:::artifact` 指令 + 右侧面板 + 版本 + 类型 html/react/svg/mermaid/markdown/code）** | ❌ | ✅ `lib/artifacts.ts` + `ArtifactPanel.tsx` + `artifact-store.ts` | ✅ work panel | **最大展示层缺口** |
| 编辑器可写（文本/代码/markdown 保存） | ✅ `workspace:write-file` | ✅ `FileViewer.tsx` | ✅ | 都有 |
| 文件右键菜单（预览/在文件夹中显示/复制路径） | ✅ `path-menu.tsx` | ✅ + **Open With（macOS Launch Services）** | ✅ | 参考 A 多一项 |
| 拖拽/粘贴图片附件 | ✅ `attachments.ts` | ✅ | ✅ | 都有 |
| `!command` 就地执行 bash 并折叠输出（`!!` 只显示、不进上下文） | ❌ | ✅ `ChatInput.tsx:680-681`（`bashMode` / `bashExcluded`）+ `MessageView.tsx:2040` `BashExecutionView`；SDK 1.2.0 已内置 `executeBash()` + `bash_execution_update` 事件 | ❌ | **参考 A 有 → PX-23（落点是接线，SDK 已支持）** |

**建议动作**：`PX-01` Mermaid + 围栏预览 + 音频 · `PX-07` Artifacts · `PX-23` `!command`（0.12 复核补记）；Open With 不补（PLAN §6）。

---

## 8. 终端、浏览器、Git

| 能力 | Pinext | pi-agent-desktop | PI-Desktop | 结论 |
|---|---|---|---|---|
| 终端（xterm + node-pty，多标签） | ✅ `side-pane-terminal.tsx` + registry | ✅ `TerminalPanel.tsx` | ✅ | 都有 |
| 内置浏览器（webview + 工具驱动） | ✅ `side-pane-browser.tsx` + `browser-use` 扩展 + guest 不重挂载 | ✅ `BrowserPanel.tsx` | ✅ 保留页面 per tab | Pinext 的「不重挂载/弹窗守卫/无对话框」经验更多 |
| Git 面板（变更/暂存态/last-turn/图谱） | ✅ `side-pane-git.tsx`、`git-graph-tab.tsx` | ◐ diff 面板 | ✅ | Pinext 更完整 |
| 分支切换/新建（就地） | ✅ `git-branch-chip.tsx`（搜索 + 创建并检出） | ✅ `PUT /api/worktrees` + `POST /api/worktrees/fetch` | ✅ | 都有 |
| **worktree 侧栏切换器（列出/新建/切换/删除）** | ❌ 只有 Agent 工具（`resources/extensions/worktree.ts`）+ API（`shared/api.ts:453`），**渲染层无 UI** | ✅ 侧栏 worktree 下拉（10s 轮询 + 焦点刷新 + `dirty` 409 二次确认） | ✅ worktree 分区 | **参考 A 有** |

**建议动作**：`PX-13` worktree 侧栏切换器（API 已就绪，纯 UI 补齐）。

---

## 9. 工作区与项目

| 能力 | Pinext | pi-agent-desktop | PI-Desktop | 结论 |
|---|---|---|---|---|
| 项目实体 + 多文件夹 + 排序 + 重命名 | ✅ `project-folders-dialog.tsx`、`shared/project-folders.ts` | ◐ 按 cwd 派生 | ✅ 持久 Projects 索引 | Pinext 与 B 相当 |
| 项目默认值（模型/思考等） | ✅ `project-defaults.tsx` | ❌ | ✅ | Pinext 领先 |
| 归档（会话级 + 自动归档） | ✅ `archived-settings.tsx` + `lib/auto-archive.ts` | ◐ | ✅ 项目归档页 | Pinext 有自动归档 |
| **项目信任（repository-controlled 配置的执行许可）** | ❌（SDK `projectTrusted` 默认 true） | ✅ `ProjectTrustDialog.tsx` | ✅ `docs/spec/05-security` | **安全向缺口** |
| 允许读写的根（allow-list） | ◐ 会话 cwd + 项目文件夹 | ✅ `lib/file-access.ts` 显式 allow-list | ✅ | 参考 A 更严 |
| 指令文件编辑器（AGENTS.md / CLAUDE.md / AGENTS.override.md） | ❌ | ◐ `SystemPromptPanel.tsx`（只读） | ✅ Instructions 页 | 两者都强 |
| 自定义存储位置 | ◐ 仅 `PINEXT_USER_DATA` 环境变量（`paths.ts:142`） | ❌ | ✅ custom-storage-location ADR | 参考 B 有 |

**建议动作**：`PX-14` 项目信任（安全，需拍板）· `PX-15` 指令文件编辑器（低优先）。

---

## 10. 远程访问与多端

| 能力 | Pinext | pi-agent-desktop | PI-Desktop | 结论 |
|---|---|---|---|---|
| 局域网 Web/手机接入（密码 + 设备令牌 + QR + mDNS） | ✅ `src/main/server/**`（策略表覆盖检查、背压、心跳） | ◐ PWA / 浏览器 profile + `PI_WEB_PASSWORD` | ✅ | Pinext 工程化程度更高 |
| 账号发现 + WebRTC 官方连接（直连/中转 + 帧分片） | ✅ `src/main/rtc/**` | ❌ | ❌（用 RACP） | **Pinext 独有** |
| SSH 远程主机 + 手机直连（`phoneAccess`） | ✅ `src/main/ssh/**` | ❌ | ✅ Remote Hosts | Pinext 与 B 相当 |
| 手机端 App | ✅ Flutter `apps/mobile_flutter` | ❌ | ❌ | Pinext 独有 |
| **远程控制协议（第三方/脚本客户端接入）** | ◐ 有 App Protocol（`shared/api.ts` 同一张表） | ❌ | ✅ **RACP**（`packages/racp`） | 参考 B 的 RACP 面向第三方，见 PLAN §4 |
| **配置云同步（加密备份）** | ❌ | ❌ | ✅ S3 加密配置同步 | **参考 B 独有** |
| 配置**同步到全局 pi**（单向写 `~/.pi/agent`） | ✅ `engine/sync-pi-config.ts` | —（本来就是 `~/.pi`） | — | Pinext 独有 |

**建议动作**：`PX-16` 配置云同步（大，需先定产品口径）。

---

## 11. 记忆、决策与其它智能体能力

| 能力 | Pinext | pi-agent-desktop | PI-Desktop | 结论 |
|---|---|---|---|---|
| 长期记忆（Codex 式文件记忆，阶段1/阶段2） | ✅ `engine/memory*.ts` + `docs/memory.md` | ◐ workspace-memory | ✅ 自建记忆表 | 三家不同实现 |
| 决策引擎（批量判定 + 浏览器判定） | ✅ `engine/decision/**` + `batch_decide` | ❌ | ❌ | **Pinext 独有** |
| 生图 | ✅ `engine/imagegen` + `generate_image` | ◐ 非聊天模型页 | ✅ image-generation ADR | 都有 |
| 联网搜索 | ✅ `web-search` 扩展（仅 responses 模型） | ◐ | ✅ | 都有 |
| 电脑操控（computer use） | ❌ 已移除（提交 `dce3cdb3`） | ❌ | ❌ | 不做 |
| 语音（听写 / 朗读 / 实时语音） | ❌ | ❌ | ✅ dictation + speech + **Live Voice**（Codex/Gemini/OpenAI Realtime） | **参考 B 独有** |
| IM 推送 / 机器人频道 | ✅ `im-bridge` + `bot-channel` | ❌ | ❌ | Pinext 独有 |

**建议动作**：`PX-17` 语音（仅听写+朗读，Live Voice 不做）。

---

## 12. 界面、主题与通知

| 能力 | Pinext | pi-agent-desktop | PI-Desktop | 结论 |
|---|---|---|---|---|
| 主题（首方主题集 + light/dark + 系统跟随） | ✅ 24 套，`lib/themes.ts` | ✅ 原生主题 | ✅ + 插件主题 | Pinext 数量更多 |
| 玻璃/毛玻璃（macOS vibrancy） | ✅ 整套 `glassTokens` + Liquid Glass 近似 | ◐ native-theme | ✅ | Pinext 更细 |
| **用户自定义 CSS** | ❌ | ✅ custom stylesheet | ◐ | 参考 A 有（小） |
| **完成提示音** | ❌（`grep -rl AudioContext src resources` 为空；旧 Next.js 版本的 `lib/sound-presets.ts` 在迁移中丢失，见 `docs/upstream-alignment-plan-2026-10-12.md:271`） | ✅ `hooks/useAudio.ts`（单一双音 + 开关 `pi-sound-enabled`，`lib/app-prefs.ts:11`；**无音色库**） | ✅ | **缺口** |
| 系统通知（总开关 + 点通知回到会话） | ✅ `engine/notifications.ts` | ✅ `lib/desktop-notify.ts` | ✅ | 都有 |
| 窄视口 / 移动布局（抽屉、触屏行、键盘） | ✅ 整套（AGENTS.md「窄视口」） | ✅ `useViewportHeight` + PWA | ✅ | 都有 |
| 键盘可达性（右键菜单键盘导航、IME） | ✅ 已具备：IME 在 `composer.tsx:611` 第一行就 `event.nativeEvent.isComposing \|\| key === "Process"` 直接 return；菜单键盘导航由 Base UI `context-menu` 原语提供 | ✅ `DomContextMenuHost` + IME 三件套 | ✅ | **不需要做**，只做一次键盘走查即可 |
| **i18n key 对齐门禁** | ◐ 只有 `settings.json` 被 `test/settings-copy.test.ts:47` 校验 key 对齐，其余 5 个命名空间无门禁 | ✅ `lib/i18n/registry.ts` + `usage.test.mjs`（含未使用/缺失 key） | ✅ | **缺口（小，工程向）** |
| 运行过程折叠 / 思考耗时 / 连续工具折叠 | ✅ `run-collapse.tsx`、`tool-run.ts` | ✅ process-details fold | ✅ turn-process ADR | Pinext 与 B 都细 |

**建议动作**：`PX-18` 提示音 · `PX-19` 右键菜单键盘可达（无障碍）。

---

## 13. 桌面壳与发布

| 能力 | Pinext | pi-agent-desktop | PI-Desktop | 结论 |
|---|---|---|---|---|
| 自动更新（后台检查 + 手动下载 + release notes 渲染） | ✅ `src/main/updater.ts` + `release-notes.tsx` | ✅ 签名自动更新 + 每周检查 | ✅ electron-updater | 都有 |
| 单窗口 + 托盘（定时任务） | ✅ 单窗口；托盘仅任务启用 | ✅ 托盘 + 窗口状态恢复 | ✅ 常驻托盘 + **托盘会话快捷入口** | 参考 B 托盘更丰富 |
| 原生弹窗菜单 | ◐ DOM 菜单为主 | ✅ Rust 原生 popup menu | ✅ | 参考 A 有 |
| 三平台打包 | ✅ mac/win/linux（electron-builder） | ✅ mac/win/linux | ✅ 三平台 | 都有 |
| 发布 note 由 CI 转正为 Release body | ✅ `docs/release/<tag>.md` 流程 | ◐ | ◐ | Pinext 有制度 |

**建议动作**：无（托盘会话入口见 `PX-20`，低优先）。

---

## 14. 汇总：可借鉴清单（按性价比排序）

| # | 动作 | 来源 | 类型 | 价值 | 代价 | 依赖 |
|---|---|---|---|---|---|---|
| PX-01 | Mermaid + 围栏 HTML/SVG/React 预览 + 音频预览 | A | 新增功能 | 高 | S | — |
| PX-02 | 定时任务硬化：cron / 补跑 / 租约 / 失败停用 / 时长上限 | A | 补齐 | 高 | M | — |
| PX-03 | 每任务工具预设 / 模型 / 思考层级 | A | 补齐 | 中高 | S | PX-06 |
| PX-04 | MCP OAuth 登录 | A | 新增功能 | 高 | M | — |
| PX-05 | MCP 粘贴导入（CLI 解析 + 校验 + 密钥引用） | A | 补齐 | 中高 | M | — |
| PX-06 | 只读工具/MCP 策略（只读会话 + 子代理） | A | 补齐 | 中 | S | — |
| PX-07 | **Artifacts（`:::artifact` + 面板 + 版本 + 类型）** | A | 新增功能 | 高 | L | PX-01 |
| PX-08 | 技能市场搜索安装 + 逐技能 `disable-model-invocation` | A | 新增功能 | 中 | M | — |
| PX-09 | 每模型启用开关（pi `enabledModels` 语义） | A | 补齐 | 中 | M | — |
| PX-10 | MCP 市场（官方 registry + catalog JSON） | B | 新增功能 | 中 | M | — |
| PX-11 | 插件的声明式 manifest（权限 + 贡献点） | B | 新增功能 | 高 | XL | 见 PLAN §4 |
| PX-12 | 非聊天模型页（分类器 / 生图 / codemode 偏好） | A | 补齐 | 低中 | S | — |
| PX-13 | worktree 侧栏切换器 | A | 补齐 | 中 | S | API 已就绪 |
| PX-14 | 项目信任（repository 配置执行许可） | A/B | 安全 | 中高 | M | 需拍板 |
| PX-15 | 指令文件编辑器（AGENTS.md 等） | A/B | 新增功能 | 中低 | M | — |
| PX-16 | 配置云同步（加密） | B | 新增功能 | 中 | L | 需产品口径 |
| PX-17 | 语音（听写 + 朗读） | B | 新增功能 | 中 | L | — |
| PX-18 | 完成提示音（音色 + 试听） | A | 新增功能 | 中 | S | — |
| PX-19 | ~~右键菜单键盘可达 + IME 兜底~~ → **降级为「键盘走查」**：IME 已在 `composer.tsx:611` 处理，菜单键盘导航由 Base UI 提供，不是缺口 | A | 验证 | — | 走查 | — |
| PX-20 | 托盘会话快捷入口 | B | 新增功能 | 低 | S | — |
| PX-21 | i18n key 对齐门禁扩到全部命名空间 | A | 工程 | 中 | S | — |
| PX-22 | **模型收藏（收藏置顶 + 菜单内星标）** | 用户提出（三家参考均无） | 新增功能 | 中高 | S | — |
| PX-23 | `!command` 就地执行 bash（折叠输出；`!!` 不进上下文） | A（0.12） | 补齐 | 中高 | M | SDK 1.2.0 已支持 |
| PX-24 | 流式实时 t/s（流中速度显示） | A（0.12） | 补齐 | 低中 | S | — |
| PX-25 | MCP 项目级覆盖（`.pi/mcp.json` 覆盖全局服务器） | A（0.12） | 补齐 | 中低 | M | PX-05 |

**明确不做**：消息引用/批注/浮动批注索引（B 自己删了）、Live Voice（重且与产品无关）、自建 SQLite/自写 runtime（架构不同）、RACP（Pinext 已有 App Protocol + 官方连接）、PWA 化（已有 Flutter 手机端）、`enabledModels` 之外的 models.dev 目录替换（已有）、原生弹窗菜单 / Open With / TerminalExtraKeys / 自定义 CSS（见 PLAN §6 低优先候选）。
