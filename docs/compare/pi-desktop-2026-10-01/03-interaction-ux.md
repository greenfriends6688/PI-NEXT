# 03 · 交互 / 细节手感（micro-UX）对比

分析日期 2026-10-01 · 范围：输入区 / 流式渲染 / 键盘导航 / 右键与浮层 / 拖拽重排 / 对话框表单 / 反馈机制 / 可访问性 / 易漏细节
对手：`pi参考项目/PI-Desktop-main` @ `pi-desktop` 0.16.0-beta.1

---

## 0. 前置核对

### 0.1 上一轮 `PD-01…PD-22` 的落地状态（grep 实证）

`docs/pi-desktop-borrowing-plan-2026-09-24.md` 的 22 条全部属于**功能 / 性能**范畴（三态常驻、diff 懒取、平板档位、项目归档、导入层、模型高级参数），**没有一条是交互手感**。抽查关键落点均已存在：`components/FileViewer.tsx`、`components/ProjectArchivePanel.tsx`、`components/ImportPanel.tsx`、`lib/project-flags.ts`、`lib/import/`。未交付的是 §5 自列的 `PR-03`（PD-03/04/05，文件查看器性能），属另一 agent 范围。

**结论：本报告全部条目都是 2026-09-24 之后新增的，没有需要从那份文档里剔除的重复项。** `[已验证]`

### 0.2 我们已经修过、不再重提的（`git log --oneline -30`）

| 提交 | 内容 | 本报告不重复 |
| --- | --- | --- |
| `fd4701e` | 9 个复制点接上失败反馈 | 复制三态 / `CopyStateIcon` / `CopyFailedNotice` |
| `76776f7` | 全站悬浮反馈 + 设置转场 + spinner 周期 | hover 态、spinner 节奏 |
| `e9d5d59` | 消息动作行显隐钩子随 `.pw-msg-acts` 归位 | 动作行 hover 显隐 |
| `b0e0ca0` | @菜单 / /命令菜单 / 历史弹层 / 会话搜索接 `pw-pop` | 四个弹层的视觉层（**只查行为，不查配色**） |

### 0.3 纪律遵守

- 未提任何建表方案（PD-11 起的 localStorage 模式我们已经有了）。
- 未提任何 sidecar / 常驻进程方案。
- 涉及新视觉件的建议一律落在**现有 `pw-*` + `board.css`** 上，不新造类名。

---

## 1. 输入区（Composer）

### 1.1 🔴 高价值：IME 组合输入 —— 我们缺「compositionend 丢失」的兜底

**他们踩过的坑（#929）**：`scripts/e2e-composer-ime-stack.mjs` 的头注释写得很直白——

> after a Chinese IME leaves "/、" in the composer, deleting it and typing "/" again must reopen the slash menu.
> A Windows Chinese IME can drop `compositionend` when the composing text is deleted. `composing` is component state … so a flag stuck true freezes the trigger and only an unmount clears it — which is the "a new conversation is the only escape" half of the report.

三道防线，**每一道我们只做了第一道的一半**：

| 防线 | 他们 | 我们 | 判定 |
| --- | --- | --- | --- |
| ① Enter/Tab 键路由：`isComposing \|\| keyCode===229` 直接 return | `features/chat/composer/ComposerInput.tsx:122` | `components/ChatInput.tsx:2484-2487`（`isComposingRef.current \|\| nativeEvent.isComposing \|\| nativeEvent.keyCode === 229`） | ✅ 我们更全（多一个 grace 窗口，见 1.2） |
| ② **组合中冻结补全触发器**（不是"跳过按键"，是整个 trigger 冻结到 `compositionend`） | `hooks/use-composer-autocomplete.ts:170-176`：`const trigger = composing ? frozenRef.current : liveTrigger` | 无。`slashQuery` 是从 `value` **纯派生**的（`components/ChatInput.tsx:1862`），组合中照样重算 | ❌ 缺 |
| ③ **compositionend 丢失兜底**：`onInput` 里若 `!isComposing` 就证明上一次组合已结束 | `ComposerInput.tsx:112` → `Composer.tsx:585` `onSettledInput={() => draft.setComposing(false)}`；`ComposerInput.tsx:33-40` 有 12 行注释解释为什么 | 无。`components/ChatInput.tsx:3692-3700` 的 `onInput={handleInput}`（`ChatInput.tsx:2669-2678`）只做自动增高，**不碰 `isComposingRef`** | ❌ 缺 |

**我们的实际故障路径**（`[已验证]`，纯代码推演，无需跑浏览器）：

1. 用户输入 `/` → `slashQuery = ""`（`ChatInput.tsx:1862`）→ `setSlashMenuOpen(true)`（`:2745`）。
2. 切中文输入法，开始组合 → `isComposingRef.current = true`（`:3693`）。
3. **Windows 中文 IME 删掉组合文本时丢 `compositionend`** → `isComposingRef.current` **永久停在 true**。
4. 之后：① Enter 发送被 `ChatInput.tsx:2489-2491` 吞掉（走 native 换行，用户以为键盘坏了）；② `@` 菜单（`:2590`）和引用菜单（`:2565`）因为 `!isComposing` 判据而**永远失去键盘操作**；③ 历史菜单（`:2494`）、ArrowUp 召回（`:2613`）、Esc 中断（`:2623`）全部失效。**唯一出路是切会话让组件重挂载。** 与他们报告的「a new conversation is the only escape」逐字对上。

他们的回归脚本 `scripts/e2e/composer-ime-stack.tsx` 特意分两段（`normal` / `recovered`），第二段用 `{ composing: true, endComposition: false }` 精确模拟"丢 compositionend"。

**另有一处更细的**：他们把中文顿号 `、` 重写成 `/`（`packages/shared/src/composer-trigger.ts:58-62` `rewriteIdeographicCommaTrigger`，在 `useComposerDraft.ts:334-336` 只对"从空草稿起手的那一次输入"生效）。这是中文输入法打 `/` 时全角标点污染的补丁。我们没有这一层，`:1862` 的 `value.startsWith("/")` 对全角 `／` 直接失配。

### 1.2 ✅ 我们已经更好的地方

| 项 | 我们 | 他们 |
| --- | --- | --- |
| Enter 后宽限期 | `ChatInput.tsx:226` `COMPOSITION_END_ENTER_GRACE_MS = 100`，`:2483` 判 `recentlyComposed` 并 `preventDefault` | 无 grace，只有 `isComposing` |
| Shift+Enter Markdown 列表续行 | `ChatInput.tsx:2632-2655` `continueMarkdownList`（无序/有序/task/引用/缩进，无前缀则删整段） | `ComposerInput.tsx:97-105` 只 `insertNewlineInEditor()` 插裸 `\n` 文本节点 |
| 队列拖拽重排 | `ChatInput.tsx:1047-1057` + `:3107-3135`，`queueDropTarget` "所见即所得" | `ComposerStatus.tsx` 的队列只有 ↑↓ 按钮 |
| 斜杠菜单布局 | `:3326-3345` `minmax(260px,1fr)` 两列 + sticky 分组头 + `slashMenuMaxHeight` 视口夹取 | 单列；`scripts/e2e/composer-autocomplete-layout.tsx` 专门回归"长名/长描述必须截断而不是撑爆菜单" |
| 补全源 TTL | `@` 菜单的 `fileIndexMetaRef`/`fileIndexFetchingRef` 缓存 + 手动失效（`ChatInput.tsx:1104-1105`）；高亮层另有一条 30s TTL + 并发去重（`ChatInput.tsx:1137-1139` 注释 D2-PR-12） | 模块级 `SOURCE_TTL_MS = 10_000`（`use-composer-autocomplete.ts:25`），命令/文件两条源 |
| 单测 | `components/ChatInput.test.mjs:58-66` 六条组合输入用例（ref / native / grace / 移动端） | 只有 e2e，无单测 |

