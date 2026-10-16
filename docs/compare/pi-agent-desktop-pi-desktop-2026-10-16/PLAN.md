# 计划：三方对比后的借鉴落地（拆成 PR）

日期：2026-10-16
对照报告：`FACTS.md`（基线事实）、`01-feature-matrix.md`（功能矩阵 + `PX-01…PX-25` 清单）
修订：2026-10-16 二次修订 —— 参考 A 侧已对照到 **0.12.1**（原基线 0.10.0），补入 PX-22…PX-25；详见 §0 与 §8。
目标：**只吸收「参考 A 同源 + 参考 B 交互判断」里 Pinext 真正缺的能力**，每条独立可回滚，不碰架构。

---

## 0. 结论先行

1. **Pinext 在能力广度上已经领先**：DAG 编排、决策引擎、长期记忆、远程访问（RTC + LAN + SSH + Flutter 端）、IM 推送、用量成本、分叉用量不重复计——两家参考项目都没有。
2. **真正该补的是三类**：
   - **同源展示层**（参考 A 有、Pinext 迁移后丢了）：Artifacts、Mermaid、围栏内联预览、React 预览运行时、提示音、`!command`、工具预设、每模型开关、非聊天模型页。
   - **同源可靠性**（参考 A 的定时任务与 MCP）：cron、补跑、单调度器租约、失败停用、时长上限、MCP OAuth 登录、MCP 粘贴导入校验、只读 MCP 策略。
   - **参考 B 的两件对外能力**：MCP 市场、声明式插件 manifest（后者是 XL，见 §4）。
   - **二次修订补入（2026-10-16 复查）**：
     - 参考 A 已到 **0.12.1**（对比基线是 0.10.0）。把 0.11/0.12 的新增文件逐个核过之后，仍未覆盖的同源项只有三项：`PX-23`（`!command` ——此前只在结论里点名、没有条目）、`PX-24`（流式实时 t/s）、`PX-25`（MCP 项目级覆盖，低优先）。
     - 用户提出的 **`PX-22` 模型收藏**：**三家参考项目都没有收藏语义** —— pi-web 的星标是「设为默认模型」（`lib/model-scope.ts:174-185` 明确「保持 pi 的 /model 顺序、只标记不重排」），PI-Desktop 的 spec 直说 `No model favorites/pinning`（`docs/spec/04-ux/08-component-spec.md:3602`）。所以这是 Pinext 自设计，交互（行内星标）借 pi-web。
     - 修正批次表缺 **`PX-16`**（并入 Batch 5 拍板）与 **`PX-20`**（降为「低优先」行）的遗漏。
3. **不补的**：消息引用/批注/浮动批注索引（参考 B 自己 ADR 0268 删了）、Live Voice、自建 SQLite/自写 runtime、RACP、PWA 化。
4. **排序原则**：先 S 代价且用户天天看得见的（Batch 0）→ 再做同源可靠性补齐（Batch 1–2）→ 再动设置页与模型（Batch 3）→ Artifacts 单独一批（Batch 4）→ 需拍板的安全/产品项放最后（Batch 5）。

---

## 1. 批次总览

| 批次 | PR | 主题 | 代价合计 | 前置 |
|---|---|---|---|---|
| 0 | PX-22 · PX-18 · PX-01 · PX-23 · PX-24 · PX-21 | 看得见的小缺口与日常手感 | ~8 天 | — |
| 1 | PX-02 · PX-13 · PX-06 · PX-03 · PX-05 | 定时任务与 MCP 导入 | ~7.5 天 | PX-06 → PX-03 |
| 2 | PX-04 · PX-10 · PX-25 | MCP 深水区（PX-25 排最后） | ~10 天 | PX-05 |
| 3 | PX-09 · PX-08 · PX-12 | 模型与技能设置 | ~7 天 | — |
| 4 | PX-07a · PX-07b | Artifacts 与预览运行时 | ~12 天 | PX-01 |
| 5 | PX-14 · PX-15 · PX-16 · PX-17 | 需拍板：信任 / 指令 / 云同步 / 语音 | ~20 天 | 用户拍板 |
| 6 | PX-11 | 插件 manifest（评估后决定） | XL | §4 |
| 低优先 | PX-20 | 托盘会话快捷入口（随时可插，不排期） | S | — |

每条 PR 的验收统一为：

```bash
pnpm typecheck                      # 含 check:scripts（注入脚本可解析）
pnpm test                           # node:test，纯模块
pnpm exec electron-vite build       # 打包能过
```

新增设置项必须同时写 `locales/zh` 与 `locales/en`，且文案受 `test/settings-copy.test.ts` 的 130/150 字上限约束；新增会话级 IPC 必须带 `conversationId` 并走 `renderer/src/lib/engine-client.ts` 门面（AGENTS.md 会话作用域一节）。

---

## Batch 0 — 看得见的小缺口与日常手感（~8 天）

### PR-PX-22 · 模型收藏（收藏置顶 + 菜单内星标）