### 1.3 斜杠触发条件：我们只认「行首 /」

`ChatInput.tsx:1862`：

```ts
const slashQuery = !compact && value.startsWith("/") && !/\s/.test(value.slice(1))
```

他们 `packages/shared/src/composer-trigger.ts:70-91` 的 `detectTrigger(value, cursor)` 是**光标锚定**的：向前扫到空白边界，`slashStart > 0` 时照样返回 trigger，只是 `tokenStart > 0` 会被 `use-composer-autocomplete.ts:225` 解释为"这是技能引用而不是 app 命令"（`filterCommands(commands, query, skillsOnly)`）。

**后果**：`帮我看下 /review 这个技能` 这种「句中 slash」在我们这里**完全不触发**补全。`[已验证]`

### 1.4 ⚠️ 斜杠菜单的按键处理**没有** IME 门（同一文件里另外两个菜单有）

```ts
// ChatInput.tsx:2517
if (slashMenuOpen && slashQuery !== null) {      // ← 少了 !isComposing
// ChatInput.tsx:2565
if (referenceMenuOpen && referenceQuery !== null && !isComposing) {   // ← 有
// ChatInput.tsx:2590
if (atMenuOpen && atQuery !== null && !isComposing) {                // ← 有
```

`ArrowUp/ArrowDown/ArrowLeft/ArrowRight/Tab/Enter/Escape` 在 `2517-2560` 全部无条件 `preventDefault()`。`onChange`（`:3684`）在组合期间照样触发并重算 `slashQuery`，所以**中文候选窗口的上下键与 Enter 会被斜杠菜单吃掉**。他们的做法是从根上冻结 trigger（1.1②），我们只是漏了一个 `&&`。`[已验证]`

### 1.5 粘贴

| 维度 | 他们 | 我们 | 判定 |
| --- | --- | --- | --- |
| 大段文本 | 超 `largePasteThreshold`（设置项，`normalizeLargePasteThreshold`）**转成 `.txt` 附件**再插入 chip，不进正文 | 无阈值，全量塞进 textarea（`:2681-2737`） | ❌ 缺 |
| 文件 vs 文本优先 | `preferClipboardText(text, files, getDroppedFilePath)` 显式判优 | 只看 `clipboardData.items` 里有没有 `kind==="file"`（`:2685-2691`） | 他们更细 |
| 小文本 | `preventDefault` + `recordClipboardPaste` 记历史 + 手动插文本节点 + `commitEditorDom` | 交给原生（无 html 时 `return`，`:2731`） | 各有道理 |
| 剪贴板来源 | 记一次 `recordClipboardPaste`，供后续 paste 判优 | 无 | ❌ 缺 |
| 拖入文件夹 | 显式二选一弹层：「作为项目打开」/「插入目录路径」（`useComposerAttachments.ts:openDroppedFolderAsProject` / `insertDroppedDirectoryPaths`） | 只有 `useDragDrop.ts` 收文件 | ❌ 缺 |
| 拒收反馈 | — | `useDragDrop.ts:12-17` 非文件拖入 → `flagRejected()` 抖动提示，**1200ms** 后复位 | ✅ 我们独有 |

他们的 paste 有独立回归脚本 `scripts/e2e-composer-paste.mjs` + `scripts/e2e/composer-paste.tsx`（"Composer paste regression with real React hooks, preload, and scratch writer"）。我们**没有任何浏览器级 e2e**（`e2e/` 目录只有 6 个脚本：chat-appearance / extension-dialog / file-panel / file-viewer-modes / terminal / themes）。`[已验证]`

### 1.6 草稿持久化：等价，不用动

两边都是**内存 Map，不落盘**：
- 他们 `apps/desktop/src/lib/composer-draft-cache.ts:20-23`：「Nothing here is written to disk; a full renderer reload still starts blank」。
- 我们 `lib/draft-store.ts:26` `const drafts = new Map<string, ChatDraft>()`。

差别只在写入时机：他们**懒写**（切会话/卸载/失焦/visibilitychange，`useComposerDraft.ts:339-360`、`:377-410`），并明确注释「plain typing does not serialize on every keystroke」；我们**每次渲染都写**（`ChatInput.tsx:1750-1758`，依赖数组含 `value`）。内存 Map 下这个成本可以忽略，**不建议改**。`[已验证]`

真正值得抄的是他们草稿里的两个字段：`fileReferences`（带 `token` 的 chip 元数据）和 `workspacePath`（工作区变了就把相对路径引用作废，`useComposerDraft.ts:412-455`）。我们的 `ChatDraft` 只有 `value/images/contexts/sessionReferences`（`lib/draft-store.ts:14-22`）——`referenceAttachments` 在切会话时被直接丢弃（`ChatInput.tsx:1785`）。低价值，可不做。

### 1.7 多行展开规则

| | 我们 | 他们 |
| --- | --- | --- |
| 上限 | `maxHeight: 200`（内联，`ChatInput.tsx:3727` 附近） | `COMPOSER_MAX_VISIBLE_ROWS = 7`（`features/chat/composer/model.ts:19`），按 `lineHeight × rows + verticalChrome` 算 |
| 最小高度 | `minHeight: compact ? 96 : 24` | `COMPOSER_MIN_HEIGHT_PX = 28` |
| 手动接管 | ✅ `hooks/useResizableHeight.ts`（死区 3px、localStorage 持久化） | ❌ 无 |
| 占位文案轮换 | 单条（`ChatInput.tsx:3704-3707`） | `PLACEHOLDER_KEYS` 三条按会话轮换（`model.ts:21-30` + `useComposerDraft.ts:150-156`） |

我们的 200px 硬编码和行高换算相比是**弱一档**：改字号/密度后行数会变。建议改成"行高 × 7"，与他们对齐。`[推断]`

### 1.8 发送 / 中断 / 队列

| 语义 | 我们 | 他们 |
| --- | --- | --- |
| Enter 发送 | `ChatInput.tsx:2480` `e.key==="Enter" && !shiftKey && (!isMobile \|\| ctrl \|\| meta)` | `ComposerInput.tsx:142-147` `enterToSend` 设置项（默认 true），或 ⌘/Ctrl |
| 流式中 Enter | 排队（`:2659-2662` steer / followup） | **不排队**；`Alt+Enter` 才 steer（`:123-128`） |
| 中断 | Esc 且 `isStreaming`（`:2623-2627`） | `Mod+.`（`packages/shared/src/keyboard-shortcuts.ts:56`） |
| 队列可见性 | ✅ steer/follow-up 两栏 + 拖拽 + 删除（`:3100-3140`） | ✅ `ComposerStatus.tsx` 队列行（↑↓ / 编辑 / 立即发送） |
| 队列编辑 | 无 | 有，且**占用前置判据**：`Composer.tsx:225-232` 若输入框非空则拒绝并 toast「busy」 |
| 提示词增强（AI 改写） | 无 | `useComposerSubmit.ts:enhancePrompt` + `undoPromptEnhancement` + 版本号防竞态（`:115-121`） |

「Alt+Enter = steer、Enter = 插队下一轮」这个分离（`ComposerInput.tsx:123-128`）比我们的「流式中 Enter 一律排队」更清晰——我们没法在流式中"立刻打断插话"。**但这是产品语义决策，不是纯手感**，标 `[推断]`。

### 1.9 字数 / token 预估

**两边都没有 composer 内的 token 预估。** 他们把上下文用量放在工具栏（`Composer.tsx:117-124` `latestTurnContextInspector`），我们放在 `ChatInput` 的 `openStatsPopover`（`ChatInput.tsx:213` props 声明、`:1157` 实现，`/session` + 触屏入口）。**不报差距。** `[已验证]`

### 1.10 补全触发器冻结 / 程序化写入不弹菜单

他们 `useComposerCompletions.ts:105`：`enabled && value === typedValue`——只有**用户敲出来的**文本才允许插件触发器响应，程序化 `applyEditorDraft` 永远不弹菜单。我们 `updateAtQuery` 只在 `onChange`/`onSelect`/粘贴三条路调（`ChatInput.tsx:2732, 3684, 3688, 3699`），但 `onSelect` 在 `setSelectionRange` 后浏览器会补 `select` 事件，理论上程序化插入引用后可能误开菜单。**未能实证**，标 `[推断]`。

---

## 2. 流式渲染

### 2.1 打字机：他们有可关的平滑释放，我们只有节流

| | 他们 | 我们 |
| --- | --- | --- |
| 实现 | `hooks/useSmoothText.ts` | `hooks/useThrottledText.ts` + `lib/stream-throttle.ts` |
| 策略 | 60 字/秒基础速度，积压 > 30 字时按 `backlog / 0.5` **线性追赶**，保证显示落后真实内容 ≤ 500ms（`:57-63`） | 每 `DEFAULT_STREAM_THROTTLE_MS = 120`（`lib/stream-throttle.ts:19`）提交一次最新值 |
| 帧率上限 | 显式 60Hz 门（`:52-56`，高刷屏上防止 React/Markdown 提交过快） | 无（靠 120ms 定时器隐式约束） |
| 代理对 | 显式不切开 UTF-16 surrogate（`:106-114`） | 不切片，无此问题 |
| 设置开关 | `settings.smoothStreaming !== false`（`AssistantTurnParts.tsx:17`） | 无 |
| reduced-motion | 自动关（`AssistantTurnParts.tsx:18-20`） | 无 |
| 追赶光标 | `.smooth-cursor`（`AssistantTurnParts.tsx:22`） | 无 |

他们有专门的 `smoothTextThrottleProbe`（`scripts/e2e/transcript-render.tsx:24`）。**建议**：加一个设置开关 + reduced-motion 门，算法可以先不动（我们的 120ms 节流在实践中没有"落后感"投诉），**只补开关**——这是成本最低、感知最强的一条。`[已验证]`（代码层）/ `[推断]`（观感层）

### 2.2 🔴 高价值：展开折叠块时阅读位置被拖走（#324）

**他们踩过的坑**：`scripts/e2e-transcript-disclosure-anchor.mjs` 头注释：

> toggling a tool, thinking or activity title must not move the transcript the reader is looking at. … What it proves is geometry: the clicked title's offset from the scroller's top edge, and the scroll offset, before and after the toggle. The height delta is asserted to be large enough to matter.

实现 `hooks/use-disclosure-anchor.ts`（128 行）：

1. `notifier(title)` 在 `setManualOpen` **同步**调用（`features/chat/transcript/disclosure.tsx:120-124`），此时布局还是用户点击时的样子，量到的 `elementOffset` 才准。
2. `restore()` 由 scroller 自己的 `ResizeObserver` 驱动，**覆盖高度过渡的每一帧**（`use-disclosure-anchor.ts:88-97`）。
3. `followScrollNow` 里 `if (restoreDisclosureAnchor()) return;`——被 hold 时**这一帧不贴底**（`use-follow-scroll.ts:138-146`）。
4. 嵌套 scroller 把 hold **向外传**（`use-disclosure-anchor.ts:58-64`），否则内层长高会把外层也拖走。
5. 边界 clamp 之后采纳浏览器给的位置，不再纠第二次（`:105-112` `adoptDisclosureAnchor`）。

**我们**：有 prepend 锚定（`ChatWindow.tsx:1195-1222` `resolvePrependRestoreScrollTop`）和跟随权状态机（`ChatWindow.tsx:1235-1330`），但**没有 disclosure anchor**。`MessageView.tsx` 里有三处可展开块——工具调用（`:414-418` `useCollapsePresence`）、用户气泡的 `/命令` 头（`:517`）、思考块（`:1014-1022`）——在底部跟随态点开任何一个，**被点的标题会向上跑掉**（内容在它下方生长 → 贴底把视口往下拉）。`[已验证]`（代码层）

### 2.3 自动折叠不许抢走焦点与选区

他们 `features/chat/transcript/disclosure.tsx:58-65`：

```ts
function ownsReadingPosition(body: HTMLElement | null): boolean {
  if (body.contains(document.activeElement)) return true;
  const selection = window.getSelection();
  return Boolean(selection && !selection.isCollapsed && (...));
}
```

`:105-112`：自动收起若 `ownsReadingPosition` 为真就**撤销这次收起**。另 `:121-123` 手动收起时把焦点交还标题（`focus({ preventScroll: true })`），`:133-134` `bodyEvents: { onPointerDownCapture: claim, onFocusCapture: claim }`——指针/键盘一碰就算"用户接管"，后续流式更新不得自动关。

**我们**：`MessageView.tsx:1061-1068` 的思考块自动收起只判 `autoOpenedRef.current || manualOverrideRef.current`，**不查焦点、不查选区**。用户点开思考块 → 1s 内（`THINKING_AUTO_COLLAPSE_MS = 1_000`，`:163`）选中正文里的一段话 → 整块收起，选区消失。`[已验证]`

### 2.4 工具卡片家族

| 卡片 | 他们 | 我们 |
| --- | --- | --- |
| 通用工具详情 | `components/ToolDetails.tsx`(296) | `components/ProcessGroup.tsx` + `MessageView` 的 `ToolCallBlock` |
| 提问工具 | `components/AskToolCard.tsx`(233) + `AskToolRichText.ts`，带排队计数 `queuedAskCount` | 无独立形态 |
| 权限确认 | `components/PermissionCard.tsx`(131) | 无（走 SDK 的 permission 回调？） |
| 计划审批 | `components/PlanApprovalBar.tsx`(292) | 无 |
| 回合结局 | `components/TurnOutcomeCard.tsx`(81)，`role="status" aria-live="polite"`，**且只在没有 inline error 时才出现**（`:36-38`）——不重复报错 | 走 notice shelf |
| 变更审阅 | `components/ReviewChangeCard.tsx`(167)，diff 用 `+ / −` 字符而非纯色（`:19-23` `STATUS_MARKS`） | `FileViewer` 的 diff 视图（PD-22 范围） |
| 活动分组 | `features/chat/transcript/ActivityGroup.tsx`(632) | `components/ProcessGroup.tsx` |

`TurnOutcomeCard` 的"**失败已经有 inline 呈现时不重复插一张结局卡**"（`TurnOutcomeCard.tsx:36-38`）是一条干净的规则，我们没有对应物。`[已验证]`

### 2.5 跟随底部：两边都有，但语义不同

| | 他们（`hooks/use-follow-scroll.ts`） | 我们（`components/ChatWindow.tsx` + `lib/scroll-follow.ts`） |
| --- | --- | --- |
| 真实手势判定 | `wheel/touchstart/touchmove/pointerdown/keydown` 五个事件打时间戳（`:88-104`），`isRecentScrollGesture` 带容差 | `userIntentRef` 三态（none/…） |
| 容差 | `tolerancePx: gesturing ? 0 : TRANSCRIPT_SCROLL_ROUNDING_TOLERANCE_PX`（`:158-166`）——非手势时容忍分数 DPR | 纯逻辑在 `lib/scroll-follow.ts`，可单测 |
| 重定位时机 | 在 `ResizeObserver` 回调里**同步**重定位（D287：rAF 会多画一帧不跟随的旧画面） | `sendFollowUntilRef` + 时间窗 |
| 猴补丁 | 无 | 劫持 `container.scrollTo`（`ChatWindow.tsx:1352-1369`）否决无权时的程序化滚动 |
| 跳回底部按钮 | `showJump` | ✅ `chat-scroll-to-bottom`（`ChatWindow.tsx:2653-2665`），且 `onPointerDown` 就先恢复跟随权 |