| 项 | 内容 |
|---|---|
| 做什么 | composer 的模型菜单（`ModelThinkingSelect`）里每个模型行右侧加一个星标：点星 = 收藏 / 取消收藏。菜单顶部出现一个「收藏」子菜单（先于全部供应商子菜单），收藏的模型按收藏先后平铺其中；被收藏的模型**仍留在原供应商子菜单**里（实心星标记），不搬家。没有收藏时不渲染该组 |
| 数据 | `settings.favoriteModels?: string[]`，元素为 `provider/modelId`（与 `modelKey()` 同形）—— 跨供应商，是客户端显示偏好：照 `archivedConversations` 的先例进 `AppSettings`（`stores/settings.ts:139` 的类型 + `:244` 的 `isIdList` 校验），写进 `settings.json` 后自动获得跨窗口广播与远程可读；Main 不需要读它 |
| 落点 | 纯函数进 `src/shared/model-order.ts`：`partitionFavoriteModels(models, favoriteKeys)` → `{ favorites, groups }`（未知 key 忽略、收藏顺序 = 数组顺序、空收藏不产生组）；UI 改 `components/model-thinking-select.tsx`（现在 `groups` 的构建就在 `useMemo` 里）；i18n 加 `chat` 命名空间 key（收藏 / 收藏模型 / 取消收藏） |
| 核实结论（为什么是自设计） | **三家参考项目都没有模型收藏。** pi-web 0.12.1 的星标是「设为默认模型」（`components/ModelSelector.tsx` + `SelectorRow.tsx` 的 `SelectorRowStar`），且排序明确「保持 pi 的 /model 顺序、只标记不重排」（`lib/model-scope.ts:174-185`）；PI-Desktop 文档直说 `No model favorites/pinning`（`docs/spec/04-ux/08-component-spec.md:3602`）。交互（行内星标）借 pi-web，语义（收藏置顶）是 Pinext 自己的 |
| 边界 | 不做拖拽排序收藏区（顺序 = 收藏先后）；不做「最近使用」（手机 `model_picker.dart` 有，桌面菜单加它收益不明）；**可选**：把「设为默认模型」一并放进行内菜单（pi-web 星标的真实语义），随本 PR 拍板 |
| 验收 | 新 `test/model-favorites.test.ts`（未知 key 忽略 / 顺序 / 空收藏 / 供应商分组不受影响）；`pnpm typecheck`；手动：星标 → 顶部出现 → 取消 → 消失 → 重启仍在 → 第二个窗口同步显示 |
| 风险 | Base UI 菜单项（`MenuPrimitive.Item`，渲染为带 `role=menuitem` 的元素）里**不要嵌套交互控件**：星标与行选中区**并列**（各自一个菜单项，星标固定窄宽），不要把按钮塞进 `DropdownMenuItem`/`CheckboxItem` 内部；`surface="settings"` 的使用处（`project-defaults.tsx`、`subagents-settings.tsx`、`providers-settings.tsx`）要么复用同一逻辑，要么明确隐藏星标 |

### PR-PX-18 · 完成提示音

| 项 | 内容 |
|---|---|
| 做什么 | 任务完成/出错时播放提示音；画面上提供一个开关与音色选择 + 试听；首次用户手势解锁 `AudioContext`；重新使用同一实例（新会话/切会话不重建） |
| 音色从哪来 | 参考 A 只有一种双音（`hooks/useAudio.ts` 的 `playTone`，523.25/659.25 Hz 两个正弦）+ 一个 `pi-sound-enabled` 开关。**音色库是 Pinext 自己旧版的东西**（`lib/sound-presets.ts`，迁移中丢失，见 `docs/upstream-alignment-plan-2026-10-12.md:271`），**恢复时把它一起带回来**，不要另起一套 |
| 落点 | 新 `src/renderer/src/lib/sound-presets.ts`（纯函数：id → 频率/时长/包络）；新 `useAudio` 钩子；设置 → 通用（与通知总开关同一分区）；触发点 `App.tsx` 对 `conversation_running` 的收尾 |
| 依据 | 参考 A `hooks/useAudio.ts`、`lib/app-prefs.ts:11`；本仓 `grep -rl AudioContext src resources` 为空 |
| 验收 | 新 `test/sound-presets.test.ts`（预设表完整、未知 id 回落、不得为空） |
| 风险 | 无（纯 renderer，不改主进程） |

### PR-PX-21 · i18n key 对齐门禁（工程向，半天）

| 项 | 内容 |
|---|---|
| 做什么 | 把 `test/settings-copy.test.ts` 已验证的「zh/en key 对齐」逻辑提到一个共用纯模块，对 `locales/{zh,en}` 下**全部 6 个命名空间**（`app/chat/common/schedules/settings/sidepane`）生效；复数后缀 `_one/_other` 的豁免规则保留且标明方向 |
| 为什么现在做 | 今天在 `chat.json` / `app.json` 里引一个不存在的 key，界面上直接显示原始 key，**没有任何检查能抓住**；旧版 Next.js 仓曾把它列为 P0 门禁（`docs/compare/pi-desktop-2026-10-01/PLAN.md` PR-05），迁移后只剩 settings 一个命名空间 |
| 落点 | `test/settings-copy.test.ts` 或新 `test/i18n-keys.test.ts` |
| 验收 | 故意删一个 `chat.json` 的 key → 测试必须失败；恢复 → 通过 |
| 风险 | 无（纯测试） |

### PR-PX-01 · Mermaid + 围栏内联预览 + 音频预览

拆三个小提交（同一 PR 或三个 PR 均可，建议一个 PR 三个 commit）：

| 子项 | 做什么 | 落点 |
|---|---|---|
| 1 | ` ```mermaid ` 围栏渲染成图（懒加载 `mermaid`，失败显示错误块，流式期间显示源码） | `components/chat/markdown-view.tsx` 的 `CodeBlock`；新 `components/chat/mermaid-block.tsx`；`package.json` 加 `mermaid` 依赖 |
| 2 | ```html / ```svg / ```jsx 围栏加「预览」按钮，输出走**已有**的沙箱（`INLINE_HTML_CSP` + `sandbox="allow-scripts"`），**历史消息不自动运行**（与参考 A 同样的理由：会卡住窗口） | `components/chat/markdown-view.tsx` + `components/chat/preview-panel.tsx` |
| 3 | 音频预览（`mp3/wav/ogg/m4a/aac/flac/opus`），与图片/视频同一条「只给 URL 不给字节」的路 | `src/shared/media-preview.ts` 的 `MEDIA_MIME` + `MediaPreviewKind`；`preview-panel.tsx` |