**结论：这块我们不落后，甚至在"否决程序化滚动"上更严。** 不提建议。`[已验证]`

### 2.6 值得抄的一条：composer 高度回灌到转录底部留白

他们 `Composer.tsx:496-519`：`ResizeObserver` 量 dock 真实高度 → `document.documentElement.style.setProperty("--composer-dock-height", ...)`，注释写明「Setting a custom property on documentElement invalidates style for the whole document, so an unchanged dock height must not be republished」。

我们 composer 高度可拖（`useResizableHeight`），但转录底部留白是否同步？`ChatWindow.tsx` 里没有 `--composer-dock-height` 等价物。**未实证**，标 `[推断]`，价值低。

---

## 3. 键盘与导航

### 3.1 快捷键体系

**我们已有完整内核**（`lib/shortcuts.ts` + `hooks/useKeyboardShortcuts.ts` + `hooks/useShortcutBindings.ts`），内核质量**高于他们的初版**：`event.code` 兜底非 US 布局、噪声过滤（`isComposing` / `Process` / `Dead` / `keyCode 229` / 长按 `repeat`）、严格修饰键匹配（多一个修饰键就算不匹配）、平台标签。头注释明说技术是从参考项目 `packages/ui/src/shortcuts/bindings.ts` 借的。`[已验证]`

**差距在命令数量与迁移**：

| | 他们（`packages/shared/src/keyboard-shortcuts.ts:35-79`） | 我们（`lib/shortcuts.ts:70-78`） |
| --- | --- | --- |
| 条目 | **18** 条，3 组（navigation/agent/window） | **6** 条，4 组（含一个 `notMigrated`） |
| 平台差异 | `macDefaultBinding` 字段（`toggleFullScreen: F11` / mac `Mod+Ctrl+F`） | 无 |
| 覆盖迁移 | `migrateKeybindingOverrides()`：退休 id（`closeWindow`/`summonWindow`）折叠进 `toggleWindow`，并丢弃"等于当前或已废弃默认值"的伪意图（`:100-165`） | 无（我们还没有退休 id） |
| 冲突保护 | `packages/shared/src/keyboard-shortcuts.test.ts` 246-340 行专门测迁移 | `notMigrated` 组只是占位 |
| 缺失的常用项 | — | 无 `Mod+K` 搜索、无 `Mod+Shift+P` 命令面板、无 `Mod+[` / `Mod+]` 前进后退、无缩放 |

我们的 `findInConversation` 标了 `managed: false`（`lib/shortcuts.ts:78`），因为 `ConversationFindBar.tsx:107` 自己注册 ⌘F。**这是已知待收口项，不是新发现。**

他们有 `components/settings/KeyboardShortcutsSection.tsx` 做可视化改键；我们 `lib/shortcuts.ts` 已有 `getDefaultShortcutBindings` 等 API，改键 UI 需另查（属设置 agent 范围）。

### 3.2 IME 门控覆盖度

`scripts/e2e/ime-escape.tsx` 是一个**专门的 IME × Escape/Enter 回归**，断言三件事：
1. 组合中的 Escape **不得被消费**，也不得冒泡关掉外层 SearchDialog；
2. 组合中的 ⌘/Ctrl+Enter **不得提交**；
3. 正常 Escape / 重试必须照常工作。

它同时用 `{ isComposing: true }` 和 `{ keyCode: 229 }` 两种信号各测一遍。

**我们的覆盖情况**：

| 位置 | `isComposing` | `keyCode===229` | 判定 |
| --- | --- | --- | --- |
| `ChatInput.tsx:2486-2487` | ✅ | ✅ | 齐 |
| `components/fork/ConversationFindBar.tsx:92` | ✅ | ✅ | 齐 |
| `hooks/useKeyboardShortcuts.ts:82`（`isShortcutEventNoise`） | ✅ | ✅ | 齐 |
| `ChatWindow.tsx:869` / `:2953`（Esc） | ✅ | ❌ | 缺一半 |
| `ChatWindow.tsx:3141` / `:3156`（扩展 `input`/`editor` 弹窗 Enter） | ✅ | ❌ | 缺一半 |
| `ChatWindow.tsx:3306` / `:3314`（扩展终端输入） | ✅（另有 `composingRef`） | ❌ | 缺一半 |

`ChatWindow.tsx:3141` 的 `if (e.key === "Enter" && !e.nativeEvent.isComposing) submitValue()` 正是他们 fixture 里断言「组合中 Enter 不得提交」的那一处。补 `keyCode === 229` 是一行的事。`[已验证]`

### 3.3 Esc / Enter 语义分层

| 层 | 我们 | 他们 |
| --- | --- | --- |
| 全局 Esc | `useKeyboardShortcuts.ts:87-94` 调 `globalAbortHandler`，**但 target 是 TEXTAREA/INPUT 时让位** | `abort = Mod+.`，Esc 只给 voiceCancel |
| composer 内 Esc | 先关 history 菜单（`:2500`）→ 再关 @/引用/斜杠菜单 → 最后才中断 agent（`:2623`），**有优先级链** | 同一个 keydown 里先 `composerAc.close()`（`ComposerInput.tsx:130-135`），中断走 `Mod+.` |
| 对话框 Esc | `hooks/useDialogA11y.ts:107-111` capture 阶段 `stopPropagation` | 每个 dialog 自己写（`ProjectDeleteDialog.tsx:46-52`） |

**我们的分层比他们清楚。** 不提建议。

---

## 4. 右键菜单 / 悬浮层

### 4.1 我们的菜单实现更强

`components/ContextMenu.tsx`（427 行）已有而他们没有的：
- **一级子菜单**（`submenu?: Omit<ContextMenuItem,"submenu">[]`，类型上禁止二级，`:52-55`）
- **行内反馈标签** `feedbackLabel`，`FEEDBACK_MS = 1200` 后自动关闭（`:77`、`:243-252`）
- **wheel 阈值**：`|deltaX|+|deltaY| >= 8` 才关，注释写明触控板抖动会让浮层"鼠标一动就没"（`:203-215`）
- **两阶段入场** `useTwoPhaseEnter` + `CLOSE_ANIMATION_MS = 90` 退场动画（`:99`、`:110-123`）
- `checked` / `hint` 槽位

### 4.2 但我们缺三件 theirs 有的

| 缺 | 他们 | 影响 |
| --- | --- | --- |
| **菜单不接管焦点** | `ContextMenu.tsx:263-273`：开菜单后在 rAF 里 `querySelector('[role=menuitem]:not(:disabled)')?.focus()` | 我们的键盘导航 `onMenuKeyDown` 挂在 `tabIndex={-1}` 的菜单 div 上（`ContextMenu.tsx:339-341`），而**没人 focus 它** → 方向键导航事实上是死的 |
| **关闭后不还焦** | `ContextMenu.tsx:225-234`：开菜单前记住 `document.activeElement`，卸载时 `focus()` 回去 | 我们的关闭路径（`:110-123` `closeMenu`）不还焦，焦点落到 `<body>` |
| **Shift+F10 / 菜单键打开** | `ContextMenu.tsx:62-71` `pointForEvent`：`clientX/Y === 0` 时锚到聚焦节点 `min(24, w/2)` | 我们三个 `openMenu` 调用点（`SessionRowContextMenuBridge.tsx:35`、`FileExplorer.tsx:475`、`ProjectChip.tsx:153`）**只接鼠标 `onContextMenu`**，键盘用户完全打不开菜单 |
| aria-label 硬编码英文 | `aria-label={state.label}` 由调用方给 | `aria-label="Context menu"`（`ContextMenu.tsx:340`） |