| 项 | 内容 |
|---|---|
| 依据 | 参考 A `MermaidBlock.tsx`、`HtmlPreviewBlock.tsx`、`lib/file-types.ts` 的 `AUDIO_EXT_TO_MIME`；本仓 `grep -rl mermaid src resources` 为空 |
| 验收 | 新 `test/markdown-fence.test.ts`：围栏分类（mermaid/html/svg/jsx/普通）纯函数；`pnpm check:scripts` |
| 风险 | mermaid 体积（懒加载 + 动态 import 即可）；CSP 不需改（已是 `wasm-unsafe-eval` + 自建 scheme） |

### PR-PX-23 · `!command` 就地执行 bash（0.12 复核补记）

| 项 | 内容 |
|---|---|
| 做什么 | composer 里以 `!` 开头的输入按 bash 执行（带附件不触发，同 pi-web）：`!cmd` 结果进转录**也进模型上下文**；`!!cmd` 只进转录、**不进上下文**；输出以折叠卡片渲染（命令、退出码、输出、cancelled / truncated 标记） |
| 依据 | 参考 A 0.12：`components/ChatInput.tsx:680-681`（`bashMode` / `bashExcluded`）+ `MessageView.tsx:2040` `BashExecutionView`（`excludeFromContext` 时标题为 `bash (local)`）；**SDK 1.2.0 已内置**：`session.executeBash()`（`agent-session.d.ts:823`）、`bash_execution_update` 流式事件、`BashExecutionMessage`（`messages.d.ts:17`，角色 `bashExecution`，含 `exitCode`/`cancelled`/`truncated`/`fullOutputPath`/`excludeFromContext`）、`bashExecutionToText()` —— 不需要 Pinext 自己跑 shell |
| 落点 | 新会话级 IPC（如 `engine:execute-bash`，带 `conversationId`，走 `lib/engine-client.ts` 门面）→ `process-manager` 调 `executeBash()` 并转发 `bash_execution_update`；转录映射（`projectSessionMessages` / `mapEngineMessages`）识别 `bashExecution` 消息 → 新 `components/chat/bash-execution-view.tsx`；composer 的前缀判定加在现有 slash 检测旁 |
| 远端策略 | `remote-policy.ts` 归为**允许**：拿到密码的人本来就能让 agent 跑命令（与 `prompt` 同一杠杆），按策略表「拒绝面窄」的既有口径不新增拒绝项 |
| 验收 | 新 `test/bash-mode.test.ts`：前缀判定纯函数（`!` / `!!` / 前后空白 / 带附件 / 非 `!` 不触发）；手动 e2e：`!ls` 出折叠卡、退出码、中途 Stop → cancelled、`!!pwd` 不进上下文（下一次请求不含它） |
| 风险 | `bashExecution` 是**消息**（在 `session.messages` 里），所有转录消费端都要认识它：desktop 映射、快照、手机端（Flutter 不认识时应保持忽略而不是崩）；`truncated` 的全量输出在 `fullOutputPath`，**不**搬进转录 |

### PR-PX-24 · 流式实时 t/s（小）

| 项 | 内容 |
|---|---|
| 做什么 | 回复流式期间在页脚显示实时 token 速度（显示在估算 tokens 旁，仅 `isStreaming` 时出现），回合结束后不显示、由现有统计接管 |
| 依据 | 参考 A 0.12：`lib/stream-token-rate.ts`（按「首 token 出现时刻 + 数量」记一个起点，速率 = 增量 / 已流逝秒，`> 0.5s` 才给数；中途加入的回复只算之后的 token —— 切会话重挂载不会把已流入的分母算错）+ `components/MessageView.tsx:845`（`{tps.toFixed(1)} t/s`，按速率分档着色）。Pinext 现在只有回合结束后的统计弹层速度（`chat/composer.tsx` 的 `formatSpeed`） |
| 落点 | 纯函数 `src/renderer/src/lib/stream-token-rate.ts`（起点表按 reply key 存，仿参考 A：`provider/model@timestamp`，上限 32 条）；显示改流式回复页脚（与估算 tokens 同排） |
| 注意 | 分档着色**不要抄参考 A 的十六进制色**（违反本仓主题规则）—— 用语义 token（`text-success` / `text-warning` / `text-destructive`） |
| 验收 | 新 `test/stream-token-rate.test.ts`（首 token 前为 null / 0.5s 内为 null / 增量除时间正确 / 中途加入只算之后）；手动：长回复看到速率跳动，结束即隐藏 |
| 风险 | 无（纯 renderer 显示） |

### ~~PR-PX-19 · 右键菜单键盘可达 + IME 兜底~~（已核实为不缺，降级为走查）

| 项 | 内容 |
|---|---|
| 结论 | **不是缺口。** IME 兜底已经在 `src/renderer/src/components/chat/composer.tsx:611`（`handleKeyDown` 第一行就 `isComposing || key === "Process"` 直接 return），斜杠/`@` 菜单都在它之后；菜单的键盘导航/焦点管理由 Base UI `@base-ui/react/context-menu` 原语提供（`components/ui/context-menu.tsx`）。旧版 Next.js 仓列出的 PR-01 三件套在这里已经成立 |
| 保留的动作 | 一次手工键盘走查：`Shift+F10` 开菜单 → 方向键选 → `Enter` 执行 → `Escape` 关且焦点回到触发元素；不通过再单独立 PR |
| 备注 | 本条保留在清单里是为了让下一个人不再重复验证一遍 |

---

## Batch 1 — 定时任务与 MCP 导入（~7 天）

### PR-PX-02 · 定时任务硬化（本批性价比最高）