### 4.3 菜单项集合：转录层是空的

他们 `features/chat/transcript/menu-items.tsx` 为三个表面（用户行 / 助手回合 / 会话背景）定义共享词表：复制、选中文本、编辑、**上一个/下一个版本**（重新生成后的 revision 导航）、删除（`danger` + `separatorBefore`）、文件引用的"在文件夹中显示 / 复制绝对路径 / 复制相对路径"（`hooks/use-chat-file-menu.tsx:31-49`）。

**我们的转录层没有右键菜单**。消息操作只有 hover 动作行的复制按钮（`MessageView.tsx:589-597` 用户行、`:952-962` 助手行）。`onEditContent` / `onRewind` 挂在 `MessageView` props 上（`:352`）但不在任何菜单/动作行里露出。`[已验证]`

另外 `use-copy-tex.ts`（#414）：`Ctrl/Cmd+C` 命中公式时把 **TeX 源码**而不是 KaTeX 字形放进剪贴板。我们用了 `rehype-katex`（`lib/markdown.ts:2`）但没有这条监听；我们的复制按钮走的是原始 markdown 源（`MessageView.tsx` 的 `textContent`），公式拷出来是 `$…$`，与"所见"不同但对模型友好。**优先级低。** `[已验证]`

### 4.4 浮层通用件

我们 `components/PortalDropdown.tsx`：`openAbove = spaceBelow < 260 && spaceAbove > spaceBelow`（`:98-99`），`--z-popover` 500 压过侧栏 200（`:117-122` 注释记录了"被侧栏整块盖住"的真 bug），`useDismissOnOutside`（`:148-170`）。
他们 `components/settings/AnchoredMenu` + `lib/portal-visibility.ts` 的 `portalToBody`，同样记录了「transformed 或 `overflow:hidden` 祖先会困住它」。

**这块等价，不用动。** `[已验证]`

---

## 5. 拖拽

| 能力 | 他们 | 我们 |
| --- | --- | --- |
| 列表项重排（HTML5 DnD） | `hooks/use-list-reorder.ts`：拖拽只**预览**落点，松手才改状态；手柄有 `ArrowUp/ArrowDown` 键盘等价（`:81-92`） | ❌ |
| 卡片重排（pointer 事件 + transform） | `hooks/use-card-reorder.ts`：自带 `suppressedClickPointerIds` 防止拖完误触发点击（`:57-59`），行上有 `tabIndex/aria-disabled` | ❌（但我们的**队列**有拖拽重排，`ChatInput.tsx:3107-3135`） |
| 用处 | 模型顺序（`useModelReorder.ts`）、provider 卡片（`useProviderReorder.ts`）、work panel（`e2e-work-panel-reorder.mjs` + `e2e/card-reorder-performance.tsx`） | 队列（`steer` / `follow-up` 两栏） |
| 会话重排 | ❌（会话是真源文件，排序不落盘） | ❌ |
| 文件拖入 | `lib/composer-drop.ts` + 目录二选一 | `hooks/useDragDrop.ts` |
| 文件树内移动 | — | `FileExplorer.tsx` |

**判定**：会话重排**两边都没有**，因为会话顺序不是可写字段（我们 `.jsonl` 目录按时间排，他们 SQLite 里有 order 概念但也没暴露拖拽）。**不建议做。** 我们的队列拖拽缺键盘等价路径（`beginQueueDrag` 只有鼠标 `onDragStart`/`onDropOn`，`ChatInput.tsx:3109-3113`），这一条值得补——同一个 hook 的两个 hook 都能抄（`use-list-reorder.ts:81-92` 只有 12 行）。`[已验证]`

---

## 6. 对话框与表单

### 6.1 危险操作：他们有统一的两段式，我们一半用 `window.confirm`

| | 他们 | 我们 |
| --- | --- | --- |
| 通用模式 | `hooks/use-armed-delete.ts`：`ARMED_DELETE_MS = 3200`，第一次点击上膛、调用方改标签，**到期自动解除**——「一个界面永远不会停在离永久删除只差一次误点的状态」 | 无通用件 |
| 行内两段式 | 用在侧栏行 / 行菜单项 | ✅ `SessionSidebar.tsx:2311,2430` + `DirectoryPicker.tsx:65,353` |
| 弹窗二次确认 | `ProjectDeleteDialog.tsx`（含"运行中的会话要先停掉"的显式步骤、Tab 循环、Esc、还焦） | ❌ |
| 命名空间 `confirm()` | ❌ | ❌ **`FileExplorer.tsx:1141` 删文件、`ChatWindow.tsx:2205` rewind、`AgentsConfig.tsx:347` 删子代理、`PluginsConfig.tsx:1286` MCP 强制握手，全是 `window.confirm`** |

`window.confirm` 在 Electron/PWA 里是**阻塞式原生弹窗**，样式不可控、文案不可本地化之外，还会在某些 PWA 安装态下与页面视觉割裂。这是**明确的、可低成本修掉的**手感问题。`[已验证]`

### 6.2 弹窗 a11y：我们更完整

`hooks/useDialogA11y.ts`：初始焦点（可指定 `initialFocusRef`）→ Tab/Shift+Tab 循环（**只在越界时拦截，中间的 Tab 交还浏览器** `:118-127`）→ Esc（capture 阶段 `stopPropagation` `:107-111`）→ **兄弟节点 `inert`**（`:69-80`，注释说明为什么不用 `aria-hidden`：前者同时屏蔽焦点与读屏）→ 关闭后还焦且不抢用户已移走的焦点（`:85-91`）。

他们的 `ProjectDeleteDialog.tsx:42-70` 手工实现了其中四项（**没有 inert**）。**我们更强，不提建议。** `[已验证]`

### 6.3 表单校验反馈时机

他们 `useComposerSubmit.ts:110-121` 的增强提示词用**三重版本号防竞态**（`enhancementRequestRef` token + `draftKey` + `enhancementVersionRef`），任何一项变了就丢弃响应；`ComposerStatus.tsx:57-70` 再用 `reportedEnhancementError` ref 保证**同一个错误只报一次 toast**，重挂载不会重报。

我们 `components/ModelsConfig.tsx` 的校验（PD-21）已在上一轮落地，不重复。我们**没有**「同一个错误只报一次」的 ref 模式——`NoticeShelf` 的 notice 由调用方决定是否重复 push。低价值。

---

## 7. 反馈机制

| 维度 | 他们（`components/Toast.tsx`） | 我们（`ChatWindow.tsx:2702-2760` `NoticeShelf`） |
| --- | --- | --- |
| 位置 | `document.body` 下的独立 host，`z-toast: 50` 压过 dialog 的 `z-dialog: 40`（`:96-103` 有 7 行注释解释为什么不能渲染在 shell 里） | 渲染在 `ChatWindow` 内 |
| 悬停暂停 | ✅ 剩余时间用 `remainingRef` 记账，移出续跑（`:29-46`） | ✅ 悬停 + 聚焦双暂停（`:2730-2739`） |
| 手动关闭 | ✅ 每条一个 `TooltipButton` 关闭键 | ❌ 只能等超时 |
| aria | error/warning → `role="alert"`，其余 `role="status"`（`:64`）；容器 `aria-live="polite"` | 整个容器统一 `role="status" aria-live="polite"`（`:2706-2708`）——**错误不会打断读屏** |
| 声音 | `playNotificationChime()` + `shouldPlayToastSound`（`:107-114`） | 无 |
| 退场 | 监听 `animationend` 且 `animationName === "toast-out"` 才移除（`:48-50`） | CSS `forwards` 动画 + 状态机（`:2750-2754`） |