| 子项 | 做什么 | 依据（参考 A） |
|---|---|---|
| 1 | 规则加 `{ kind: "cron", expr, timeZone }`，表单加高级模式；cron 解析用**纯函数**（自研小解析器或已有依赖），落 `shared/schedules.ts` + `engine/scheduled-tasks.ts:69 nextScheduleAt` | `lib/scheduled-tasks/cron.ts` |
| 2 | **补跑**：睡醒/重启后「错过的那一次」按规则补跑一次，多次塌缩为一次；区分 `trigger: "schedule" | "catch-up" | "manual"` | `catch-up.ts:46` |
| 3 | **单调度器租约**：`runtime/engine/schedules/.lease`（写 pid + 心跳），非持有者不触发 | `lease.ts` |
| 4 | **连续失败自动停用**：`consecutiveFailures` 到 5 → `enabled=false` 并在任务卡上说明原因 | `consecutiveFailures` |
| 5 | **单次最长时长** `maxDurationMin`（默认 30，超时 `abort` 并记 `error`） | `runner.ts:125` |
| 落点 | `src/shared/schedules.ts`、`src/main/engine/scheduled-tasks.ts`、`src/main/pi/scheduled-task-manager.ts`、`src/renderer/src/components/schedules/*` |
| 验收 | 新 `test/schedule-cron.test.ts`（cron → 下次时间，含时区/闰/夏令时边界）、`test/schedule-catchup.test.ts`（补跑判定与塌缩） |
| 迁移 | 旧 `once/daily/weekly` 记录必须原样可读（`ScheduledTaskDraft` 只加可选字段） |
| 风险 | 中：改的是「无人值守的自动运行」。建议**先合 1+2+5**，`租约` 与 `失败停用` 单独一个 commit 便于回滚 |

### PR-PX-13 · worktree 侧栏切换器

| 项 | 内容 |
|---|---|
| 做什么 | 项目行/工作区行加 worktree 下拉：列出（`conversations:list-worktrees` 已有）、新建、切换绑定、解除（已有 `bind/unbind`）、删除（脏工作区 `409 dirty` 时二次确认再 `force`） |
| 落点 | `components/layout/sidebar-rows.tsx` 或新 `components/layout/worktree-switcher.tsx`；API 已在 `shared/api.ts:453-460`，**不需要新 IPC** |
| 依据 | 参考 A `docs/agents/files-and-access.md` 的 worktree 一节（含 `dirty` 409 与 `samePath` 教训）；本仓渲染层目前只显示 `worktree.path`（`git-status-popover.tsx:241`） |
| 验收 | 手工走查 + 若抽了纯逻辑（分支名排序/展示）加测试 |
| 风险 | 低 |

### PR-PX-06 · 只读工具 / 只读 MCP 策略

| 项 | 内容 |
|---|---|
| 做什么 | ① 会话级「只读」开关：活动工具集收敛为 `read/grep/find/ls`（复用已有 `engine/tool-modes.ts` 的 `applyToolModes` 钩子，**不要新建一条**工具集路径）；② 只读会话里 MCP 只暴露 `readOnlyHint === true` 的工具（`mcp-manager.ts:224` 已经在读这个提示，只是没人用） |
| 落点 | `src/main/engine/tool-modes.ts` + `src/main/pi/mcp-manager.ts` + 设置/会话控制条 |
| 依据 | 参考 A `lib/mcp-read-only-policy.ts`、`docs/agents/tools.md` 的 `PRESET_READ_ONLY` |
| 验收 | 新 `test/tool-modes.test.ts`（只读集 = 四个名字；MCP 过滤只留 readOnly） |
| 备注 | 这条是 `PX-03`（每任务工具预设）的前置 |

### PR-PX-03 · 每任务工具预设 / 模型 / 思考层级（小）

| 项 | 内容 |
|---|---|
| 做什么 | `ScheduledTaskDraft` 加三个**可选**字段：`toolPreset`（默认 `read-only`）、`model`、`thinkingLevel`；运行器建会话时应用它们；旧任务无字段时保持今天的行为 |
| 落点 | `src/shared/schedules.ts`、`src/main/pi/scheduled-task-manager.ts`（建会话处）、`components/schedules/task-form.tsx` |
| 依据 | 参考 A `lib/scheduled-tasks/client.ts:50`（`toolPreset` 默认 `read-only`，理由是「无人值守的自动任务没人把关」）、`runner.ts:71` |
| 前置 | `PX-06`（只读预设要真实生效，`toolPreset` 才有意义） |
| 验收 | 扩展 `test/scheduled-tasks.test.ts`：无字段 → 旧行为；`read-only` → 工具集收敛；非法值回落 |
| 风险 | 低（纯新增可选字段，迁移方向单一） |

### PR-PX-05 · MCP 粘贴导入（校验 + 密钥引用）

| 项 | 内容 |
|---|---|
| 做什么 | 在现有 JSON 粘贴之上补：① 粘贴 **CLI 命令**（`claude mcp add` / `codex mcp add` / `pi mcp add` / VS Code `--add-mcp`）并解析成条目；② 解析结果的**逐项校验预览**（缺字段、非法名、项目级禁止字面量密钥）；③ 密钥写成 `${VAR}` 引用而不是字面量 |
| 落点 | `src/shared/mcp-config.ts`（扩展，保持「唯一一套形状读取」））+ `components/settings/mcp-settings.tsx` 的导入对话框 |
| 依据 | 参考 A `lib/mcp-import-cli.ts`（731 行，含 `parseCliOptions`）、`docs/agents/mcp-add.md`（检查顺序：origin → JSON → cwd → 形状 → 归属 → 解析 → 命名 → 填充 → SDK 校验 → 密钥位置 → host-env 确认） |
| 验收 | 新 `test/mcp-import-cli.test.ts`：每种 CLI 选几个真实形状 + 反例（`--env` 用在 http、名字带 `/`） |
| 风险 | 中：解析器要覆盖 shell 引号与 `--` 分隔；**不要**顺手把服务端校验放宽 |