**最值得抄的一条**：**error/warning 用 `role="alert"`**。我们的错误通知对读屏用户与 info 无差别。改动一行（按 `notice.type` 切 `role`）。`[已验证]`

**次一条**：toast 没有关闭按钮，长文本 + 用户正在读的时候只能干等。

### 7.1 空态

他们 `components/StartupSplash.tsx` / `HomeMascotLogo.tsx` / `OnboardingChecklist.tsx` / `StartupRecovery.tsx`（启动恢复提示）。我们 `components/fork/NewSessionHome.tsx` + `EmptyStateGuide.tsx`。**形态不同，产品决策，不比。** `[已验证]`

### 7.2 失败重试

他们 `TurnOutcomeCard` 提供"重发本回合"；`e2e-transcript-render.mjs` 覆盖 `turn-process` / `transcript-status` / `transcript-edit`。我们 `ChatWindow.tsx` 有 `retryInfo`（`ChatInput.tsx:909`）。**都有，不报差距。**

---

## 8. 可访问性

| 项 | 他们 | 我们 | 判定 |
| --- | --- | --- | --- |
| i18n | `packages/i18n` 12 种语言（en/zh-CN/zh-TW/ja/ko/de/fr/es/pt-BR/tr…），全 key 化 | `lib/i18n/messages/{zh,zh-TW,en}.ts` 三语 | 差，但属 i18n 范围 |
| `prefers-reduced-motion` | 9 个 CSS 文件 + 3 处 JS 分支 | 4 个 CSS 文件 + `ChatMinimap.tsx:457,507` 两处 | 都有，**不算差距** |
| 焦点环 | `styles/base.css:109` 全局 `:focus-visible` + 逐件覆写（宽度手柄、minimap marker、空态链接…） | `app/fork-ui.css` 多处 `:focus-visible` 覆写（`:604,611,805,1033,1502`） | 都有 |
| 列表重排键盘可达 | ✅ `use-list-reorder.ts:81-92` / `use-card-reorder.ts:43-52` | ❌ 队列拖拽无键盘路径 | ❌ 缺（见 §5） |
| 菜单键盘可达 | ✅ 打开即 focus 首项 | ❌ 见 §4.2 | ❌ 缺 |
| 状态不只靠颜色 | `ReviewChangeCard.tsx:19-23` `STATUS_MARKS: {added:"A", modified:"M", deleted:"D"}`，**颜色之外有字母** | diff 视图有 `+` / `−` 符号（`MessageView.tsx` 附近） | 都有 |
| 暗色可读性 | 走 `styles/*` 变量 + 主题表 | 走 `--n-*` token，另有 `npm run check:contrast` 门禁（FACTS.md） | **我们有门禁，不报差距** |

---

## 9. 其他易漏细节

### 9.1 会话宽度手柄：我们完全没有

他们 `components/ConversationWidthHandles.tsx`（263 行）：

- **双侧**手柄（`ChatContentResizeSide: "left" | "right"`），改一个 `--chat-content-max-width`
- 一处设三个变量：`--chat-content-max-width` / `--chat-composer-max-width` / `--chat-prose-max-width`（`:37-45`，注释说明漏第三个会导致「消息行冻结在 760px 而色带变宽」）
- `ResizeObserver` + rAF 合帧（`:157-172`）
- `pointercancel` = 取消但**保留当前宽度**（`:176-180` `finishDrag(..., cancelled=true)` → `applyPreferredWidth(committed)` 但不 persist）
- **双击复位**到 `DEFAULT_CHAT_CONTENT_MAX_WIDTH`（`:185-189`）
- **键盘**：`ArrowLeft/Right` 步进、`Escape` 取消拖拽（`:194+`）
- `setResizing` 同时打 `surface.dataset` 和 `documentElement.dataset`（`:47-55`）——拖拽时全局关掉文本选择
- 拖拽期间 `col-resize` 光标

**我们**：`grep -rn "contentMaxWidth|maxWidth" lib components app` 找不到任何会话宽度偏好。宽度只能靠 CSS 固定。**中等价值**（宽屏用户的真实诉求），但要新建持久化字段——**必须落在 `settings.json` 侧或 localStorage，不能建表**（约束 1）。`[已验证]`

### 9.2 minimap：两边都有，我们更细，不报差距

| | 他们 `ConversationMinimap.tsx`(424) | 我们 `ChatMinimap.tsx`(927) |
| --- | --- | --- |
| 磁吸放大 | `MAGNIFY_RADIUS=46` / `MAGNIFY_BOOST=1.3` 余弦衰减，只横向长 | 有 |
| 中心测量 | 显式注释：读 `offsetTop` 与写 `--magnify` 交错会**每帧一次同步重排**（`:105-112`）——改成只读 pass | — |
| 预览气泡 | 132px 高，`POPOVER_SNAP=24` | 320px 宽时间线（`MINIMAP_POP_WIDTH = 320`），带 markdown 预览 |
| 节点语义 | 无 | `deriveTurnNodeKind`（`ChatMinimap.tsx:70-79`）：`heading` / `tool` / `assistant` / `user` |
| 出现条件 | `OVERFLOW_EPSILON_PX = 1`——**内容没溢出就完全不渲染** | `scrollEl.scrollHeight - scrollEl.clientHeight > 20`（`:423`） |
| 更早历史标记 | `EARLIER_HISTORY_MARKER_ID = "__earlier-history__"` | 有 `onRevealHistory` / `loadingEarlier` |

**唯一可抄的**：他们的 `shouldRenderConversationMinimap` 门限是 **1px**，我们写死 **20px**。差 19px 意味着"刚好只多出一行"时我们的导轨不出现、他们的出现——这是他们回归脚本盯过的边界。不重要，**不提**。

### 9.3 会话搜索

| | 他们 | 我们 |
| --- | --- | --- |
| 触发 | `Mod+K`（`keyboard-shortcuts.ts:43`）→ `SearchDialog.tsx`(528) | `SessionSearch.tsx`（侧栏内） |
| 会话内查找 | `Mod+F` | ✅ `components/fork/ConversationFindBar.tsx`（⌘F） |
| 命中高亮 | **CSS Custom Highlight API**（`use-transcript-search-focus.ts:74-78`） | DOM range 高亮 |
| **对齐保持 1500ms** | `:69-70`：`alignUntil = now + 1500`；`ResizeObserver` 每帧把命中 range 拉回 `min(160, clientHeight/3)` 的位置（`:80-90`）；手势（wheel/pointerdown/方向键/Home/End/空格）**立即停止对齐**（`:96-104`） | 一次性 `scrollToMessage(element, position.anchorOffset)`（`ChatWindow.tsx:1068`） |
| 文本变更重建 | `MutationObserver`（`characterData`）→ 重定位 range（`:105-110`） | — |

**`alignUntil` 是这块最值钱的一条**：流式回答里命中的那段话会**持续生长**，一次性滚动定位在几秒后命中项就滑出视口了。他们的做法是"新请求给 1.5 秒的跟随对齐窗口，窗口内任何几何变化都把命中项拉回固定位置，用户一动就交还控制权"。我们的 `ConversationFindBar` 计数器和 `ChatWindow` 的 find 逻辑在流式回答里会退化成"点下一个"才看得到。`[已验证]`