---

## Batch 2 — MCP 深水区（~10 天）

### PR-PX-04 · MCP OAuth 登录

| 项 | 内容 |
|---|---|
| 做什么 | 对声明了 OAuth 的 MCP 服务器提供登录/登出；token 存独立凭据文件（0600，temp+rename），**不进 `mcp.json`**；设置页显示「已登录 / 需登录」 |
| 落点 | 新 `src/main/pi/mcp-oauth.ts`（凭据存储）+ `mcp-manager.ts` 接线；`shared/api.ts` 加 `engine:mcp-sign-in` / `mcp-sign-out` |
| 必做配套 | 新方法**必须**在 `src/main/server/policy.ts` 里分类（否则服务端拒绝启动——这是设计防线，不是可选项）。登录会打开宿主机浏览器，按现有口径应 **拒绝远程调用**，与 `account:login` 一致 |
| 依据 | 参考 A `lib/mcp-sign-in.ts`、`docs/agents/mcp-test-sign-in.md`；本仓 AGENTS.md MCP 节「Not done: OAuth sign-in」 |
| 验收 | 用假 OAuth 服务端跑一次完整流程（参考 `test/account.test.ts` 的假站点写法） |
| 风险 | 中高：这是本轮唯一会「打开宿主机浏览器 + 落盘凭据」的新路径，policy 与凭据权限必须一起做 |

### PR-PX-10 · MCP 市场

| 项 | 内容 |
|---|---|
| 做什么 | 设置 → MCP 里加「市场」：浏览官方 registry（`https://registry.modelcontextprotocol.io/v0/servers`）+ 用户自加 Catalog JSON 源；卡片显示来源徽标；安装即写 `mcp.json`（复用 `PX-05` 的校验链）；支持搜索与分页 |
| 落点 | 新 `src/main/pi/mcp-market.ts`（纯解析 + 网络，与 `package-catalog.ts` 同一风格）+ `components/settings/mcp-settings.tsx` 新 tab |
| 依据 | 参考 B `docs/guide/mcp-market.md`（三份列表合并、registry 协议、`Load more`）；本仓已有 `package-catalog.ts` 的 HTML 解析先例 |
| 验收 | 新 `test/mcp-market.test.ts`（registry 响应 → 可安装记录；包类型优先级 npm > PyPI > https；含分页游标） |
| 风险 | 低（只读浏览 + 写 `mcp.json`）；注意与「已有 discovery 导入」去重 |

### PR-PX-25 · MCP 项目级覆盖（低优先，0.12 复核补记）

| 项 | 内容 |
|---|---|
| 做什么 | 项目目录里的 `.pi/mcp.json` 条目（**不带** `command`/`url`/`type`）只改全局同名服务器的 `enabled` / `exposure` / `toolExposure` —— 不含此文件的项目行为不变 |
| 依据 | 参考 A 0.12：`lib/mcp-override.ts`（pi 1.0.1 `loadMcpConfig()` 语义；`isMcpOverrideEntry` 判定、`mcpOverrideRefusal` 给出拒绝理由）；Pinext 的 `pinext/mcp/discovery.ts` 只把项目文件当**导入来源**，运行时无覆盖 |
| 切片与边界 | **只做「覆盖全局既有服务器」这一半**：`McpManager` 是「每引擎连接一次、tools 全量给出」，所以覆盖在**会话建立时**生效（按 cwd 过滤该会话的 MCP 工具集与 exposure），不做「项目文件新增连接」（那要每会话各连一份，违背一次连接的架构）。工具名空间 `mcp_<id>_<tool>` 不变 |
| 落点 | 纯函数进 `src/shared/mcp-config.ts`（读 + 校验覆盖条目，与设置的读取同一处）；`#createSession` 组装工具集处应用；设置 → MCP 的服务器行加一个「被哪些项目覆盖」的只读提示（可选） |
| 验收 | 新 `test/mcp-override.test.ts`（合法覆盖 / 缺全局同名服务器 → 拒绝理由 / 多设了不允许的键 → 拒绝 / 无 `command` 判定）；手动：临时目录放一份覆盖文件，开会话确认工具集变化 |
| 风险 | 低优先、可最后做：值是给「仓库自带 MCP 偏好」的团队用户；若评估后觉得受众太窄，可整条转 §6 |

---

## Batch 3 — 模型与技能设置（~7 天）

### PR-PX-09 · 每模型启用开关

| 项 | 内容 |
|---|---|
| 做什么 | 在「模型与默认」里加一层**模型级**开关，语义对齐 pi 的 `--models`：glob 模式（`provider/*` 注意 minimatch 的 `*` 不跨 `/`，要同时试 `provider/**`）+ 可选 `:thinkingLevel` pin；写入走「最小编辑」而不是重写整表；最后一条启用模型被关时拒绝并说明 |
| 落点 | 新 `src/main/engine/model-scope.ts`（纯逻辑）+ `providers-settings.tsx` |
| 依据 | 参考 A `lib/enabled-models.ts` + `docs/adr/0004`（`op: "prune"` 只用于清理；`resync` 在保存 models.json 后修复重命名） |
| 验收 | 新 `test/model-scope.test.ts`：`provider/*` 不漏嵌套 id、`A→B→A`、重命名后 resync 修复、空 scope 语义 |
| 备注 | Pinext 的 models.json 本身只含「已选模型」，所以这是**在其上加一层 scope**，不是替换。若评估后认为收益不足，可降级为「不做」（见 §5） |

### PR-PX-08 · 技能市场 + 逐技能开关

| 项 | 内容 |
|---|---|
| 做什么 | ① 技能页加「市场」：搜索并安装（`npx skills add …`，Pinext 内置技能 `find-skills` 已经教会模型手动走这条路，这里把它变成按钮）；② 每个技能一个 `disable-model-invocation` 开关，surgical 改 `SKILL.md` frontmatter（保留用户格式） |
| 落点 | `src/main/pi/skill-manager.ts` + `components/settings/skills-settings.tsx` |
| 依据 | 参考 A `docs/agents/settings-ui.md`、`/api/skills/install`、`/api/skills/search` |
| 验收 | 新 `test/skill-frontmatter.test.ts`：只在 frontmatter 增删该键，正文与其它键不动（含 CRLF、无 frontmatter 的文件） |
| 风险 | 中：写的是用户自己的技能目录，测试要覆盖「原样保留」 |

### PR-PX-12 · 非聊天模型页（低优先）

| 项 | 内容 |
|---|---|
| 做什么 | 把「生图模型」与「分类器模型」（决策引擎用的那个）合成一页，显示每个供应商是否已连接、模型是否可用 |
| 落点 | `components/settings/imagegen-settings.tsx` + `decision-settings.tsx` 合并或并列；`shared/types.ts` 加只读列表 |
| 依据 | 参考 A `NonChatModelsDetail.tsx`、`lib/nonchat-models.ts` |
| 备注 | Pinext 的这两个模型分别属于两个子系统，合并收益有限，可只做「同一页两个分区」 |

---

## Batch 4 — Artifacts 与预览运行时（~12 天）

这是本轮**展示层最大的缺口**，也是参考 A 最值得整体搬的一块。拆成两个 PR，第二个可独立不做。

### PR-PX-07a · Artifacts 基础

| 项 | 内容 |
|---|---|
| 做什么 | ① 解析 `:::artifact{identifier="…" type="…" title="…"}` + 内层围栏 + `:::`（**行扫描器，不要用 remark-directive**：那会把正文里的 `:name` 也变成指令）；② 助手正文里的每个块渲染成卡片；③ 右侧面板按 `artifact:<sessionId>:<identifier>` 开一个 tab，**同一 identifier 的每次出现是一个版本**，面板默认跟最新版；④ 小体量 mermaid/svg/markdown 留在正文内联，其余进面板 |
| 落点 | 新 `src/shared/artifacts.ts`（纯解析 + `encodeArtifactsForMarkdown`）+ `components/chat/artifact-card.tsx` + `stores/side-pane.ts` 加 tab 类型 |
| 依据 | 参考 A `lib/artifacts.ts`、`docs/agents/artifacts.md`、`ArtifactPanel.tsx` |
| 验收 | 新 `test/artifacts.test.ts`：嵌套同长围栏、流式中未闭合、无 `:::` 的回落、identifier 版本排序、MIME 拼写（`application/vnd.ant.react`） |
| DAG 提醒 | tab 不自动展开面板（与 Pinext 现有「子 agent 不自动展开」一致） |

### PR-PX-07b · React/SVG 预览运行时（可选）

| 项 | 内容 |
|---|---|
| 做什么 | 「自包含 React 模块」围栏可运行预览：内置 React 19 + Sucrase + Tailwind 浏览器版，**内联成 classic script**（Chromium 拒绝沙箱帧请求 localhost，所以不能 `<script src>`），import map 的其它裸包指向 `esm.sh` |
| 落点 | 新 `resources/preview-runtime/**`（构建脚本产出，必须在 `electron-builder.yml` 的 `extraResources` 里登记）+ `lib/preview-runtime.ts` |
| 依据 | 参考 A `public/preview-runtime/`、`scripts/build-preview-runtime.mjs`、`docs/agents/artifacts.md` 的「React runtime」一节 |
| 验收 | 构建脚本自检：产物能被 `new Function` 执行、JSX 能编译 |
| 风险 | 中高：多约 660 KiB 资产 + 一条新的资源打包路径。**建议先只做 07a，看用户实际用不用** |

---

## Batch 5 — 需拍板（安全 / 产品口径，~20 天）

| PR | 内容 | 为什么需拍板 |
|---|---|---|
| PX-14 | 项目信任：打开含 `.agents/skills`、`.pi/**` 的仓库前确认；不信任时技能/配置不加载，并在项目行上标出来 | Pinext 现在 `projectTrusted` 默认 true（AGENTS.md 明说不走 preTrust）。这改变「打开一个别人给的仓库」的行为，属安全口径 |
| PX-15 | 指令文件编辑器：在设置里编辑 `AGENTS.md` / `AGENTS.override.md` / `CLAUDE.md` | 会让 Pinext 写入用户仓库根目录的受版本控制文件，需要用户同意「允许应用改我的仓库文件」 |
| PX-16 | 配置云同步（加密备份）：把设置 / 供应商 / 技能同步到账号名下 | 「同步给谁、密钥从哪来、与官方连接和账号的关系」都要先定。参考 B 走 S3 加密包；Pinext 已有账号体系，但「数据根是本机」的原则要重新讨论（矩阵 §10，二次修订时从矩阵补入本表） |
| PX-17 | 语音：听写（本地/远端 STT）+ 朗读回复（TTS） | 新依赖 + 新凭据类型（第三方语音服务的 key）。**Live Voice 明确不做**（参考 B 的三种 binding 都要各自 OAuth/WebRTC，与 Pinext 产品无关） |

---

## 4. 关于插件 SDK（PX-11）的评估结论

**建议：不在本轮做，先做一件事——把「插件」这个词在 UI 上收敛清楚。**

理由（三条硬事实）：