### 9.4 Todo dock

他们 `TodoDock.tsx`：`VISIBLE_LIMIT = 8` + "还有 N 条"；头部三态符号（`⊘` / `✓` / `◐`）；`aria-hidden={!expanded}` 而不是卸载；`role="img" aria-label` 承载状态文字；切会话自动收起（`:26-28`）；`useSessionTodosRecovery` 从 host 恢复。

我们 `components/fork/TodoChip.tsx`：进度条 + 指名"进行中"项 + 复制清单（`TodoChip.tsx:15-25` 注释解释为什么**只读**——改勾选等于重写已落盘的工具结果）+ 三态复制反馈。**我们更贴合我们的数据模型**（todo 从转录派生，不是 host 状态）。唯一可抄的是 `VISIBLE_LIMIT` 截断。**价值低。** `[已验证]`

---

## 10. ⚠️ 他们踩过、我们也会踩的坑（按风险排序）

这些都有他们**成套的回归脚本**作为证据，说明该处出过真 bug。

| # | 坑 | 他们的证据 | 我们的现状 | 我们的风险 |
| --- | --- | --- | --- | --- |
| **W1** | **中文 IME 丢 `compositionend`** → composer 永久卡在"组合中"，Enter 发不出、Esc 停不了、菜单失键，只有关会话能解 | `scripts/e2e-composer-ime-stack.mjs` + `scripts/e2e/composer-ime-stack.tsx`（专门模拟 `endComposition: false`） | `ChatInput.tsx:3692-3700` 无 settled-input 兜底；`:2517` 斜杠菜单无 IME 门 | **高**。中文用户一撞就以为键盘坏了，且**没有自救路径** |
| **W2** | **斜杠菜单吞掉 IME 候选窗口的按键** | 同上（`use-composer-autocomplete.ts:170-176` 冻结 trigger 是解法） | `ChatInput.tsx:2517` 缺 `&& !isComposing`（`:2565`/`:2590` 都有） | **高**。打字 "/review" 时候选列表弹不出来或方向键选错字 |
| **W3** | **展开折叠块把阅读位置拖走** | `scripts/e2e-transcript-disclosure-anchor.mjs`（#324，断言 title 的 `getBoundingClientRect().top` 前后不变） | 无 disclosure anchor；`MessageView.tsx:517/1022` 三处可展开 | **中高**。长会话里点开一个工具块，正在看的那句话跑掉 |
| **W4** | **自动折叠抢走焦点/选区** | `disclosure.tsx:58-65` `ownsReadingPosition` | `MessageView.tsx:1061-1068` 只判 `manualOverrideRef` | **中**。1 秒窗口内选中思考正文即丢 |
| **W5** | **粘贴大段文本撑爆 composer** | `scripts/e2e-composer-paste.mjs` + `scripts/e2e/composer-paste.tsx` | `ChatInput.tsx:2681-2737` 无大文本阈值 | **中**。粘 50KB 日志 → 200px 高的框里塞满，同时触发高亮层全量重算 |
| **W6** | **补全菜单布局被长命令名/长描述撑爆** | `scripts/e2e-composer-autocomplete-layout.tsx`（断言 `row.scrollWidth <= row.clientWidth + 1`、菜单宽度 == 锚点宽度、`mousedown` 接受后焦点仍在 input） | 我们是 grid 两列 + `minmax(260px,1fr)`，长名折行问题上一轮已修（`:3333-3338` 注释） | **低**（已修） |
| **W7** | **组合中 Enter 提交 / Esc 冒泡关掉外层弹窗** | `scripts/e2e-ime-escape.mjs` + `scripts/e2e/ime-escape.tsx`（`isComposing` 与 `keyCode 229` 各测一遍） | `ChatWindow.tsx:869/2953/3141/3156/3306/3314` 只判 `isComposing` | **中**。Windows 中文 IME 下 229 路径会漏 |
| **W8** | **复制公式拿到 KaTeX 字形而不是 TeX** | `scripts/e2e-copy-tex.mjs`（#414）+ `ContextMenu.tsx:80-137` 的 50 行注释 | 无 `copy` 监听；复制走原始 markdown 源 | **低**（对模型友好，但与"所见"不一致） |
| **W9** | **转录渲染在长历史下崩** | `scripts/e2e-transcript-render.mjs` → `transcript-long-history.tsx` / `transcript-edit.tsx` / `turn-process.tsx` / `transcript-status.tsx` 四个 probe | `e2e/` 目录**没有任何转录级浏览器 e2e** | **中**。没有回归网，改滚动/折叠只能靠手点 |
| **W10** | **重排的拖拽松手误触发点击** | `use-card-reorder.ts:57-59` `suppressedClickPointerIds` + `scripts/e2e/card-reorder-performance.tsx` | 队列拖拽（`ChatInput.tsx:3107-3135`）无指针抑制 | **低-中**。队列重排后可能顺手点开某条 |

---

## 11. 建议动作