1. **两者不是同一个东西。** 参考 B 的 `packages/plugin-sdk` 是：声明式 manifest（`contributes.{commands,agentTools,skills,themes,providers,mcpServers,services,bus,globalShortcuts,composerTransforms,views,sessionSources}`）+ 权限网关（`permissions/fs/net`）+ Node 子进程 + `WebContentsView` 沙箱面板 + 签名/更新 + marketplace。Pinext 的「插件」是 **pi extension**：一个 `.ts` 文件，在引擎进程里运行，`pi.registerTool` / `registerCommand` / UI 回调。
2. **照搬会同时改三件事**：引擎安全模型（进程内 → 进程外）、UI 组合方式（React 组件树 → 独立 WebContentsView + 槽位协议）、分发模型（npm 包 → manifest 包）。这是架构级改动，不是功能补齐。
3. **收益也没有那么大**：参考 B 的插件能做的「加一个工具/技能/主题/MCP 服务器」，Pinext 的 pi extension **已经能做**（本仓 `resources/extensions/**` 自带的十八个扩展就是证据）。真正多出来的是「往宿主界面里插组件」和「插件市场 + 权限」。

**如果要做，最小可用切片是**：

| 切片 | 内容 | 代价 |
|---|---|---|
| S1 | manifest 的最小契约：`name/version/entry/contributes.{tools,commands,skills,settings}`+ 权限声明，加载仍是进程内 pi extension（不换运行时） | M |
| S2 | 权限门：只用 manifest 声明的能力，未声明的 `pi.*` 调用报错（纯逻辑，可测） | M |
| S3 | 「设置项贡献点」：插件能往设置页插一组自己的配置行（这是 Pinext 现在完全没有的） | L |
| S4 | 沙箱视图（`contributes.views`） | XL，**不建议** |

建议顺序：**先做 S1+S2**（不换运行时、不碰 UI），观察是否有插件作者真的需要 S3/S4。

---

## 5. 明确不做

| 不做 | 理由 |
|---|---|
| 消息引用 / 批注 / 浮动批注索引 | 参考 B 自己在 ADR 0268 把它们删了（引用被 side chat 取代），Pinext 已有辅助对话 |
| Live Voice（实时语音） | 三种 binding 各要一套 OAuth/WebRTC/SDP，产品收益低 |
| 自建 SQLite / 自写 agent runtime / Rust sidecar | 架构不同，Pinext 的赌注是官方 pi SDK |
| RACP | Pinext 已有 App Protocol（同一张调用表）+ 官方连接；RACP 面向第三方托管方，与产品定位不符 |
| PWA 化 | 已有 Flutter 手机端 + Web 端；参考 A 的 PWA 是为「浏览器单机用」设计的 |
| 侧栏「会话 \| 文件」重画、ChatMinimap、`SessionSearch` 对话框 | 上一轮已判定借用价值低（`docs/compare/pi-desktop-2026-10-01/PLAN.md` §0 结论） |
| 自建模型目录替换 models.dev | Pinext 的 models.dev 快照 + 价格阶梯已经比两家都细 |
| 多语言（除 zh/en） | 用户明确只要 zh/en |

---

## 6. 低优先候选（评估后决定，不进批次）

矩阵里点过名、但复查后判断收益 / 代价不划算（或已有替代）的项。写在这里，是为了让下一个人不再重新评估一遍。

| 候选 | 结论 |
|---|---|
| Open With（macOS Launch Services 应用列表） | **不做**。参考 A 是 Tauri Rust 侧直接调 LaunchServices（`src-tauri/src/lib.rs:194` 列应用、`:297` 用指定 app 打开）；**Electron 没有等价 API**（`shell.openPath` 只能默认应用，列可选应用要自己桥 Objective-C）。收益（右键多一项）远小于代价 |
| 原生弹窗菜单 | **不做**。DOM 菜单已与主题 / 玻璃一致（AGENTS.md 主题规则），原生菜单会脱主题；参考 A 用它是因为 Tauri 侧天然可用，不是体验缺口 |
| 用户自定义 CSS | **低优先**。24 套主题 + 玻璃已覆盖绝大多数诉求；真要做需要先定「样式从哪里注入、CSP 怎么办（现在 `style-src` 不含任意 inline 层）」的信任问题，单独评估 |
| TerminalExtraKeys（触屏终端功能键条） | **不做**。窄视口不渲染右面板（AGENTS.md 窄视口一节），桌面触屏键盘有实体键；参考 A 的受众是 PWA 平板用户 |
| 文件树展开记忆 | **已有，不是缺口**：`settings.fileTreeExpanded` + `lib/file-tree-state.ts`（按 cwd 记忆）。打开项目时重置是刻意的（`side-pane-files.tsx:215` 注释） |
| 新对话时的工作区 / worktree 选择 | 不单独立 PR：**并入 `PX-13`** —— 侧栏切换器做出来后，同一个下拉放到新对话上下文条上即可（参考 A 0.12 的 `ProjectWorktreePicker`） |
| `PX-20` 托盘会话快捷入口 | 见 §1 表的「低优先」行：随时可插，不排期 |

---

## 7. 建议的启动顺序（一页）

```
Batch 0  PX-22 模型收藏（用户提出，排最前） ──┐
         PX-18 提示音 ──────────────────────┼─ 全部独立，可并行
         PX-01 Mermaid+围栏+音频 ───────────┤
         PX-23 !command 就地 bash ──────────┤
         PX-24 实时 t/s（小） ───────────────┤
         PX-21 i18n key 门禁（纯测试） ──────┘
              ↓
Batch 1  PX-02 定时任务硬化（cron/补跑/租约/失败停用/时长）  ← 本计划最高性价比
         PX-13 worktree 侧栏切换器（API 已就绪，纯 UI；顺带新对话工作区选择）
         PX-06 只读工具/MCP 策略  → PX-03 每任务工具预设/模型/思考层级
         PX-05 MCP 粘贴导入
              ↓
Batch 2  PX-04 MCP OAuth（含 policy 分类，必须同批） → PX-10 MCP 市场 → PX-25 项目级覆盖（可最后）
              ↓
Batch 3  PX-09 每模型开关 · PX-08 技能市场+逐技能开关 · PX-12 非聊天模型页
              ↓
Batch 4  PX-07a Artifacts → PX-07b React 预览运行时（可选）
              ↓
Batch 5  用户拍板：PX-14 项目信任 · PX-15 指令编辑器 · PX-16 配置云同步 · PX-17 语音
              ↓
Batch 6  PX-11 插件 manifest S1+S2（先不换运行时）
低优先   PX-20 托盘会话入口（随时可插）；§6 的候选（评估后决定）
```

---

## 8. 交付记录

| 日期 | 内容 |
|---|---|
| 2026-10-16 | 三方对比成文（`FACTS.md` / `01-feature-matrix.md` / 本文件）；`PX-01…PX-21` 定稿；本轮未改产品代码 |
| 2026-10-16（二次修订） | 参考 A 对照升级到 0.12.1：新增 `PX-22` 模型收藏（用户提出，三家参考均无，属 Pinext 自设计）、`PX-23` `!command`（结论里点名过、此次补成条目）、`PX-24` 流式实时 t/s、`PX-25` MCP 项目级覆盖（低优先）；`PX-16` / `PX-20` 补上批次归属；新增 §6 低优先候选（Open With / 原生菜单 / 自定义 CSS / TerminalExtraKeys / 文件树展开记忆核实为已有）；仍未改产品代码 |
| 2026-10-16（本轮第一批落地） | 合入 `PX-21`（`0fc9420a`）、`PX-18`（`5d569db2`）、`PX-01`（`d6c301c8`）、`PX-02`（`2b6c55a2`）、`PX-13`（`97eae5cd` + `539f4a76` 修 hook 顺序崩溃）、`PX-06`/`PX-03`（引擎半边随 `098f5ac2`、其余 `c91a699e`）、`PX-05`（`a579f6ad`）、`PX-09`（`d0a462d2`）、`PX-08` 逐技能开关（`0ac021de`）；另修 `6107a1d3`（`jev-provider-migration` 的假依赖表）。`PX-21` 一开启就抓到 6 个真实缺失的 i18n key |
| 2026-10-16（本轮第二批落地） | `PX-07a` Artifacts（`d408a0b6`）、`PX-10` MCP 市场（`bdddc902`）、`PX-04` MCP OAuth 登录（`d22f6202`）。至此 `PX-01`–`PX-10`、`PX-13`、`PX-18`、`PX-21` 全部落地；**`PX-12`、`PX-07b`、`PX-08` 的市场半边评估后放弃**（理由见下） |

**第二批的落地要点**（写在这里，因为代码注释之外还需要一份「为什么是这样」）：

- **`PX-07a` Artifacts** — 指令是行扫描器而不是 `remark-directive`（后者会把正文里的 `:name` 也变成指令）；**未闭合的指令不算产物**（那是正在流式写的那一段，画半张页面比显示源码更糟），而围栏闭合但 `:::` 缺失算完成；`encodeArtifactsForMarkdown` 把每个指令改写成一块 ```pinext-artifact（JSON 头），于是 markdown 管线只当一个块交给 `CodeBlock`，图不会被块切分器切开；**版本就是转写里的出现次数**（`collectArtifacts`），模型修订就是重写整个块，所以历史不需要存储。
- **`PX-10` MCP 市场** — 两种来源（官方 registry 分页 + 用户自加 Catalog JSON）共用一套读取器；**装不了的记录仍然列出并写明原因**（只有 OCI 包、需要 uv/uvx、`http://` 明文被拒），因为一行悄悄消失会被读成搜索坏了；`http://` 的远程被拒（凭据会明文过网），`https://` 的变成一个 HTTP 服务器。
- **`PX-04` MCP OAuth** — pi-mcp 自己的流程；令牌落 `runtime/engine/agent/mcp-oauth.json`（0600，temp+rename），**按服务器 URL 存放**（改名不丢授权，两个名字同一 URL 共用一份），**绝不进 `mcp.json`**（那个文件要发给每个客户端并随每次保存重播）；`engine:mcp-sign-in` 在 `remote-policy.ts` 里**拒绝远程**（浏览器开在宿主机、回环回调也在宿主机），`sign-out` 允许；浏览器通过注入的 `openExternal` 打开，所以没有浏览器的宿主得到一句话而不是在流程里崩。

**放弃的三项与理由**：

| 项 | 为什么 |
|---|---|
| `PX-12` 非聊天模型页 | Pinext 的两个「非聊天模型」不是一份列表：生图是**独立端点**（自己的 base URL 与 key，例如中转站的 `/v1/images/generations`），决策模型是一个当分类器用的聊天模型。合并出的页面里两件事除了「模型」一词没有共同点，而两个设置页各自已经显示了自己的选择与连接状态。参考项目能合并，是因为它的 runtime 直接暴露一份 `nonchat-models` 列表 |
| `PX-07b` React 预览运行时 | 本计划自己标的「可选」。代价是 vendored ~660 KiB 资源（React + Sucrase + Tailwind 浏览器版）加一条新的打包路径（`extraResources` + 沙箱帧内联注入）；换来的只是「组件能在应用里跑起来看」，而 `react` 产物现在**按源码渲染并注明**，读者可以复制出去。有人真的要求时再单独做 |
| `PX-08` 的市场半边 | 要跑 `npx skills find/add`：打包后的 Electron 不能假定本机有 Node/npx（参考项目为此专门加了警告），而 CLI 输出带 ANSI 颜色且交互式，解析脆弱。**内置的 `find-skills` 技能已经在这条路上工作**——它由 agent 在 bash 里跑，那里用的就是用户自己的 shell 与 PATH。真正缺的不是再包一层 UI |