| # | 动作 | 类型 | 价值 | 代价 | 依赖 | 落点文件 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | **IME 兜底三件套**：① `onInput` 里 `if (!e.nativeEvent.isComposing) isComposingRef.current = false`；② `ChatInput.tsx:2517` 补 `&& !isComposing`；③ 组合中不重算 `slashQuery`（最小改法：`updateAtQuery` 开头加 `if (isComposingRef.current) return`） | 补齐 | **高**。W1+W2 是唯一会让用户以为键盘坏了的 bug；改动约 6 行，零架构影响 | **S**。3 处编辑 + 在 `ChatInput.test.mjs` 加 2 条 VM 用例 | 无 | `components/ChatInput.tsx:1862, 2517, 2669-2678, 3692-3700`；`components/ChatInput.test.mjs` |
| 2 | **IME 门控补 `keyCode === 229`**：把 `ChatWindow.tsx:869, 2953, 3141, 3156, 3306, 3314` 六处统一成一个 `isImeEvent(e)` 判据（与 `ChatInput.tsx:2486-2487` 保持一致），并抽到 `lib/` | 补齐 | **中高**。W7 有他们的专项回归脚本背书；`ConversationFindBar.tsx:92` 已经是正确写法，照抄即可 | **S**。抽一个 3 行函数 + 6 处替换 | 无 | 新增 `lib/ime.ts`；`components/ChatWindow.tsx` 六处 |
| 3 | **Disclosure anchor**：新增 `hooks/useDisclosureAnchor.ts`（照 `use-disclosure-anchor.ts` 的 notifier/restore/release/isHeld 四件套），接到 `ChatWindow` 已有的 `ResizeObserver` 跟随点上；`MessageView` 的三处可展开标题（`:517`、`:1022`、`:414`）在 toggle 前同步调 `notifier` | 移植交互 | **中高**。W3 的直接解法；不做的话每次展开工具块都在丢阅读位置 | **M**。hook 本身 128 行，接线要动 `MessageView` 三处 + `ChatWindow` 一处，且必须补几何断言测试 | 依赖 1（否则 IME 卡住时点击标题行为不确定） | 新增 `hooks/useDisclosureAnchor.ts`；`components/ChatWindow.tsx`；`components/MessageView.tsx` |
| 4 | **自动折叠不抢焦点/选区**：`MessageView.tsx:1067` 的 `setTimeout` 回调里加 `ownsReadingPosition(bodyRef.current)` 判据，为真则跳过收起 | 补齐 | **中**。W4；6 行 | **S** | 无 | `components/MessageView.tsx:1061-1068`；新增 `lib/owns-reading-position.ts` |
| 5 | **右键菜单接管焦点 + 还焦 + Shift+F10**：`ContextMenu.tsx` 开菜单后 rAF focus 首项（`:265`）、卸载时还焦（`:229`）、`onKeyDown` 加 `Shift+F10` / `ContextMenu` 键并用 `pointForEvent`（`:62-71`）锚到聚焦节点 | 补齐 | **中高**。当前方向键导航事实上不可用、键盘用户打不开菜单，属于 WCAG 2.1.1 | **S**。逻辑照抄 `ContextMenu.tsx:62-71, 225-234, 263-273` 三段 | 无 | `components/ContextMenu.tsx:110-123, 225-234, 263-273, 339-341` |
| 6 | **composer 大文本粘贴阈值**：超阈值（如 8000 字）转成 `.txt` 附件 chip 而非塞进 textarea | 移植交互 | **中**。W5；同时缓解 `lib/markdown.ts` 之外的高亮层全量重算 | **M**。需要 `lib/image-attachments` 式的落盘路径（我们已有 `attachFiles`，`ChatInput.tsx:2685-2691`） | 无 | `components/ChatInput.tsx:2681-2737`；复用现有附件落盘路由 |
| 7 | **搜索命中 1500ms 对齐窗口**：在 `ChatWindow` 的 find 逻辑里加 `alignUntil = now + 1500`，窗口内 `ResizeObserver` 把命中 range 拉回 `min(160, clientHeight/3)`；wheel/pointerdown/方向键立即终止。我们已有"把命中 range 居中"的一次性定位（`ChatWindow.tsx:1653-1660`），只缺"持续跟随窗口" | 移植交互 | **中**。流式回答里"点下一个才看得到"的直接解法 | **M**。要接到 `ConversationFindBar` 的计数逻辑与现有 `scrollToMessage` 之上 | 无 | `components/ChatWindow.tsx:1653-1680`；`lib/conversation-find.ts` |
| 8 | **`window.confirm` 换成应用内两段式确认**：新建 `hooks/useArmedDelete.ts`（照搬 14 行，`ARMED_DELETE_MS = 3200`），先改 `FileExplorer.tsx:1141` / `ChatWindow.tsx:2205` 两处高危（删文件、rewind 历史） | 移植交互 | **中**。原生模态在 PWA/Electron 下与视觉割裂、文案不可控 | **S**（hook）+ **M**（四处接入）。`SessionSidebar`/`DirectoryPicker` 已有行内两段式可参考 | 无 | 新增 `hooks/useArmedDelete.ts`；`components/FileExplorer.tsx:1139-1141`；`components/ChatWindow.tsx:2205` |
| 9 | **通知条按类型切 `role`**：`NoticeShelf` 容器按 `notice.type` 决定 `role="alert"`（error/warning）还是 `role="status"` | 补齐 | **中**。一行级改动，错误对读屏用户立刻可感知 | **S** | 无 | `components/ChatWindow.tsx:2702-2708` |
| 10 | **平滑流式开关**：`MessageView`/`MarkdownBody` 的 `useThrottledText` 之上加一个 `smoothStreaming` 偏好（默认开），并在 `prefers-reduced-motion: reduce` 时自动关 | 补齐 | **中**。他们有 `settings.smoothStreaming` + `AssistantTurnParts.tsx:17-20` 的完整判据；算法可先不动 | **S**。落点必须遵守约束 1：偏好写 `settings.json` 侧或 localStorage，**不建表** | 无 | `components/MarkdownBody.tsx:299`；`hooks/useThrottledText.ts` |
| 11 | **队列重排补键盘等价**：`ChatInput.tsx:3107-3135` 的 `beginQueueDrag`/`onDropOn` 旁加 `onKeyDown`（`ArrowUp/ArrowDown` 调 `onQueueMove`）+ `suppressedClickPointerIds` 抑制拖后误点 | 补齐 | **中**。抄 `use-list-reorder.ts:81-92`（12 行）；W10 一并解决 | **S** | 无 | `components/ChatInput.tsx:655-670, 3107-3135` |
| 12 | **composer 换行上限改成"行高 × N"**：`ChatInput.tsx` 的 `maxHeight: 200` 换成按 computed line-height 算（对齐 `COMPOSER_MAX_VISIBLE_ROWS = 7`），避免改字号/密度后行数漂移 | 补齐 | **低-中** | **S** | 无 | `components/ChatInput.tsx`（自动增高 effect `:2669-2678` 附近） |
| 13 | **会话宽度手柄**：双侧拖拽 + 双击复位 + 键盘步进 + 持久化偏好 | 新增功能 | **中**（宽屏用户诉求真实），但**必须先解决持久化落点**：我们没有 settings 里的这个键 | **L**。hook + 两侧手柄 DOM + 持久化字段（走 `settings.json` 或 localStorage，**不建表**）+ 三个 CSS 变量联动 | 需先确认偏好存储落点 | 新增 `components/ConversationWidthHandles.tsx`；`components/ChatWindow.tsx` |
| 14 | **转录右键菜单**（复制 / 选中文本 / 编辑 / 版本前后 / 删除 / 文件引用"在文件夹中显示"） | 新增功能 | **中**。我们转录层目前零右键入口 | **M**。菜单项词表可照 `features/chat/transcript/menu-items.tsx` 抽成纯函数（可单测），但 `onEditContent` / `onRewind` 的接线要碰 `ChatWindow` | 依赖 5（菜单要键盘可达才有意义） | 新增 `lib/transcript-menu-items.ts`；`components/MessageView.tsx`；`components/ContextMenu.tsx` |
| 15 | **快捷键表补齐**：`Mod+K` 搜索、`Mod+[`/`Mod+]` 前进后退、`Mod+Shift+P` 命令面板、缩放三件；并加 `migrateKeybindingOverrides` 式的退休 id 折叠 | 补齐 | **中**。内核已够好，缺的是条目与迁移 | **M**（命令面板是新功能，另计）。注意 `lib/shortcuts.ts:78` 的 `findInConversation` 是 `managed: false` 待收口项 | 无 | `lib/shortcuts.ts:70-78`；`hooks/useKeyboardShortcuts.ts:80-121` |
| 16 | **复制公式 TeX**（`copy` 事件监听） | 移植交互 | **低**。我们复制走 markdown 源，对模型友好；只是与"所见"不一致 | **S** | 无 | 新增 `hooks/useCopyTex.ts`；`components/AppShell.tsx` 挂载 |
| 17 | **补浏览器级 e2e 网**：`e2e/run.mjs` 下加 `composer-ime` / `composer-paste` / `transcript-scroll` 三个脚本 | 补齐 | **中**。W1–W10 里有一半是"我们没有回归网才没发现" | **M**。我们已有 `e2e/run.mjs` 基建和 `FileViewer` 的契约测试范式可抄；`components/ChatInput.test.mjs:58-66` 的 VM 抽取法可作为 fixture 写法起点 | 建议在 1、2 落地后立刻补 | 新增 `e2e/composer-ime.mjs`、`e2e/composer-paste.mjs`、`e2e/transcript-scroll.mjs` |
| 18 | ~~会话重排~~ | **不建议** | — | — | 会话顺序不是可写字段（我们 `.jsonl` 按时间排），拖拽无处落盘 | — |
| 19 | ~~复制走 TeX 源码 / 覆盖我们现有的 9 个复制点反馈~~ | **不建议** | — | — | `fd4701e` 刚统一，交互上我们（三态 + `CopyFailedNotice`）不比他们差 | — |
| 20 | ~~`useDialogA11y` 换成他们的手写 dialog 焦点管理~~ | **不建议** | — | — | 我们的实现多了 `inert` 兄弟屏蔽与"不抢用户已移走的焦点" | — |
