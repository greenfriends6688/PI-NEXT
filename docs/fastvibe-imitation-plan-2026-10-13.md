# FastVibe 对齐改造计划（PI NEXT × FastVibe）

日期：2026-10-13（第 3 版：技术栈换血 + 逐页迁移）
参考项目：`/Users/yingjing/Downloads/fastvibe-main`（FastVibe 0.19.3，Electron 44 + React 19 + pi SDK 1.1.0）
目标仓库：本仓库 @ `adbe4537`（0.10.0-beta.3，Next.js 16 + React 19 + pi SDK 1.1.0）
审计方式：对 FastVibe 做 7 路并行深读（聊天 UI / 壳与布局 / 设置 / 设计系统 / 引擎功能 / 远程移动 / 数据流），对 PI NEXT 做 2 路现状盘点（UI 面 / 功能面），第 3 版追加两边**技术栈差异**清点。本文件是唯一的执行台账，后续每个 PR 按 §4 的六件套交付。

---

## 0. 一页结论

用户裁定（2026-10-13，第 3 次）：

> 「所有页面布局、设计啥的也请你帮我按照 fastvibe-main 这个帮我调整，不需要搞 V6 啥的了，全部抄他的，设置可以参考他的，但是设备我想保留弹窗的形式。每一页都抄他的。」

四条决策：

1. **连技术栈一起抄**（Tailwind v4 + shadcn/Base UI + Hugeicons + 他的主题体系），不是只抄形态。
2. **设置继续用弹窗**——这一点与 FastVibe 一致（它本来就是 `SettingsDialog`，不是独立页）。
3. **V5/V6 画板体系与门禁整套拆掉**，验收完全换成「与 FastVibe 对照」。
4. **迁移策略**：先立样板 → 再批量；**图标换 Hugeicons**；**旧 CSS 先共存、最后统一清**（不边迁边删）。

先说清楚两个项目不是一个东西，然后按「能搬什么」组织：

| 维度 | FastVibe | PI NEXT | 差异性质 |
| --- | --- | --- | --- |
| 交付形态 | Electron 桌面应用 + Flutter 手机端 | 本地 Web 工作台（浏览器 + Electron 壳 + PWA） | 形态不同，样式规范可搬 |
| 引擎 | pi SDK 嵌入主进程 | pi SDK 嵌在 Next server 进程 | 已对齐（都是 1.1.0） |
| UI 技术 | Tailwind v4 + shadcn Nova（Base UI）+ Hugeicons + 24 主题 | **已有 Tailwind v4.2 基础** + 自研 `d-*`/`m-*` + lucide | **本次换血目标** |
| 强项 | 桌面壳打磨、DAG、决策、记忆、电脑操控、SSH、主题 | 多渠道推送、生图、联网搜索、定时任务、PWA、MCP 深度 | 互相补 |

**本次改造 = 把 FastVibe 的技术栈与视觉规范整体搬进 PI NEXT，再在此基座上逐页重建。**

改造分 **9 个批次**。计入实际工作量的 PR 共 **57 个核心 + 3 个大件（F，需单独裁定）+ 2 个可选**（B11 / G9）。其中 **A1–A3 已被 H4 / L3 吸收**（本计划仍保留其条目作为规格对照，不再单独施工）。

- **M0「换基座」**：H1–H6（依赖+组件层 / 35 个 shadcn / Hugeicons / 24 主题 / 杂项 / 门禁重建）—— 之后所有页面都建在它上面。
- **M1「样板」**：L1–L3（设置弹窗 / 聊天转录 / 壳与侧栏）—— 验证整套技术栈在 Next.js 里跑得通。
- **M2「铺开」**：L4–L9 + B/C/D 的行为条目 + G 的移动端条目 → 全部页面对齐 + 手机端可用。
- **M3「能力补齐」**：E1–E7 → DAG / Goal / checkpoint / 决策引擎。
- **M4「大件」（需单独裁定）**：F1 SSH、F2 电脑操控、F3 记忆形态。
- **M5「清场」**：L10（旧 CSS / 画板 / 门禁统一删除）—— **只在 L1–L9 全部完成后执行**。

**明确不做清单**（理由见 §6）：原生窗口 chrome/vibrancy、官方 WebRTC 连接与云端中继、Flutter App、Vite/electron-vite、`@fontsource-variable/geist`（保持 next/font）、`@tanstack/react-virtual` 与 `@dnd-kit` 替换自研、pi-tui 桥、彩色 Material 文件图标（待单独裁定）。

---

## 1. FastVibe 为什么"合理"——提炼出的十条形态原则

这十条是后面所有 PR 的判据，改任何一处先对照它们（它们是 FastVibe 设计系统里反复出现、且有注释/文档背书的东西）：

1. **浮岛**：桌面端侧栏 / 右栏 / 设置 / 对话列全部是**内缩 8px 的圆角面板**（透明 border 实现 inset，24px 外圆角 = 8px 内缩 + 16px 内圆角），浮在同一个背景层上（`fastvibe-main/src/renderer/src/index.css:181-215`）。
2. **材质只挂"面"**：玻璃（vibrancy/blur）只给外壳面，卡片与转录近实底；**浮层不挂 backdrop-filter**（避免成为 fixed 后代包含块），走 `.overlay-surface` 半透明 + 高光 rim（`index.css:219-340`）。
3. **一列正文**：对话永远是居中的一列（`max-w-3xl px-6`，V6 到 920px），转录、输入框、工具卡、todo 共用这条列宽；输入卡恒比列宽 +32。
4. **三色文本**：正文/次要/禁用三种颜色，选中行给 3px 强调条；行高固定（28px，触屏 40px），hover 才出现的动作按钮在触屏上常显（`pointer-coarse:`）。
5. **过程可折叠**：一次回复 = 思考 / 工具 / 文本的块序列；settled 之后思考与工具**自动折叠成一行摘要**，只留答案；开头或最后的答案、模型分隔线、DAG 卡留在折叠外。
6. **工具是一行**：工具调用默认是一行（图标 + 名称 + 对象 + 概要），相邻同类工具合并成一行摘要（"3 个搜索，2 个列表，5 个文件"），展开状态记忆在模块级 Map。
7. **问询不弹窗**：权限 confirm/select/input/questions 占**composer 槽位**，按会话排队；只有 editor 才用模态，并且禁用点击遮罩关闭（防丢草稿）。
8. **队列是一等公民**：排队的 prompt 有托盘（拖拽排序 / 编辑 / 立即发送 / 召回）；"立即发送"有完整的乐观 UI 与撤回路径。
9. **设置行有纪律**：label 占 12rem 起，控件的描述只写"做什么"，中英文各自有 130/150 字上限并被测试锁死（`test/settings-copy.test.ts`）。
10. **动效克制**：面板开合 280ms spring，浮层淡入 110ms / 淡出 90ms，光标 `steps(1)` 闪烁 —— 全部登记在 `prefers-reduced-motion` 下关闭。

---

## 1.5 技术栈换血（第 3 版新增，批次 H 的规格依据）

用户裁定「连技术栈一起抄」。先把两边差什么列清楚 —— **本仓已经有半套，不是从零建**：

| 层 | FastVibe | PI NEXT 现状 | 行动 |
| --- | --- | --- | --- |
| 原子 CSS | Tailwind v4.1.13（`@tailwindcss/vite`） | **Tailwind v4.2.2 已装且已接**（`@import "tailwindcss"`、`@tailwindcss/postcss`） | ✅ 保留，扩大使用面 |
| 动效工具类 | `tw-animate-css` | **已装已接** | ✅ 保留 |
| 状态变体 | `data-open:` / `data-closed:` 自定义变体 | **已定义**（`app/globals.css:13+` 的 `@custom-variant`） | ✅ 保留 |
| 字体 | `@fontsource-variable/geist` + `--font-sans` | `next/font/google` 的 Geist + Geist Mono | ⚠️ 保持 next/font（Next 更优，不为一致而降级） |
| 组件层 | **35 个 shadcn/base-ui 组件**（`components/ui/`） | 无（全是自研） | ❌ **H2 新建** |
| 无头原语 | `@base-ui/react` ^1.8.0（Dialog/Popover/Menu/Select/Switch/Tabs/Tooltip…） | 无 | ❌ **H2 引入** |
| 变体工具 | `class-variance-authority` + `clsx` + `tailwind-merge` + `cn` | 无 | ❌ **H1 引入** |
| 图标 | `@hugeicons/react` + `@hugeicons/core-free-icons`（84 个不同图标，去重后口径） | lucide（155 个名字 / 940 处 `data-ico`） | ❌ **H3 换** |
| 主题 | `themes.ts` 的 `SEEDS`：**12 亮 + 12 暗 = 24 套**（`github-*/one-*/dracula/nord/monokai/tokyo-night/catppuccin-*/night-owl[-light]/gruvbox-*/rose-pine[-dawn]/ayu-light/quiet-light/solarized-light/everforest-light/codex-*/claude-*`），每套 **19 个 seed 字段**，`buildTokens()` 展开为 **44 个 CSS token**（+ 玻璃开启时 `glassTokens()` 另出 13 个） | `--ds-*` 手写两套 + `theme-skins` 四基色派生 | ❌ **H4 换** |
| 令牌名 | `--background/--foreground/--card/--popover/--primary/--muted/--accent/--destructive/--sidebar/--ring/--chart-1..5` + oklch | `--bg/--text/--accent/--border/…` + `--ds-*` | ❌ **H4 换**（桥接期两套共存） |
| 半径 | 单一 `--radius: 0.625rem` → `@theme` 派生 `--radius-sm/md/lg/xl/2xl/3xl/4xl`（calc） | `--radius-base` → 手工映射八档 | 🟡 形式已在，换基准值即可 |
| 图表 | `recharts`（`chart.tsx`） | 自绘 SVG | ❌ **H5 引入**（使用统计用） |
| 弹层 | `sonner`（toast） | 自研 `.pw-toast` / `.d-toast` | ❌ **H2 换** |
| 虚拟列表 | `@tanstack/react-virtual` | 自研行高测量窗口化 | ⚠️ **可选**：自研的已调好，不强制换 |
| 拖拽 | `@dnd-kit/*` | 自研 | ⚠️ **可选**：同上 |

**不抄的**：Vite（本仓是 Next.js）；`electron-vite`（已有自己的打包链）；`material-icon-theme`（与图标契约；H3 单独裁定）。

---

## 2. 差距总表（逐功能清点）

判定图例：✅ 已对齐 ｜ 🟡 部分/形态不同 ｜ ❌ 缺 ｜ ⛔ 不搬（附理由）

### 2.1 聊天/转录

| # | 能力 | FastVibe（参考） | PI NEXT 现状 | 判定 | PR |
| --- | --- | --- | --- | --- | --- |
| 1 | 转录列宽与居中 | `max-w-3xl px-6` 单一列宽 | `.d-chat-inner` 自有列宽 | 🟡 | B1 |
| 2 | 轮（turn）分组与虚拟化 | 按 turn 虚拟化、tail-first 首帧、对象身份复用（`message-list.tsx:120-128,421-470`） | **分页窗口非虚拟化**（`ChatWindow.tsx:1837` 注释） | ❌ | B2 |
| 3 | 粘顶用户提示 | `sticky top-0` + scrim / 玻璃下 mask 切割（`message-list.tsx:340-386`） | 未查到 | ❌ | B1 |
| 4 | 贴底跟随 / 回底按钮 / 无操作滚轮守卫 | `MessageScrollerButton` + `useNoOpWheelGuard` | 部分 | 🟡 | B1 |
| 5 | 轮次导航 | 左侧 TurnRail（dock 刻度 + 预览 + 跳转，`turn-rail.tsx`） | 右侧 ChatMinimap | 🟡 形态不同 | B10 |
| 6 | 消息动作 | hover：时间戳 / 复制 / 编辑 / 重试 / fork；内联编辑编辑器（CJK Cmd+Enter） | `MessageView` 有动作行，细节未对齐 | 🟡 | B3 |
| 7 | 工具行 | 单行 zcode 风格 + family 分组 + 摘要统计 + inline 预览 + 展开记忆 + DiffStat（`tool-row/tool-group/tool-card`） | 工具卡（头 + 参数/结果双折叠）+ ProcessGroup | 🟡 | B4 |
| 8 | 运行折叠 | settled 自动折叠过程保留答案（`run-collapse.tsx`） | ProcessGroup 有 reveal 机制 | 🟡 | B5 |
| 9 | 思考块 | "思考 · N 秒" + 流式最后一行 ticker | ThinkingBlock 有打字机 | 🟡 | B5 |
| 10 | 模型切换分隔线 / 压缩卡 / 停止卡 | 三种独立 notice | 压缩有 `CompactionMessageView` | 🟡 | B5 |
| 11 | 每轮文件 chips | `TurnFileChips`，run 结束后显示 | 未查到 | ❌ | B5 |
| 12 | 附件（任意文件） | `AttachmentChip`（缩略图 + 名称 + 移除） | 图片附件；任意文件待查 | 🟡 | B6 |
| 13 | slash 菜单 | 8 项上限 + 键控 + instant 命令 | 有（builtin/extension/prompt/skill） | ✅ | — |
| 14 | @ 文件提及 | 无 | 有（PI NEXT 更强） | ✅ | — |
| 15 | 上下文环 | 环 + popover 统计（速度 / 模型耗时 / 工具耗时 / 步数 / tokens / cacheHit / 成本） | 环 + 压缩入口，统计面板待查 | 🟡 | B6 |
| 16 | 消息队列托盘 | 拖拽排序 / 编辑 / 移除 / 立即发送 / 召回 / pause（`message-queue.tsx`） | `queue-surgery.ts` 有数据层，UI 未对齐 | 🟡 | B7 |
| 17 | 权限 / 问题面板 | composer 槽位 + 按会话队列 + questions 步进器 + 快捷键 | 模态对话框 + `extension-ui-queue` | 🟡 | B8 |
| 18 | 新会话首页 | 时间问候 + 建议 chips + 项目/分支 chip | 有（做过一轮重排） | 🟡 | B9 |
| 19 | 计划 / todo | TodoPanel（composer 上方）+ checklist | TodoChip + TodoCard + PlanDocumentCard | ✅+ | — |
| 20 | 子代理转录 tab | 右栏只读 MessageList | 已有子代理 tab | ✅ | — |
| 21 | DAG 编排 | 内联卡 + 任务列表 + 画布 + 节点右栏 | **无** | ❌ | E1–E3 |
| 22 | 错误 / 重试横幅 | RetryStatus | 有 | ✅ | — |
| 23 | 代码高亮 | Shiki + `@shikijs/stream` 流式增量 + 按需 | Prism 按需（v0.12 已移植） | 🟡 可选 | B11 |

### 2.2 壳与导航

| # | 能力 | FastVibe | PI NEXT | 判定 | PR |
| --- | --- | --- | --- | --- | --- |
| 24 | 浮岛面板 | inset 8 / radius 24 / 内部 16 | 全高直边 | ❌ | A1 |
| 25 | 玻璃 | vibrancy + glassTokens + rim + overlay + 粘顶切割 | V6 玻璃壳面已落（`globals.css:2818`），rim/overlay/切割缺 | 🟡 | A2 |
| 26 | 主题体系 | 24 主题，亮暗独立选择，ThemeSeed 推导 | 亮/暗/自动 3 档 | ❌ | A3 |
| 27 | 字阶纪律 | Tailwind text-* + root font size 全局缩放 | 五档字阶 + 界面字号 | 🟡 | A4 |
| 28 | 侧栏行规格 | 28px 行、三色、3px 选中条、hover 动作、子代理展开箭头、内联改名 | 有（d-sess 行） | 🟡 | C1 |
| 29 | 侧栏拖拽排序 | 同段 dnd + 插入线 + 持久化 | 待查 | 🟡 | C2 |
| 30 | 置顶段 / 折叠 / 显示更多 | 有（带窗口丢弃规则） | 有 | ✅ | — |
| 31 | 归档 | 设置 → 归档页 | 设置 → 归档页 | ✅ | — |
| 32 | 右栏 tab 系统 | quiet tab / 每会话 scope / 关闭其他 / 关闭全部 / + 菜单 / 资源释放 | 有 tab（terminal/browser/trace/git-graph/session）+「+」菜单 | 🟡 | C3 |
| 33 | 文件面板 | 懒加载树 + 预览分栏 + 展开记忆（右栏） | 侧栏 FileExplorer + 文件 tab | 🟡 形态不同 | C4 |
| 34 | 浏览器面板 | 设备视口 / 缩放 / 查找 / 元素拾取 | 有基础浏览器面板 | 🟡 | C5 |
| 35 | 命令面板 | 会话 + 动作 + 设置 + 最近 mod+1..9 | 有 | 🟡 | C6 |
| 36 | 状态 pill / 账号 / 更新按钮 | 有（账号体系） | 无账号体系（不搬）；更新有 | 🟡 | C6 |
| 37 | 自定义标题栏 / 窗口控制 | Windows/Linux 手绘按钮 | ⛔ Electron 专属 | ⛔ | — |

### 2.3 设置

| # | 能力 | FastVibe | PI NEXT | 判定 | PR |
| --- | --- | --- | --- | --- | --- |
| 38 | master/detail 窄屏 | 有 | 有 hub | ✅ | — |
| 39 | 设置行规范 | basis-48 换行 + 描述上限被测试锁死 | V5 设置行 | 🟡 | D1 |
| 40 | 供应商管理 | 详情页 / 模型拖拽排序 / ModelDetail（协议/context/价格/思考档/模态）/ 配额 / 网关余额 / cc-switch 导入 | ModelsConfig（能力模态已有），无拖拽排序 / 无详情弹窗 / 无 cc-switch | 🟡 | D2 |
| 41 | 快捷键编辑器 | 可录制 + 冲突处理 + 恢复默认 | 只有指南对话框 | ❌ | D3 |
| 42 | 个性化 | 自定义系统提示词 | 有精确系统提示词查看，无编辑 | ❌ | D4 |
| 43 | AI 偏好语言 | 每轮注入语言要求 | 无 | ❌ | D4 |
| 44 | 通知开关 | 完成/出错/审批/更新 四开关 | Web Push 配置在手机分节 | 🟡 | D5 |
| 45 | 保持唤醒 | keep-awake | 无 | ❌ | D5 |
| 46 | 网络代理 | system/custom + 会话与 Node 双路 | 无 | ❌ | D5 |
| 47 | 插件市场 | 浏览 / 搜索 / 排序 / 安装（pi.dev/packages） | 无 | ❌ | D6 |
| 48 | 使用统计 | 热力图 + 趋势折线 + 模型占比环 | UsageStatsPanel（深度待查） | 🟡 | D6 |
| 49 | 导入 | 5 来源（pi/claude/codex/opencode/zcode）+ 报告 | 4 来源（缺 zcode）+ 报告 | 🟡 | E7 |
| 50 | 主题 / 字号 / 语言 | 亮暗独立 + 12–20px + 中英 | 亮暗自动 + 字号 + 多语言 | 🟡 | A3/A4 |
| 51 | Skills / 子代理 / MCP / 归档 / 关于 | 有 | 有 | ✅ | — |
| 52 | 记忆 | 第一方蒸馏（MEMORY.md + 摘要 + 引用） | pi-hermes-memory 开关页 | 🟡 形态不同 | F3 |

### 2.4 能力与引擎

| # | 能力 | FastVibe | PI NEXT | 判定 | PR |
| --- | --- | --- | --- | --- | --- |
| 53 | DAG 子代理编排 | 9 个 dag_* 工具 + 调度器（全局 5 / 每图 5 / 每 provider 3）+ 写路径隔离 + dag.json + 画布 | 无 | ❌ | E1–E3 |
| 54 | Goal mode | `/goal` + 轮次 + 暂停/恢复 + GOAL_COMPLETE | 无 | ❌ | E4 |
| 55 | checkpoint 文件回退 | 重试时可恢复文件改动（含 git HEAD）+ 弹窗 | 会话 rewind，无文件恢复 | 🟡 | E5 |
| 56 | 决策引擎 Jev | 三场景（browser / computer / batch_decide） | 无 | ❌ | E6 |
| 57 | browser use | webview / CDP 两种后端 | 有浏览器 10 工具 | ✅ | — |
| 58 | computer use | CUA driver（macOS 授权 + Rust worker） | 无 | ❌ | F2 |
| 59 | 会话搜索 | 命令面板正文命中 + 高亮 | `sessions/search` + 面板 | 🟡 | E7 |
| 60 | 使用统计 ledger | 双源 union + 价格重算 | `usage-stats` | 🟡 | D6 |
| 61 | 配额 | OpenAI / Kimi / 网关余额 | `provider-usage` | 🟡 | D2 |
| 62 | models.dev 元数据 | 小时刷新 | 有 catalog | ✅ | — |
| 63 | commit message 生成 | 有（预算分配 + 分组） | 无 | ❌ | E5b |
| 64 | 消息队列持久化 | durable queue.json + 对账 | SDK 队列 + queue-surgery | 🟡 | B7 |
| 65 | 上下文用量 | SDK 推导 + turn_end 刷新 | 有环 | ✅ | — |
| 66 | 系统通知 | 判定层 + 投递层（原生） | Web Push + 原生通知 | 🟡 | D5 |
| 67 | SSH 远程主机 | 主机管理 + 一键部署 agent + 手机连接 | 无 | ❌ | F1 |
| 68 | 自动化 / 生图 / 联网搜索 / AI 身份 | FastVibe 没有 | PI NEXT 有（更强） | ✅+ | — |
| 69 | IM / Bot 入站 | FastVibe 没有 | PI NEXT 有（3 家真跑通） | ✅+ | — |

### 2.5 设计系统

| # | 能力 | FastVibe | PI NEXT | 判定 | PR |
| --- | --- | --- | --- | --- | --- |
| 70 | 浮岛 | `panel-frame` 透明 border 方案 | 无 | ❌ | L3 |
| 71 | 玻璃 tokens | `glassTokens(seed)` 全量推导 + rim 渐变 + overlay | V6 有壳面 blur，无 rim/overlay | 🟡 | H4 |
| 72 | 主题种子 | ThemeSeed → 30+ token 推导（24 套） | 无（手写两套） | ❌ | H4 |
| 72b | **原子 CSS** | Tailwind v4.1（全量使用） | Tailwind v4.2 **已装**，但仅零星使用（约 20 处） | 🟡 | H1/H2 |
| 72c | **组件层** | 35 个 shadcn + Base UI 原语 | 无（全自研） | ❌ | H2 |
| 72d | **图标** | Hugeicons（131 个不同图标，JSX 直用） | lucide（155 名 / 940 处 `data-ico` 间接层） | ❌ | H3 |
| 72e | **令牌命名** | `--background/--foreground/--card/--primary/--muted/--sidebar/…` | `--bg/--text/--accent/--ds-*` | ❌ | H4 |
| 72f | Toast | `sonner` | 自研 `.pw-toast` / `.d-toast` | ❌ | H5 |
| 72g | 图表 | `recharts` | 自绘 SVG | ❌ | H5 |
| 73 | 文件图标 | Material Icon Theme（彩色，SVG 协议） | lucide 单色（`FileIcons.tsx`，已登记偏离） | ⚠️ 待裁定 | 备注 |
| 74 | 供应商图标 | LobeHub Mono，14px + viewBox inset 28 | `ProviderIcon.tsx` | 🟡 | L9 |
| 75 | diff 渲染 | 单一 DiffView + 行号解析（@@ / pi 内嵌列） | SplitPatchView / PatchTextView | 🟡 | L2b |
| 76 | KaTeX 严格行内 | Pandoc tex_math_dollars 规则 | remark-math（严格规则待查） | 🟡 | L2b |
| 77 | 滚动条 | 12px，thumb 3px 透明边框 | 有 | ✅ | — |
| 78 | 动效令牌 | spring 280 / fade 110/90 / caret steps | 有 motion tokens | 🟡 | H4 |

### 2.6 移动端 / PWA

| # | 能力 | FastVibe 移动端（Flutter） | PI NEXT PWA 现状 | 判定 | PR |
| --- | --- | --- | --- | --- | --- |
| 79 | 玻璃 chrome / 内容不透明 | GlassScreen + progressive blur 顶栏 + 壁纸渐变 scrim，正文永不透明（`glass_screen.dart`） | m-* 设计系统 + V6 材质（手机端表达待收口） | 🟡 | G1 |
| 80 | 多机设备列表 | 设备列表（收藏/分组/搜索）+ 扫码/附近/手输三种添加 + 账号设备 | 单服务器同源 PWA，无设备概念 | ⛔ 形态不同 | — |
| 81 | 会话列表页 | 分组「等你处理 / 运行中 / 最近」+ 状态 mark 卡片 + dock 分段 + 项目过滤胶囊 | 侧栏抽屉 + 任务段 | 🟡 | G2 |
| 82 | 会话页形态 | 反转列表 + WorkingPill 计时 + 回到最新 + 空态建议卡 + footer 自报高度 | 有（细节未对齐） | 🟡 | G3 |
| 83 | Composer | 四态按钮 + 上下文环 + 模型/思考 sheet + 图片压缩管线 + Enter 换行 | 有 cap sheet 等（未对齐） | 🟡 | G4 |
| 84 | 队列与提问卡 | 队列面板（暂停/状态标签）+ 提问卡占 composer 位 + 多题必答 | 队列数据层已有；提问走扩展弹窗 | 🟡 | G5 |
| 85 | 手机设置页 | 手机专属分组 + 主题实时预览 + 减少玻璃 + 触感 + 关于/更新 | hub 16 节全量 | 🟡 | G6 |
| 86 | 通知策略 | 三类触发 + 去重 + payload 深链 + 前台不打扰 | Web Push + 壳通知 + 在场裁决 | 🟡 | G7 |
| 87 | PWA 落地收口 | — | `design:v5:land` M-03 95% / M-05 98% / M-09 98% 未满；safe-top 遗留 1 处 | 🟡 | G8 |
| 88 | DAG 移动呈现 | 44pt 摘要条 + 任务图 sheet | 无（依赖 E1–E3） | ❌ | G9（可选） |
| 89 | 手势 / 终端键盘条 / 配对 | 下拉刷新 + 侧滑返回；无终端 | `m-pull` / `m-swipe` / Termux 键盘条 / 6 位配对码已做 | ✅+ | — |
| 90 | 原生专属（Keychain / mDNS / APK 自更新 / shader 玻璃） | 有 | 浏览器无等价物 | ⛔ | — |
| 91 | 连接状态机 | 断线保列表 + 状态点四态 + 指数退避抖动 + 前台立即探活 | 固定 1s 重连；除 `navigator.onLine` 横幅外无连接状态 UI | ❌ | G10 |
| 92 | 草稿持久化 | 按会话存、350ms debounce | `lib/draft-store.ts` 纯内存 Map，刷新即丢 | ❌ | G11 |
| 93 | 会话内搜索 | 进聊天后「搜索此对话」 | `ConversationFindBar` 完整但入口只有 ⌘F，手机不可达 | 🟡 | G12 |
| 94 | 手机转写输出纪律 | 参数/输出/diff 不进手机转写；只有 todo / dag 可展开 | 可展开看输出（M-02 板口径） | ⚠️ 需裁定 | G12 |
| 95 | 附件压缩管线 | 长边 2048 / q78 / 最多 4 张 / base64 上限 5.5MB | 长边 1024 / q85 / 最多 10 张 / 上限 10MB | ⚠️ 需裁定 | G4 |

---

## 3. PR 清单

> 约定：每个 PR = 一个可独立交付、可独立验证的改动单元（可以是一条或多条 commit）。量级 S（≤半天）/ M（1–2 天）/ L（3–5 天）/ XL（>1 周）。「参考」列出 FastVibe 源文件作为规格依据；PI NEXT 侧文件以执行时实际为准。
>
> **批次顺序（第 3 版）**：**H 先行** —— 它是所有页面的基座，H1–H3 不完成则 L 批次无法开工。H4（主题）与 L1（首样板）可并行。**A–D 批次里与本仓自有设计系统耦合的部分（画板、`d-*` 类名、字阶）已被 H/L 吸收**，剩下的条目按其内容性质保留：纯行为逻辑（如 B2 虚拟化、B7 队列语义）照旧执行，纯视觉规格（如 A1 浮岛、A2 玻璃）改为在 H/L 里用 FastVibe 原实现。

### 批次 H · 技术栈换血（P0，**最先做**）

> H 批次是「换地基」：本仓已有 Tailwind v4 + tw-animate-css + `data-open` 变体 + `--radius-base` 派生，所以**不是从零引**。H 的目标是把 FastVibe 那 35 个 shadcn 组件、Base UI 原语、Hugeicons、24 主题搬进来，使 L 批次能直接 `import { Button } from "@/components/ui/button"`。

#### H1 — 依赖与工具链（cva / clsx / tailwind-merge / cn）
- **目标**：装上 `class-variance-authority` / `clsx` / `tailwind-merge`，建 `lib/utils.ts` 的 `cn()`（FastVibe 用的是 `cn` 包，本仓用标准三件套等价实现即可 —— 那个包只是三件套的封装）。同时装 `@base-ui/react`、`sonner`、`recharts`、`@dnd-kit/*`、`lucide-react`（保留过渡期）。
- **为何拆出来**：后续每个组件的 `className={cn(...)}` 都依赖它；先装完再动组件，避免边装边改。
- **参考**：`fastvibe-main/package.json:64-95`；`components/ui/button.tsx:1-5` 的 `cn` 用法。
- **PI NEXT**：`package.json`、新 `lib/utils.ts`、`app/globals.css`（`@import "shadcn/tailwind.css"` 的等价物 —— 本仓已有 `@import "tailwindcss"`，只需补 `@theme inline` 桥）。
- **验收**：`cn()` 单测（合并 + 冲突覆盖）；`tsc --noEmit` 过；一个临时组件能同时吃 Tailwind 类与旧 `d-*` 类。
- **量级**：S。依赖：无。

#### H2 — shadcn 组件层（35 个）
- **目标**：把 `fastvibe-main/src/renderer/src/components/ui/` 的 35 个组件搬进 `components/ui/`，改 import 路径（`@/components/ui/*` → 本仓别名）。这些组件用 Base UI 原语 + cva + tailwind 类，**不依赖 FastVibe 的 store / IPC**，可原样搬。
- **清单**：`alert-dialog / alert / badge / bubble / button / card / chart / checkbox / collapsible / command / context-menu / dialog / dropdown-menu / empty / input-group / input / item / kbd / label / message-scroller / message / popover / progress / qr-code / resizable / scroll-area / select / separator / sheet / sonner / spinner / switch / tabs / textarea / tooltip`。
- **冲突处理**：本仓已有同名自研组件（`Button` 类不存在但 `.d-btn` / `.pw-btn` 存在）—— 新组件放 `components/ui/`，**旧组件不动**，逐页迁移时再换。这是「先共存」裁定的落点。
- **参考**：整个 `fastvibe-main/src/renderer/src/components/ui/`。
- **PI NEXT**：新 `components/ui/*.tsx`（35 个文件）、`components.json`（shadcn CLI 配置）、`lib/utils.ts`。
- **验收**：每个组件能在 Next.js 里渲染（无 `window is not defined`）；`command` / `dialog` / `popover` / `select` 四个重点手测；`tsc --noEmit` 过。
- **量级**：L。依赖：H1。

#### H3 — 图标：lucide → Hugeicons
- **目标**：装 `@hugeicons/react` + `@hugeicons/core-free-icons`；建**图标映射表**（本仓 155 个图标名 → Hugeicons 组件名；FastVibe 实际用了 **84 个**不同图标，所以映射表要覆盖本仓用得比它多的那部分）；改 `components/PwIcons.tsx` 的 hydrator 或直接改组件写法。
- **风险（这是本批次最大的一个）**：本仓图标是**「`<i data-ico="name">` + 运行时 hydrator」**模式（940 处），而 FastVibe 是**直接 JSX 组件**。两条路：① 保留 `data-ico` 间接层，把 `icons.js` 的路径数据换成 Hugeicons 的 —— 改动最小（940 处不动），但拿不到 FastVibe 的 `className="size-4"` 尺寸体系；② 逐处改写成 `<HugeiconsIcon>` —— 最接近原样，但 940 处都要动，且会与现有 CSS 的 `i[data-ico]` 选择器冲突。**建议 ② 分批做**（与 L 批次逐页一起），H3 只做：装包 + 映射表 + 改 hydrator 支持两套并存 + 先换 3 个样板组件的图标。
- **同时处理**：`scripts/check-icons.mjs` 门禁要改成认 Hugeicons；`FileIcons.tsx` 的彩色文件图标（FastVibe 用 `material-icon-theme`）**待单独裁定** —— 与「图标全 lucide 单色」的历史契约冲突，不在本次自动换。
- **参考**：`fastvibe-main/src/renderer/src/components/chat/composer.tsx:3,179,622,671-702`（用法样本）。
- **PI NEXT**：`components/PwIcons.tsx`、`components/pw-icons-manual.ts`、`design/pi-web-design/assets/icons.js`、`scripts/check-icons.mjs`。
- **验收**：两套图标能共存渲染；映射表覆盖 155/155（缺的列清单并找替代）；`npm run check:icons` 改完后仍能拦住手绘 SVG。
- **量级**：M（H3 本体）+ L（分批换 940 处，跟 L 批次走）。依赖：H1。

#### H4 — 主题体系（24 套 seed → token）
- **目标**：搬 `themes.ts` 的 `SEEDS`（**12 亮 + 12 暗 = 24 套**，实测 `LIGHT_THEME_IDS` / `DARK_THEME_IDS` 各 12 项）+ `applyTheme()` 运行时注入；建立本仓的 `:root` 令牌映射（FastVibe 名 → 本仓名，桥接期双名共存）。
- **每套 seed 含**：`label / source / kind / bg / fg / surface / border / muted / mutedFg / accent / accentFg / destructive / warning / success / sidebar? / sidebarMuted? / codeBg? / syntax{keyword,string,comment,number} / charts?[5]`（**共 19 个字段**，实测 `themes.ts:60-94` 的 `ThemeSeed` 类型 + `:222-240` 的 github-dark 实例）。
- **展开规则（关键，必须照抄）**：`buildTokens()`（`themes.ts:163-219`）把 seed 展开成 **44 个 token** —— 其中几条**不是一一对应**而是有映射表：`card = surface` / `accent = **muted**`（不是 `accent`！）/ `input = border` / `ring = accent` / `info = accent` / `chart-*` 默认取 `[accent, syntax.keyword, syntax.string, syntax.number, mutedFg]`。**这个映射表是主题体系的真正逻辑，不照抄就会得到一套颜色不对的主题。** 玻璃开启时 `glassTokens()`（`:120-162`）另出 13 个（`glass-pane/overlay/rim-strong/rim-weak/sheen/edge/shade` + 半透明的 `background/card/border/…`）。
- **令牌对照（关键）**：FastVibe `--background/--foreground/--card/--popover/--primary/--secondary/--muted/--accent/--destructive/--border/--input/--ring/--sidebar*/--chart-1..5/--code-*/--shiki-*` ↔ 本仓 `--bg/--text/--bg-panel/--text-muted/--accent/--border/--ds-*`。**必须先写一张双名共存表**，否则逐页迁移时会出现「新组件拿到 FastVibe 名、旧组件拿本仓名，两者不同步」。
- **主题选择器**：FastVibe 是「亮暗各自选一个」（`lightTheme` / `darkTheme`），本仓现在是 light/dark/auto 三值。要改成能选 24 套里的具体一套。
- **玻璃**：FastVibe 的 `applyTheme(theme, glass)` 会把玻璃也一并推导，本仓的 V6 毛玻璃块要按它重写（这也是「不需要搞 V6」的落点）。
- **参考**：`src/renderer/src/lib/themes.ts:31-175,219-830`（`ThemeId` / `SEEDS` / `applyTheme`）；`index.css:28-180`（令牌定义 + `@theme inline`）。
- **PI NEXT**：`lib/theme.ts`、`lib/theme-skins.ts`（保留还是废弃待定）、`app/globals.css`（令牌段）、`hooks/useTheme.ts`、`components/ModelsConfig.tsx` 里的主题选择器。
- **验收**：24 套主题各自应用后正文对比度过门禁（`docs/codex-skin/check-contrast.mjs` 要改）；亮暗切换不闪白；`THEME_OPTIONS` 的三值兼容（老用户的 light/dark/auto 要能迁到默认主题）。
- **量级**：L。依赖：H1。

#### H5 — 字体、图表与杂项依赖
- **目标**：① 字体保持 `next/font`（**不**换成 `@fontsource-variable/geist` —— Next 的字体优化更好，这是有意偏离）；② 引入 `recharts` 供使用统计（D6）；③ `sonner` 接管 toast（替换 `.pw-toast` / `.d-toast` 的调用点）；④ 评估 `@tanstack/react-virtual` 与 `@dnd-kit` 是否替换自研（**建议不换**：自研的虚拟化已经处理了行高测量这个本仓特有难题，换掉是倒退）。
- **参考**：`fastvibe-main/package.json`；`components/ui/chart.tsx`、`components/ui/sonner.tsx`。
- **验收**：字体渲染不变；图表能出图；toast 替换后旧调用点全清。
- **量级**：M。依赖：H2。

#### H6 — 门禁与验收体系重建
- **目标**：用户裁定「V5/V6 画板体系与门禁整套拆掉，验收换成 FastVibe 对照」。本 PR 建立**新的验收体系**，暂不删旧的（等 L10 统一清）：① 停用 `design:v5*` / `design:v6*` 命令与 `check:design` 里的画板相关项；② 建立**对照截图流程**（跑 FastVibe dev + 本仓 dev，同尺寸截图，人工或脚本对比）；③ 旧门禁里仍有效的保留：`check-style-literals`（防内联几何）、`check-motion-tokens`、`check-material-boundaries`（防浮层挂 backdrop-filter —— FastVibe 的 §1 原则 2 同样要求）、`check-touch-targets`、`check-platform-breakpoints`；④ `docs/patches/` 补丁台账**保留**（它与设计体系无关，是 fork 维护机制）。
- **参考**：本仓 `package.json` 的 scripts；`design/v5/LANDING.md`（要作废的落地契约）。
- **PI NEXT**：`package.json`、`design/v5/`、`design/v6/`、`docs/patches/README.md`、`AGENTS.md`（「第〇原则：禁止截图模仿」等条款需改写）。
- **验收**：`npm run check:design` 与新门禁全绿；旧画板命令报「已停用」而不是报错。
- **量级**：M。依赖：无（可与 H1 并行）。

### 批次 L · 逐页迁移（P1，H1–H3 完成后开工）

> L 批次是「换血」的施工面：把每个页面从 `d-*`/`m-*` DOM 重写成 FastVibe 的原实现（shadcn 组件 + Tailwind 类 + Hugeicons）。**先立样板（L1–L3）再批量（L4+）**是用户裁定。
>
> **页面清单（桌面）**：一级页面只有 `/`（应用主壳，内含聊天/右栏/侧栏）与 `/pair`（配对）。其余全是**壳内视图**：侧栏 + 聊天 + 右栏六面板 + 设置弹窗 + 各类弹层。手机是同一批组件在 ≤639px 的 `m-*` 分支。所以「每一页」实际是 **十几个视图 × 两种形态**。

#### L1 — 样板一：设置弹窗（最复杂的单页）
- **为什么选它**：① 它本来就是弹窗，与用户「设置保留弹窗」的裁定一致；② FastVibe 的 `SettingsDialog` 是**完整参考实现**（19 分节 / 5 分组 / 左导航 + 右内容 / 窄屏折叠）；③ 它包含 `Select` / `Switch` / `ScrollArea` / `Button` / `Label` 五种基础组件，一次验证 H2 的大半。
- **目标**：按 `settings-dialog.tsx` 重写本仓设置弹窗的**外观层**（保留现有数据与行为 —— 本仓有 16 个分节，FastVibe 有 19 个，分节集合不同但框架一致）；左导航按 5 分组（preferences / workspace / integrations / system / about）重组本仓的 16 节；行用 `SettingsGroup` / `SettingsRow`。
- **参考**：`src/renderer/src/components/settings/settings-dialog.tsx:147-260`（布局）；`settings-sections.tsx`（分组表）；`settings-group.tsx`（行规格）。
- **PI NEXT**：`components/SettingsPanel.tsx`、`components/pwa/settingsHub.ts`、`lib/settings-navigation.ts`。
- **验收**：16 分节全部可达；窄屏抽屉行为与 FastVibe 一致；`SettingsPanel.boardnav.test.mjs` 之类的旧画板测试要相应改写；明暗两套截图对照。
- **量级**：L。依赖：H1、H2。

#### L2 — 样板二：聊天转录
- **目标**：按 FastVibe 的 `message-list` / `message-row` / `tool-row` / `composer` 重写转录区。**这是整个改造里最大的一块**（FastVibe 侧 `message-list.tsx` 788 行 + `message-row.tsx` 843 行 + `composer.tsx` 916 行），且与批次 B 的行为条目高度重叠 —— **B 批次的行为改动直接在新 DOM 上做，不先改旧 DOM 再迁**。
- **分步**：L2a 转录容器与消息行 → L2b 工具卡与折叠 → L2c Composer → L2d 队列与权限面板。
- **参考**：`src/renderer/src/components/chat/*` 全部；`lib/chat-layout.ts`、`lib/tool-presentation.tsx`。
- **PI NEXT**：`components/ChatWindow.tsx`、`components/MessageView.tsx`、`components/ChatInput.tsx`、`components/ProcessGroup.tsx`。
- **验收**：长会话滚动流畅（沿用 B2 的虚拟化改动）；工具行单行摘要；明暗对照截图；`docs/patches/` 补丁台账更新（`fork:` 标记保留）。
- **量级**：XL（拆成 4 个子 PR）。依赖：H1、H2、H3。

#### L3 — 样板三：壳与侧栏（浮岛）
- **目标**：`AppShell` 的侧栏 / 主区 / 右栏换成 FastVibe 的浮岛方案（`panel-frame` + 透明 border inset + `resizable-panel`）；侧栏行用 `sidebar-rows.tsx` 的规格；标题栏分平台处理。**注意**：本仓是 Web + 可选 Electron 壳，`HAS_TRAFFIC_LIGHTS` / `HAS_CUSTOM_TITLE_BAR` 那套要按本仓的壳能力重判断，不能直接抄。
- **参考**：`src/renderer/src/components/layout/sidebar.tsx:476-696`、`side-pane.tsx`、`title-bar.tsx`；`index.css:181-434`（浮岛 CSS）。
- **PI NEXT**：`components/AppShell.tsx`、`components/SessionSidebar.tsx`、`components/TabBar.tsx`。
- **验收**：三栏可拖拽；浮岛与玻璃在明暗两套下对位；窄屏回退抽屉。
- **量级**：L。依赖：H1–H4。

#### L4 — 右栏六面板
- **目标**：文件 / 终端 / 浏览器 / Git / 审查 / 轨迹六个面板按 FastVibe 的 `side-pane-*.tsx` 重写外壳与头部；内容层（CodeMirror / xterm / 文件树）保留本仓实现。
- **参考**：`src/renderer/src/components/layout/side-pane-files.tsx`、`side-pane-terminal.tsx`、`side-pane-browser.tsx`、`side-pane-git.tsx`、`side-pane-changes.tsx`、`side-pane-subagent.tsx`。
- **验收**：六面板开合与拖拽；窄屏 `.m-*` 分支同步迁移。
- **量级**：L。依赖：L3。

#### L5 — 会话列表与项目树
- **目标**：侧栏内的项目分组 / 会话行 / 搜索 / 归档按 `sidebar-rows.tsx` 重写；本仓特有的（空间/任务两段、未读点、自研分组排序）**行为保留**，只换外观层。
- **参考**：`src/renderer/src/components/layout/sidebar-rows.tsx`。
- **验收**：虚拟列表行高仍可见（`fork:session-row-overlap` 那个教训：行高必须与状态无关）；明暗对照。
- **量级**：L。依赖：L3。

#### L6 — 移动端（PWA）全量迁移
- **目标**：批次 G 的 12 个 PR 里与**外观**相关的部分（G1 玻璃外壳 / G2 列表页 / G3 会话页 / G4 Composer / G6 设置页）改为在 FastVibe 移动端规格 + 新组件层上实现；与**行为**相关的部分（G5 队列 / G7 通知 / G10 连接态 / G11 草稿 / G12 搜索入口）**照旧执行，与本批次解耦**。
- **关键差异**：FastVibe 手机端是 Flutter（`apps/mobile_flutter`），本仓是 Web PWA —— 所以只能抄**信息结构与视觉规格**，实现仍用 React + Tailwind（这也意味着 `m-*` 类要逐步换成 Tailwind 类，PWA 的 `@media (max-width: 639px)` 分支重构）。
- **参考**：`apps/mobile_flutter/lib/**`；`apps/mobile_flutter/AGENTS.md`。
- **验收**：真机/仿真对照；`.m-*` 类在迁移页面上清零；触控 44px 档保留。
- **量级**：XL（拆成 5 个子 PR）。依赖：L1–L3、G 批次行为项。

#### L7 — 弹层与浮层统一
- **目标**：本仓的菜单 / 弹窗 / 底部面板（`ContextMenuProvider`、`PortalDropdown`、`PwaSheet`、各种 `.d-pop` / `.m-sheet`）统一换成 `components/ui/` 的 `popover` / `dropdown-menu` / `context-menu` / `sheet` / `dialog`。**这是清掉 `.overlay-surface` 类旧代码的前置**。
- **风险**：本仓的浮层体系有大量已修好的坑（`fork:context-pop-portal` 的裁切问题、`disablePointerDismissal` 防丢草稿、`useDialogA11y`）。替换时**必须逐条核对这些行为在新组件里是否仍在**，不能只看外观对了就换。
- **验收**：Esc / 遮罩点击 / 焦点陷阱 / 防误关四类行为逐条手测；`context-pop-portal` 那个裁切 bug 不复发。
- **量级**：L。依赖：L1、L2。

#### L8 — 小页面与边缘（配对 / 错误页 / 安装提示 / 离线）
- **目标**：`/pair`、`app/error.tsx`、`PwaUpdateBanner` / `PwaOfflineBanner` / `InstallPromptBanner`、`ErrorStates.tsx` 按 FastVibe 对应形态（`boot-recovery.tsx`、`error-boundary.tsx`、`f-loader.tsx`）重做。
- **参考**：`src/renderer/src/components/boot-recovery.tsx`、`error-boundary.tsx`、`f-loader.tsx`。
- **验收**：明暗对照；错误页按钮触控档。
- **量级**：M。依赖：H1、H2。

#### L9 — 模态类页面（模型配置 / 插件 / 技能 / 供应商）
- **目标**：`ModelsConfig` / `PluginsConfig` / `SkillsConfig` / `AgentsConfig` 四个大模态按 FastVibe 的 `providers-settings.tsx` / `model-detail-dialog.tsx` / `skills-settings.tsx` / `subagents-settings.tsx` 重写。
- **参考**：`src/renderer/src/components/settings/` 下对应文件。
- **验收**：四个模态的功能零回归（这四个文件各自都有单测）。
- **量级**：L。依赖：L1（共享设置行组件）。

#### L10 — 旧体系统一清理（**只在 L1–L9 全部完成后执行**）
- **目标**：删除 `design/v5/`、`design/v6/`（300M）、`design/pi-web-design/`、`app/design/`、`app/fork-ui.css`、`app/fork-mac-skeuo.css`、`app/pwa-*.css`、`app/settings.css`、`app/wallpaper.css` 里已被新实现替代的部分；删除所有 `d-*` / `m-*` / `pw-*` / `fork-*` 的**类名定义**（保留仍被引用的）；删掉所有画板测试（`*.boardnav.test.mjs` 等）。
- **为何必须最后**：用户裁定「先共存，最后统一清」。这 PR 的安全前提是「grep 不到任何 `d-*` / `m-*` 引用」—— 一旦提前执行，回退成本极高。
- **验收**：全仓 grep `d-` / `m-` 前缀类名零命中（注释除外）；`design/` 目录只剩仍需保留的资产（`pi-web-design/assets/icons.js` 在 H3 完成后也应退役）；包体积与 CSS 体积显著下降（预期 CSS 从 15312 行降到 2000 行量级）。
- **量级**：L。依赖：L1–L9 全部完成。

### 批次 A · 视觉基座（P0）

> **第 3 版范围修正**：本批次制定时视觉真值还是「本仓 V5/V6 画板」，现已改为 FastVibe 原实现。所以：
> - **A1 浮岛壳** → 并入 **L3**（在 FastVibe 的 `panel-frame` + `resizable-panel` 上做，不再自己写 CSS）。
> - **A2 玻璃二期** → 并入 **H4**（FastVibe 的 `applyTheme(theme, glass)` 已包含 rim / overlay 推导）。
> - **A3 主题体系 v2** → 并入 **H4**（直接搬 24 套 seed，不再「设计主题种子架构」）。
> - **A4 字阶与字号纪律** → **保留**，但规格取自 FastVibe（`--ui-root-font-size` 变量 + `tailwind` 的字阶类），不再用本仓五档字阶 token。
>
> 本批次**不再新增画板**（用户裁定画板体系拆掉）。下面各条保留原文供执行时对照规格，但落点以上述为准。

#### A1 — 浮岛壳（floating panes）→ 见 L3
- **目标**：桌面（≥768px）侧栏 / 中栏 / 右栏 / 设置全部变成内缩 8px 的圆角浮岛；移动端不变（仍是抽屉/全屏）。
- **内容**：透明 border 实现 inset（不是 margin）；外圆角 24 / 内 16；`background-clip: padding-box`；面板开合 280ms `cubic-bezier(0.22,1,0.36,1)`，动画期间子面板保持 `--panel-width`；拖拽中撤销动画；分隔条 margin 24px + 平移 ±8px；对话列顶部补 8px。
- **参考**：`fastvibe-main/src/renderer/src/index.css:181-215,410-434`；`lib/use-resizable-panel.ts`。
- **PI NEXT**：`components/AppShell.tsx`（`d-shell`/`d-side`/`d-main`/`d-panel` 骨架）、`app/globals.css`、`app/fork-ui.css`、`app/design/v5-forms.css`。
- **画板**：**不新增**（画板体系已在 H6 停用）。验收改为与 FastVibe 对照截图。
- **验收**：`tsc` / `npm test` / `check:design` / `verify:boards`（新 spec 对位）；真浏览器 1440×900 与 1280×800 两档截图；折叠/展开无残留 inline 值。
- **量级**：L。依赖：无。

#### A2 — 玻璃二期（rim / overlay / 切割）
- **目标**：在已落地的 V6 玻璃材质之上补齐 FastVibe 的三种细节：浮层玻璃（`.overlay-surface`）、高光 rim（mask 圆环渐变）、玻璃下粘顶提示的 mask 切割。
- **内容**：`--glass-rim` 155° 四段渐变 + `mask-composite: exclude`；`::after` 覆盖自身 hairline；`:focus-within` 隐藏 rim；`.glass-cover`（回到最新按钮）blur(16px) saturate(1.6)；overlay blur(28px) saturate(1.8) + 两级阴影；粘顶 prompt 在玻璃下不画背景、对回复行打 16px 羽化 mask；设置打开时 shell `visibility: hidden`。
- **参考**：`index.css:219-340`；`message-list.tsx:186-306`；`themes.ts:120-161`。
- **验收**：计算样式断言（blur/saturate/fill 值）；降级测试（`prefers-reduced-transparency`、`@supports not`）。
- **量级**：M。依赖：A1。

#### A3 — 主题体系 v2（主题种子 + 亮暗独立）
- **目标**：从「亮/暗/自动」升级为「亮暗各自选主题」，首批 12 个主题（6 亮 6 暗），架构支持 24。
- **内容**：`ThemeSeed`（bg/fg/surface/border/muted/accent/syntax/charts）→ 推导现有 `--bg/--text/--accent/--ds-*` 全表；`applyTheme` 写 inline custom property；主题选择器带三色缩略；与 V6 玻璃 tokens 联动（玻璃由主题派生）。**不引入 shadcn 变量名**，全部映射进 PI NEXT 现有槽位。
- **首批主题**：GitHub、One（Light/Dark Pro）、Catppuccin（Latte/Mocha）、Dracula、Tokyo Night、Nord、Gruvbox、Solarized、Rosé Pine、Ayu（对应 FastVibe 前 12）。
- **参考**：`themes.ts:66-217,219-731,742-771`。
- **验收**：每个主题过对比度门禁（`check-contrast.mjs`）；`check:design` 令牌门禁；截图矩阵 12 主题 × 光暗。
- **量级**：L。依赖：A1/A2（玻璃推导共用）。

#### A4 — 字阶与字号纪律
- **目标**：会话正文与工具卡统一 14px（root 16）；尺寸全部走 rem，根字号设置驱动全局缩放；清理写死的 px 字阶。
- **内容**：核对/统一 V5 五档字阶与 FastVibe 的 text-* 纪律；`--ui-root-font-size` 已存在则接线到全部 rem 组件；xterm fontSize 由根字号推导。
- **参考**：`themes.ts:780-797`；AGENTS.md「Type scale & interface size」。
- **验收**：`check-style-literals` 内联几何基线只降不升；字号 12/14/16/20 四档截图对比。
- **量级**：M。依赖：无。

### 批次 B · 聊天转录（P0）

#### B1 — 转录列与滚动器
- **目标**：居中的单一列宽；贴底跟随 + 回底按钮 + 粘顶提示（含 A2 的玻璃切割）+ 无操作滚轮守卫。
- **参考**：`message-list.tsx:104-206,340-470`；`components/ui/message-scroller.tsx`。
- **PI NEXT**：`components/ChatWindow.tsx`（滚动与列宽）、`app/globals.css`（`.d-chat` 系）。
- **验收**：手动场景（长历史贴底、向上滚后新消息不抢、发送强制跳回）+ 单元测试（滚动状态判定纯函数）。
- **量级**：M。依赖：A2。

#### B2 — 轮级虚拟化与身份复用
- **目标**：把「分页窗口」升级为按 turn 的虚拟列表：只渲染可视轮 + overscan；首帧只渲染尾部；按 id 复用消息对象避免整段重渲染。
- **参考**：`message-list.tsx:421-600`；`session-reducer.ts:340-380`（reconcile）。
- **PI NEXT**：`components/ChatWindow.tsx`、`hooks/useAgentSession.ts`。
- **验收**：1338 条会话首帧时间读数（记录前后）；滚动到历史顶部无跳动；`npm test`。
- **量级**：L。依赖：B1。

#### B3 — 消息行动作与内联编辑
- **目标**：hover/focus 显示时间戳 + 复制 + 编辑（仅 user）+ 重试（仅最新）+ fork；内联编辑器（Cmd/Ctrl+Enter 提交、Esc 取消、CJK 友好）；错误/停止态卡片。
- **参考**：`message-row.tsx:127-233,393-433`。
- **验收**：键盘用例（提交/取消/失焦）、移动端常显动作。
- **量级**：M。依赖：无。

#### B4 — 工具行 v2
- **目标**：单行工具行（图标 + 名称 + 对象 + 概要 + 状态 + chevron）；相邻同类合并（explore / changes / terminal 三类）；摘要统计与 DiffStat；read/search/list 不可展开但对象可点开预览；展开状态模块级记忆（上限）。
- **参考**：`tool-row.tsx`、`tool-group.tsx`、`tool-card.tsx`、`lib/tool-presentation.tsx`（family 映射 16 类）、`lib/group-parts.tsx:39-46`。
- **PI NEXT**：`components/MessageView.tsx`（ToolCallBlock）、`components/ProcessGroup.tsx`。
- **验收**：工具场景快照（bash/edit/read/grep/MCP/子代理）；展开记忆跨重渲染。
- **量级**：L。依赖：B3（共享行结构），可与 B5 并行设计。

#### B5 — 运行折叠与提示卡
- **目标**：settled run 自动折叠（保留答案与 DAG 卡）；思考块「思考 · N 秒」+ 流式 ticker；模型切换分隔线；压缩卡默认折叠；停止卡（length/aborted）；每轮文件 chips。
- **参考**：`run-collapse.tsx`、`thinking-block.tsx`、`model-change-notice.tsx`、`compact-notice.tsx`、`message-row.tsx:186-233,660-800`。
- **验收**：折叠切点（thinking/tool/group 的尾 index +1；开头 model 分隔线留在外面）；`foldHead` 边界用例。
- **量级**：M。依赖：B4。

#### B6 — Composer v2
- **目标**：输入卡 22px 圆角 + glass-rim；附件 chips（支持任意文件、拖放/粘贴、长文本转附件）；conf 上下文环 + popover 统计面板；发送/停止/继续三态按钮；handoff 锁定态。
- **参考**：`composer.tsx:521-566,679-895`。
- **验收**：附件类型矩阵（图片/文本/任意二进制）；上下文环阈值色（70%/90%）；按钮三态。
- **量级**：L。依赖：A2。

#### B7 — 消息队列托盘
- **目标**：composer 上方托盘塞进输入卡；行内容（拖柄 + 序号 + 文本）；非发送态（立即/编辑/移除）；发送中（召回/丢弃）；pause 警告行 + 继续；拖拽排序（鼠标 distance 5 / 触屏 250ms hold）。
- **参考**：`message-queue.tsx:47-277`。
- **PI NEXT**：`hooks/useAgentSession.ts`（queuedMessages）、`lib/queue-surgery.ts`（已有数据层）。
- **验收**：立即发送的乐观 UI 与撤回；排序持久化；pause/继续。
- **量级**：L。依赖：B6。

#### B8 — 权限 / 问题面板
- **目标**：confirm/select/input/questions 从模态改为 composer 槽位面板；按会话队列（队首展示）；questions 多问题步进器（←/→、↑/↓、数字键、Enter 提交、Esc 先收自定义输入）；editor 保留模态且禁点击遮罩。
- **参考**：`permission-panel.tsx:47-638`、`permission-dialog.tsx:53-60`。
- **PI NEXT**：`components/ChatWindow.tsx`（ApprovalCardBody / 扩展请求）、`lib/extension-ui-queue.ts`。
- **验收**：并行子代理 8 路提问只有队首展示、按 id 移除不砍队首；后台会话请求点亮侧栏"等你"。
- **量级**：M。依赖：B6。

#### B9 — 新会话首页
- **目标**：时间问候 + 四个建议 chips（探索/构建/审查/修复）+ 项目/分支 chip 行（新会话才显示）。
- **参考**：`new-session.tsx:44-79`；`composer.tsx:502-503`。
- **量级**：S。依赖：B6。

#### B10 — 轮次导航
- **目标**：二选一（推荐 a）：(a) 新增左侧 TurnRail（dock 刻度 + 悬停预览 + 点击跳转 + 密度分档 + 窄容器隐藏）；(b) 把小地图升级为轮次刻度。**先做 a，保留小地图开关**。
- **参考**：`turn-rail.tsx:30-217`、`lib/turn-rail.ts`。
- **验收**：1 轮不显示、多轮 dock 放大、点击定位、`<58rem` 隐藏。
- **量级**：M。依赖：B2（虚拟器位置）。

#### B11 —（可选）流式代码高亮
- **目标**：评估把手写的 Prism 管线换成 Shiki + 流式 tokenizer（已完成行保留 HTML，只 tokenize 未完成行）。
- **参考**：`lib/syntax-highlighter.ts`、`lib/highlight.ts`。
- **判定**：仅当 A/B 批次完成后还有收益再做；否则保持现状（v0.12 已做按需加载）。
- **量级**：M。依赖：无。

### 批次 C · 壳与栏（P1）

#### C1 — 侧栏行规格 v2
- **目标**：行高 28px（触屏 40）、三色文本、选中 3px 强调条、hover 动作（置顶/归档/…）、子代理展开箭头、内联改名（Enter 提交 / Esc 取消）。
- **参考**：`sidebar-rows.tsx:209-620`；AGENTS.md「Sidebar look」。
- **PI NEXT**：`components/SessionSidebar.tsx` + `app/design/v5-forms.css`。
- **验收**：行高与状态无关（避免悬停改行高——已有教训）；触屏动作常显。
- **量级**：M。依赖：无。

#### C2 — 侧栏拖拽排序
- **目标**：空间段 / 任务段各自拖拽排序 + 插入线 + 服务端持久化；拖拽行浮起副本。
- **参考**：`sidebar.tsx:293-380`、`sidebar-rows.tsx:172-186`。
- **验收**：插入线在拖动行中心上下判定；移动端不注册 sensor。
- **量级**：L。依赖：C1。

#### C3 — 右栏 tab 系统 v2
- **目标**：quiet tab（自动创建不抢焦点）、每会话 scope、关闭其他 / 关闭全部、tab 标题规则、关闭会话时资源释放（terminal/browser）、tab 中键关闭。
- **参考**：`stores/side-pane.ts`、`side-pane.tsx:237-470`。
- **PI NEXT**：`components/AppShell.tsx`、`components/TabBar.tsx`、`components/fork/SplitPaneHost.tsx`。
- **验收**：工具自动创建的 tab 不展开；删/归档会话释放资源。
- **量级**：L。依赖：无。

#### C4 — 文件面板 v2
- **目标**：文件树懒加载 + 目录展开记忆 + 预览与树的分栏（container query 32rem 断点）+ 点击文件就地预览；与现有 FileExplorer 并存策略（设置里二选一或统一）。
- **参考**：`side-pane-files.tsx:47-339`。
- **验收**：大目录首屏；展开记忆跨会话；窄面板单栏切换。
- **量级**：M。依赖：C3。

#### C5 — 浏览器面板 v2
- **目标**：地址栏 + 前进/后退/刷新/查找/缩放；设备视口（responsive / 375×812 / 768×1024）；元素拾取（PICK 脚本体）；favicon → tab 标题。
- **参考**：`side-pane-browser.tsx`、`browser-guest.ts:102-353`。
- **验收**：视口切换截图；拾取返回元素描述。
- **量级**：M。依赖：C3。

#### C6 — 命令面板与状态区
- **目标**：命令面板三组（会话 / 动作 / 设置）+ 空查询最近 9 条 + mod+1..9 + `<mark>` 高亮；底部引擎状态 pill（模型 id / 连接态）。
- **参考**：`command-palette.tsx:39-290`、`status-pill.tsx:9-37`。
- **PI NEXT**：`components/fork/CommandPalette.tsx`。
- **验收**：设置分节可搜；快捷键；空态。
- **量级**：M。依赖：无。

### 批次 D · 设置（P1）

#### D1 — 设置框架 v2
- **目标**：设置行规范（label basis-48 换行、描述 ≤130 中文字符并被测试锁死、control 列 shrink-0、`align="start"` 补偿）；分组卡（divide-y + rounded-xl）；窄屏 master/detail 复核。
- **参考**：`settings-group.tsx:8-51`、`settings-dialog.tsx:149-265`、`test/settings-copy.test.ts`。
- **PI NEXT**：`components/SettingsPanel.tsx`、`app/settings.css`。
- **验收**：新增描述长度测试；窄屏往返页面栈正确。
- **量级**：M。依赖：无。

#### D2 — 供应商管理 v2
- **目标**：模型列表拖拽排序；ModelDetail 弹窗（显示名 / 协议 / context / max output / 模态 / 思考档 / 价格与阶梯 / 来源）；OAuth 额外用量提示；OpenAI / Kimi 配额；网关余额探测（new-api / sub2api）；cc-switch 导入（`~/.cc-switch/cc-switch.db`，丢弃 OAuth 与空预设，fingerprint 去重）。
- **参考**：`providers-settings.tsx`、`model-detail-dialog.tsx`、`openai-quota.ts`、`gateway-probe.ts:178`、`cc-switch.ts:52`。
- **PI NEXT**：`components/ModelsConfig.tsx`、`app/api/models-config/*`、`lib/provider-usage*`。
- **验收**：拖拽后写回 models.json；弹窗字段回环；cc-switch 只读扫描测试。
- **量级**：L。依赖：D1。

#### D3 — 快捷键编辑器
- **目标**：可录制（capture keydown，Esc 取消，Backspace 清空，非法组合拒绝）；冲突时把对方置空；行尾还原默认；底部全部恢复；搜索框；`sendOnEnter` 开关。
- **参考**：`shortcuts-settings.tsx:93-256`、`lib/shortcuts.ts`。
- **PI NEXT**：`components/fork/ShortcutGuideDialog.tsx`（升级为可编辑）。
- **验收**：录制/冲突/恢复用例；持久化。
- **量级**：M。依赖：D1。

#### D4 — 个性化与 AI 语言
- **目标**：自定义系统提示词编辑（textarea + 保存/还原 + 脏值判断）；AI 偏好语言（zh/en）每轮注入。
- **参考**：`personalization-settings.tsx:24-46`；`engine/ai-language.ts`；`resources/extensions/output-language`。
- **PI NEXT**：`lib/pi-web-preferences.ts`（单写入者）、`lib/rpc-manager.ts`（注入点）。
- **验收**：提示词进/不进 prompt 的断言；语言注入每个 run 重读。
- **量级**：S。依赖：无。

#### D5 — 通知与运行时
- **目标**：通知四开关（完成/出错/审批/更新）；keep-awake 开关（Electron powerSaveBlocker 或浏览器 Wake Lock）；网络代理设置（system/custom + host/port + 应用与回填）。
- **参考**：`shared/notifications.ts`、`keep-awake.ts`、`proxy-settings.tsx`。
- **验收**：开关真断开投递路径；代理保存后回填。
- **量级**：M。依赖：D1。

#### D6 — 插件市场 + 使用统计 v2
- **目标**：插件市场（搜索 / 类型筛选 / 排序 / 卡片 / 安装，350ms 防抖）；使用统计升级（热力图日/周/累计 + 每日 token 趋势折线 + 模型占比环）。
- **参考**：`extensions-settings.tsx:267-420`、`usage-settings.tsx:145-345`。
- **PI NEXT**：`app/api/plugins/*`、`components/fork/UsageStatsPanel.tsx`（图表可自绘或用 recharts）。
- **验收**：市场分页与缓存；统计口径与 usage-stats 一致。
- **量级**：L。依赖：无。

### 批次 E · 能力补齐（P0–P1）

#### E1 — DAG 编排 ① 后端
- **目标**：把 FastVibe 的 DAG 编排移植为 PI NEXT 的一方扩展 + 调度器：
  - 工具 9 个 action：`add/status/result/wait/cancel/resume/retry/update/send`（加 `depends_on` 简写与 `context_from`）；
  - 状态机：pending/running/completed/blocked/failed/skipped/cancelled；图状态派生；`T-0001` 编号 + `T-0001.2` 重试；
  - 调度：全局并发 5 / 每图 5 / 每 provider 3；`dag_wait` 协调者让出名额；**写路径隔离**（同工作区重叠写串行）；预算 3600s / 5 次重试；
  - 持久化：`dag.json`（seq 只增）+ 结果文件（图内 ≤4000 字预览）；重启时未完成节点标 cancelled；
  - 报告契约：节点结束前 `dag_report`（completed/blocked/failed + summary/evidence/artifacts）。
- **参考**：`src/main/pi/dag-scheduler.ts`、`engine/dag-store.ts`、`shared/dag.ts`、`shared/dag-tools.ts`、`main/dag-tools.ts`、`pi/dag-node-runtime.ts`。
- **PI NEXT**：`lib/dag-*.ts`（新建）、`lib/subagent-runtime.ts`（复用 throwaway session）、`lib/rpc-manager.ts`（extensionFactories 注册）。
- **验收**：调度纯函数单测（依赖/取消传播/写路径重叠/预算）；真会话跑一个 3 节点图；`get_tools` 运行时验证模型可见（照 AGENTS.md 的「注册≠可见」教训）。
- **量级**：XL。依赖：无。

#### E2 — DAG 编排 ② 前端
- **目标**：内联 DAG 卡（聊天里）+ 任务列表（侧栏子代理展开区）+ 节点详情右栏 tab（复用只读转录）。
- **参考**：`components/dag/*`、`dag-status-icon.tsx`、`shared/dag-view.ts`。
- **验收**：9 种状态图标与文案；进度统计；节点详情实时跟随。
- **量级**：L。依赖：E1、C3。

#### E3 — DAG 编排 ③ 画布
- **目标**：DAG 画布（布局算法 + 视口平移缩放 + 节点选择 → 右栏详情）+ DAG 对话框（最大化查看）。
- **参考**：`dag-canvas.tsx`、`dag-layout.ts`、`graph-viewport.ts`。
- **验收**：布局单测；大图（50 节点）性能。
- **量级**：L。依赖：E2。

#### E4 — Goal mode
- **目标**：`/goal <objective>` 建长目标；每轮提示对比进度；`agent_end` 未收 GOAL_COMPLETE 则续跑下一轮；状态作为 session entry 持久化；重启恢复为 paused；轮次上限 100；composer 上方 GoalPanel（暂停/恢复/清除）；`/goal` 裸命令 → armed 徽标。
- **参考**：`resources/extensions/goal.ts`、`extension-surface.tsx:158-222`。
- **PI NEXT**：新建 `lib/goal-extension.ts` + 面板。
- **验收**：状态 round-trip；paused 恢复；上限行为。
- **量级**：M。依赖：无。

#### E5 — checkpoint 文件回退 + commit message
- **目标**：(a) 工具执行前的文件内容捕获（每回合每文件一次、大小上限、git HEAD 缓存），重试弹窗列出文件并提供"保留文件改动"或"恢复"；(b) commit message 生成（porcelain 解析 + 文件分类 + 预算分配 + 大变更按目录分组）。
- **参考**：`engine/checkpoint.ts:130-266`、`commit-message.ts:197`。
- **PI NEXT**：`lib/session-rewind.ts`（已有会话回退）+ 新 `lib/checkpoint.ts`。
- **验收**：恢复后 git 状态断言（tracked 从 HEAD、新增删除、不可回退清单）。
- **量级**：L。依赖：无。

#### E6 — 决策引擎（batch_decide 优先）
- **目标**：分两步：(a) `batch_decide` 工具（5–500 项、每项独立请求、低置信返回 review、5 分钟 deadline、重读配置）；(b) 场景开关（browser/computer/batch）+ 决策模型选择（System One 协议）。browser_task 决策驱动待定（依赖决策后端）。
- **参考**：`engine/decision/*`、`pi/decision-scenarios.ts:33`、`decision-settings.tsx:118-203`。
- **PI NEXT**：新建 `lib/decision-*`；设置分节新增「决策引擎」。
- **验收**：协议纯函数单测（请求校验/裁剪/采纳规则）；工具运行时可见。
- **量级**：L。依赖：无。

#### E7 — 搜索与导入增强
- **目标**：命令面板会话正文命中（逐文件子串 + 摘要 + LRU 缓存 + 2MB 跳过）；导入新增 zcode 来源（`~/.zcode/cli/db/db.sqlite`，只导 visible 消息，按 sequence 排序）+ 报告分节 + 归档开关。
- **参考**：`engine/conversation-search.ts:40`、`import/sources/zcode.ts:38`。
- **验收**：搜索单测（命中窗口/上限）；导入只读打开 sqlite。
- **量级**：M。依赖：C6。

### 批次 G · PWA 移动端（P0，与 M2 并行）

> 移动端的目标不是照抄 Flutter，而是把 FastVibe 移动端的**信息结构 / 交互 / 视觉纪律**搬进 PI NEXT 的 PWA（`m-*` 设计系统 + Capacitor 壳）。FastVibe 的四类原生依赖（Keychain、系统设置跳转、mDNS、后台进程存活）不在范围内。
>
> **第二轮深读（2026-10-13 下午）补入 G10–G12**：对 Flutter 端做逐文件规格提取后，发现三块**没有进第一版计划**的真实差距 —— 连接状态机（G10）、草稿持久化（G11）、手机转写收口（G12）。同时修正 G2 的两处口径错误：Flutter 的「等你处理 / 运行中 / 最近」三分组与「全部 / 进行中 / 待处理」dock 是针对**它的** WorkSpace 页，与本仓 M-04 板（「未读 / 运行中 / 归档都不是分类，而是行上的状态」；分段只有空间 / 任务）冲突，按本仓板面执行。

#### G1 — PWA 玻璃外壳
- **目标**：对齐 FastVibe 移动端的两条材质纪律：**玻璃只是 chrome、正文永不透明**；顶栏渐进模糊（progressive blur）+ 用壁纸自身裁切的 scrim；设置里「减少玻璃」自动降级。
- **参考**：`apps/mobile_flutter/lib/ui/glass_screen.dart:18-60,130-190,215-305`；`lib/main.dart:104-170`（adaptiveQuality / reduceGlass）。
- **PI NEXT**：`components/pwa/PwaPage.tsx`、`app/globals.css`（`.m-top` / `--safe-*`）、`design/v5/pwa/system.css`、V6 材质块。
- **验收**：`prefers-reduced-transparency` 与低端机降级；桌面板零变化；真机/移动仿真截图。
- **量级**：M。依赖：A2。

#### G2 — 手机会话列表页（口径已按 M-04 修正）
- **目标**：把 Flutter 的「信息结构」搬进来，但**布局纪律以本仓 M-04 板为准**：抽屉只配三样 —— 搜索（常驻）、分段（**空间 / 任务**两档，切段只换范围、不推路由）、会话行（两行字）。Flutter 的「等你处理 / 运行中 / 最近」三分组**不做成三个分区** —— M-04 板的原话是「未读 / 运行中 / 归档都不是分类，而是行上的状态」，本仓已有 `runningSessionIds` + `useUnreadSessions` + `awaitingInput`/`awaitingApproval`，它们进**行内**徽章与左侧状态 mark，不新开分区。
- **内容**：会话行 leading 状态 mark（等你 > 运行 > 有项目 → 项目首字母色块 > 普通气泡，**优先级必须实现在一个纯函数里**并有单测）；标题 + 右侧相对时间；一行预览（搜索命中时替换为 snippet）；有项目时第三行文件夹 + 项目名；行尾状态徽章。相对时间与 snippet 都已有工具（`formatRelativeTime` / `SearchGroup`）。
- **不做**：Flutter 的底部 dock 分段悬浮条（M-04 板的分段贴在搜索下面，与抽屉同宽）；Flutter 的项目过滤胶囊（本仓分段已经是「空间 / 任务」两档，再叠一层胶囊是第二套分类）；「新对话先弹项目 sheet」（本仓新会话已有空间选择器，不重做）。
- **参考**：`lib/screens/server.dart:518-830`（状态 mark 的优先级与颜色语义）；`lib/ui/dock.dart:20-91`（只看分段行为，不看其位置）；本仓 `design/v5/pwa/boards/M-04-sessions-drawer.html` 帧 A/B（**布局真值**）。
- **PI NEXT**：`components/SessionSidebar.tsx`（m 分支、`.m-row` / `.m-row-m` / `.m-rowlabel`）、`lib/session-groups.ts`、`design/v5/pwa/system.css`。
- **验收**：状态优先级单测（四态 × 组合）；空态；搜索命中不丢状态 mark；行高与 M-04 板对位。
- **量级**：L。依赖：C1。

#### G3 — 手机会话页形态
- **目标**：反转列表（最新在底）；运行中浮出 WorkingPill（含毫秒计时）；滚离底部后浮出「回到最新」圆钮；空态问候 + 四条建议卡；footer 自报高度让转写底部内边距精确（键盘弹出不遮挡）；底部渐隐复核。
- **参考**：`lib/screens/chat.dart:113-130,837-1180`；`lib/screens/transcript.dart:112-245`。
- **PI NEXT**：`components/ChatWindow.tsx`（m 分支）、`components/ChatInput.tsx`、`app/globals.css`。
- **验收**：键盘弹收；长列表滚动；iOS bounce 与下拉刷新不冲突（沿用 `docs/mobile-shell-plan-2026-10-05.md` 风险表）。
- **量级**：L。依赖：B1。

#### G4 — 手机 Composer v2
- **目标**：四态动作按钮（发送 / 停止 / 继续 / spinner）；上下文环（70% / 90% 阈值）；模型 sheet（搜索 + provider rail + 最近 6 + 折叠分组）；思考档 sheet；附件压缩管线；缩略图行；Enter 换行。
- **已具备（不重做，只对齐）**：四态按钮事实上已是「单格 + 按 `hasDraftToSubmit` 切图标」（`ChatInput.tsx:3315`）；模型 sheet 已有搜索 + 按 provider 分组（`ModelSelector.tsx:244,287`）；手机 Enter 已是换行（`ChatInput.tsx:2807`）。**本 PR 的重点是把「已有但不完整」的补齐，而不是新建。**
- **缺口（要做的）**：① **上下文环的档位在 PWA 形态下完全缺失** —— `.m-ring` 只有一根强调色 conic 渐变，没有 warn / bad 档（`design/v5/pwa/system.css:308-311`）；桌面 `.d-ring` 也只有 `>70%` 一档（`>90%` 的 `.bad` 已在画板缺件清单里登记过）。两档一起补，而且产品里 `.m-ring` 有两处挂点（`ChatInput.tsx:4206` 行首、`4272`）都要改；② 模型 sheet 补「provider 横向 rail + 最近 6 个 + 多于 14 个才折叠」两条行为；③ 切模型后若当前思考强度不在新模型的 `thinkingLevels` 内要自动改写（否则下一轮发出去会被服务端拒）；④ 附件压缩参数（见下条，待裁定）。
- **参数对照（需裁定）**：本仓是长边 **1024** / JPEG **q85** / 最多 **10 张** / 单图上限 **10MB**（`ChatInput.tsx:606-607`、`lib/image-attachments.ts:1-2`）；Flutter 是长边 **2048** / q78 / 最多 **4 张** / base64 上限 5.5MB。方向相反：本仓压得更狠但存得更多。建议**长边跟 Flutter 提到 2048**（1024 在手机上看文档截图已经胡），**张数维持 10**（本仓上限本来就高且服务端已有校验）。不自行改 —— 这一步影响 token 消耗与后台上传体积。
- **参考**：`lib/chat/composer.dart:428-830`；`lib/chat/model_picker.dart:56-213`；`lib/chat/images.dart:17-140`。
- **PI NEXT**：`components/ChatInput.tsx`（`renderPwaComposer` / `compressImageFile`）、`components/pwa/PwaComposerSheet.tsx`、`components/ModelSelector.tsx`、`design/v5/pwa/system.css`（`.m-ring`）。
- **验收**：四态切换；环三档；压缩后尺寸与质量肉眼可接受；模型 <14 不折叠；切模型后思考强度已归位。
- **量级**：L。依赖：B6。

#### G5 — 手机队列与提问卡
- **目标**：队列面板（暂停转 warning + 「继续发送」胶囊 + 每行状态标签「已提交 / 等待注入 / 下一步插入 / 本轮结束后发送」+ claimed 不可取消）；提问卡占 composer 位（confirm 双按钮 / select 编号列表 / input / questions 多题必须答满 + 「提交 {done}/{total}」）；丢确认 = `uncertain`，保留乐观行不删。
- **参考**：`lib/chat/queue_panel.dart:20-160`；`lib/chat/prompt_card.dart:34-260`；`lib/chat/queue.dart:60-240`。
- **PI NEXT**：`components/ChatInput.tsx`（`.m-queue`）、`hooks/useAgentSession.ts`、`lib/extension-ui-queue.ts`。
- **验收**：revision 闸门；Stop 与 send 竞态；多题必答；后台会话阻塞提问可点亮。
- **量级**：M。依赖：B7/B8（共享数据层）。

#### G6 — 手机设置页与错误态
- **目标**：设置 hub 按手机场景重组表达（外观：主题 + **实时预览块** + 减少玻璃 + 语言；通用：后台通知 + 触感；关于：logo/版本/检查更新/更新日志/复制诊断）；应用级与页签级错误页（68pt 图标 + 标题 + 正文 + 按钮）；三步引导空态。
- **参考**：`lib/screens/settings.dart:178-320`；`lib/screens/server.dart:850-1010`；`lib/screens/devices.dart:227-240`。
- **PI NEXT**：`components/SettingsPanel.tsx`（手机 hub）、`components/pwa/ErrorStates.tsx`、`components/pwa/settingsHub.ts`。
- **验收**：与桌面分节不串味；错误页按钮走 44/48 触控档；语言就地切换。
- **量级**：M。依赖：G1。

#### G7 — 通知策略对齐
- **目标**：三类触发（完成 / 失败 / 阻塞提问）；去重 `serverId|conversationId|seq`（上限 1000）；payload 带机器与会话 id（冷启动也能落到那条会话）；前台不打扰（与 `lib/notification-plan.ts` 的在场裁决合并）。
- **参考**：`lib/notifications/policy.dart:40-100`；`lib/notifications/local.dart:60-120`；`lib/notifications/target.dart`。
- **PI NEXT**：`lib/notification-plan.ts`、`lib/mobile-notify.ts`、`lib/browser-notifications.ts`、`app/api/push/*`。
- **验收**：三场景各自触发/不触发；深链；去重；壳内与 PWA 两路共用判定。
- **量级**：M。依赖：无。

#### G8 — PWA 画板收口与门禁
- **目标**：把 `design:v5:land` 的 PWA 未满项落完（M-03 54/57、M-05 49/50、M-09 64/65）；`app/design/v5-forms.css:305` 的 safe-top 替换为 `var(--safe-top)`；12 张 PWA 画板补几何对位 spec。
- **参考**：`design/v5/pwa/boards/`；`docs/mobile-shell-plan-2026-10-05.md:512-545`（遗留清单）。
- **验收**：`design:v5:land` M 系列 100%；`verify:boards` 覆盖 12 张 PWA 板且 0 差异。
- **量级**：M。依赖：G1–G6（收口它们的新类）。

#### G9 —（可选）DAG 移动端呈现
- **目标**：会话顶部 44pt DAG 摘要条（进度 + 需关注数 / 离线）；任务图 sheet（节点详情：父子、验收、结论、证据、分页输出）。
- **参考**：`lib/chat/dag_panel.dart:19-110`。
- **判定**：等 E1–E3 完成后再做。
- **量级**：M。依赖：E1–E3。

#### G10 — 连接状态机与重连可见性
- **目标**：对齐 Flutter 的断线纪律 —— **断线不切错误页**：保留最后一份列表与转写，状态降为「重连中」；指数退避 300ms → 10s（封顶 10 次）+ 0.8–1.0 抖动；只有 4001 / unauthorized 才降级为「需要密码 / 需要登录」；回前台立即探活（不等下一个退避周期）；网络变化（`online` / `offline`）时立刻重试。
- **为什么进计划**：本仓现在只有固定 `EVENT_STREAM_RECONNECT_DELAY_MS = 1000` 的匀速重连（`hooks/useAgentSession.ts:246`），且**没有任何连接状态 UI** —— 用户在手机切回前台时看到的是「卡住的转圈」，不知道是在重连还是真的挂了。`PwaOfflineBanner` 只看 `navigator.onLine`，看不到「网通了但服务端没回来」。
- **内容**：把 `AgentEventConnection` 的重连节奏换成退避 + 抖动（纯函数，可单测）；新增一个**全局连接状态 store**（`ready` / `reconnecting` / `needs-auth` / `offline` 四态），由顶层挂一次探活；`.m-top` 副标题显示状态点 + 文案（照 `server.dart:518-556` 的四色语义）；转写区不加遮罩、不禁用输入（离线时发送走既有队列）。
- **参考**：`lib/session/connection.dart:20-21,367-441,460-560,620-700`（退避参数、4001 降级、凭证预建热切换、前台探活）。
- **PI NEXT**：`hooks/useAgentSession.ts`（重连参数）、新 `lib/connection-store.ts`（纯状态 + 订阅）、`components/AppShell.tsx`（`.m-top` 状态位）、`lib/mobile-shell.ts`（网络变化桥）。
- **验收**：退避序列单测（含抖动上下界）；拔网 → 横幅「重连中」且列表可读；换回 → 自动恢复且**不重挂对话**；401 场景走「需要密码」分支；前台切换立即触发一次探活。
- **量级**：M。依赖：无（与 G7 共享 `lib/notification-plan.ts` 的在场裁决口径）。

#### G11 — 草稿持久化（手机尤其重要）
- **目标**：草稿按「服务器 + 会话」持久化，350ms debounce 落盘，刷新 / 切后台 / 冷启动都还在。
- **为什么进计划**：`lib/draft-store.ts` 现在是一个**纯内存 `Map`**（第 26 行），刷新页面即丢。桌面上这是个不便，**手机上这是数据丢失** —— 系统回收 WebView、用户切回微信再切回来、来电打断，输入框里的字就没了。
- **内容**：`draft-store.ts` 加持久化后端（`localStorage` + 版本前缀 + 容量上限 + 损坏时丢弃而不是抛错；附件图片**不入** localStorage —— 体积会爆，只存文本与引用，图片丢了就在恢复时如实剔除并提示）；保留现有纯内存路径给测试（注入式 store，默认用 localStorage）；`rekeyDraft` / `parkedNewSessionDraftKey` 那套「新会话先驻留再改名」的逻辑必须跟着持久化走，否则新会话第一条消息发出去后草稿键会漂。
- **参考**：`lib/chat/draft_storage.dart`（350ms debounce、按 server+conversation 建键、`chat.dart:190-215` 的接线）。
- **PI NEXT**：`lib/draft-store.ts`、`components/ChatInput.tsx`（`draftKey` 生命周期）、`components/AppShell.tsx`（`rekeyDraft` / `parkedNewSessionDraftKey`）。
- **验收**：单测（debounce、容量、坏数据、附件剔除）；手动：打字 → 刷新 → 还在；打字 → 切会话 → 切回 → 还在；新会话发首条消息后草稿键不漂。
- **量级**：S–M。依赖：无。

#### G12 — 手机转写收口与会话内搜索入口
- **目标**：两件手机上的「够得着」问题。
- **(a) 会话内搜索入口**：`ConversationFindBar` 功能完整（逐条命中、跨分页、计数器、高亮），但**入口只有 ⌘F**（`ChatWindow.tsx:2031`）—— 手机没有这个键，于是整条功能在手机上等于不存在。在会话页的移动工具条加一枚「搜索此对话」（走已有的 `mobile-toolbar-slim` 收口，与 ⋯ 菜单同一格，不新增底栏）。
- **(b) 参数 / 输出 / diff 是否进手机转写 —— 需裁定**：Flutter 的纪律是「参数、输出、diff **一律不进**手机转写；只有 `todo` 与 `dag_*` 可展开」。本仓 M-02 板写的**恰恰相反**：「能展开的默认收起，标题行永远可见：代码、表格、附件都自带滚动，不许把整屏撑开」（`M-02-transcript.html:22`），产品也已按板实现（`.m-tool` + `.m-card-body` 可展开）。**两条纪律不冲突的地方是「默认折叠」，冲突的是「能不能展开」。**建议保留本仓行为（可展开、默认收起）—— 手机上确实有看输出的需求，而板面已经用「自带滚动 + 默认收起」约束了它；但这一条要用户点头，所以先记为待裁定，默认**维持现状**，不照 Flutter 删掉展开能力。
- **参考**：`lib/screens/chat.dart`（搜索此对话入口）；`lib/chat/tool_card.dart:20-60,400-560`（Flutter 的「一行到底」纪律，供对照）。
- **PI NEXT**：`components/AppShell.tsx`（`renderChatToolbarActions` 的 mobile 分支）、`components/ChatWindow.tsx`（`findOpen` 已有，需要能被外部点亮）、`components/fork/ConversationFindBar.tsx`（无需改）。
- **验收**：(a) 手机上点得到、点开可用、Esc / 关闭钮回得来；(b) 裁定后要么维持现状并在 `DIVERGENCE.md` 记一条「与 Flutter 不同」，要么按 Flutter 收口并删掉对应展开入口。
- **量级**：S。依赖：无。

### 批次 F · 大件（P2，执行前需单独确认）

#### F1 — SSH 远程主机 + headless agent
- **目标**：SSH 主机管理（测试连接 / 一键启动常驻 agent / 停止）；主机密钥信任流程；手机经 SSH 转发访问（loopback token）；systemd 服务安装。
- **参考**：`src/main/ssh/*`、`src/agent/*`。
- **判定**：这会把 PI NEXT 从"本机工作台"扩成"多机控制台"，需要产品级决策（认证、密钥存储、信任模型）。
- **量级**：XL。

#### F2 — 电脑操控（computer use）
- **目标**：`computer_*` 工具（窗口列表/窗口状态/点击/输入/热键/滚动）+ 授权引导。
- **判定**：需要 native driver（FastVibe 用 `@trycua/cua-driver`）+ macOS 屏幕录制/辅助功能授权，与 Electron 打包强相关；PI NEXT 打包链已有（`electron/`），但成本高。**先确认是否真要做**。
- **量级**：XL。

#### F3 — 记忆形态对齐
- **目标**：二选一：(a) 保持 `pi-hermes-memory`，只把设置页/告知做深（低成本）；(b) 移植 FastVibe 式第一方蒸馏（6 小时安静触发 / 两阶段提取整合 / `memory_summary.md` + `MEMORY.md` + rollout 摘要 / 引用计数 / 脱敏）。
- **判定**：(b) 与现有 hermes 重叠且要维护提示词与整合 agent，需用户裁定。推荐先 (a)，若用户要"记忆也照 FastVibe 做"再启动 (b)。
- **量级**：XL（b）。

---

## 4. 执行纪律（每个 PR 的六件套）

> **第 3 版修订**：第 3 条从「先画板」改为「先对照 FastVibe 源码」；第 4 条的门禁集合换了（画板相关停用）。其余四条不变。

1. **fork 标记**：所有改动带 `fork:<slug>` 注释（本计划统一用 `fork:fastvibe-*` 前缀，如 `fork:fastvibe-composer`）。
2. **补丁台账**：`docs/patches/NNNN-*.md` + `.patch`，按现有约定（一个补丁 = 一个意图）。**保留** —— 它是 fork 维护机制，与设计体系无关。
3. **规格来源**：打开 FastVibe 对应源文件，**先读再写**。组件能从 `components/ui/` 直接用的就直接用，不重写。DOM 结构、类名组合、间距值以 FastVibe 为准，不以本仓旧样式为准。（旧画板已作废，**不新增画板**。）
4. **门禁**：`node_modules/.bin/tsc --noEmit`；`npm test`（新增/更新 `.test.mjs`）；`npm run check:design`（画板相关项已在 H6 停用，其余照跑）；颜色改动跑 `npm run check:contrast`；**DOM 几何改动改为与 FastVibe 对照截图**（新流程见 H6），不再跑 `verify:boards`。
5. **真浏览器验证**：`npm run prod` 起服 → Playwright/内置浏览器验证 + 截图（不是只看代码）。
6. **三语文案**：UI 文案进 i18n（zh-CN / zh-TW / en），不硬编码。

**不要改的东西**：`lib/pi-web-preferences.ts` 是偏好唯一写入者；`lib/session-liveness.ts` 是忙碌信号唯一入口；`lib/path-security.ts` 是安全边界；`lib/file-tree-visibility.ts` 只看可见性不管授权。

**过渡期特别提醒（L10 之前）**：`design/v5/` 与 `design/v6/` 的类只维护不新增（也不再新增画板）；`app/design/tokens.css` 与 `app/fork-ui.css` 在 H4 完成后进入「只读兼容」状态；两套令牌名共存期内**新代码只写 FastVibe 名**。

---

## 5. 里程碑与建议顺序

```
M0「换基座」  H1 → H2 → H3 →（H4 与 H6 并行）→ H5
              交付物：shadcn 组件层可用、Hugeicons 就位、24 主题可切；
              此后的所有页面都建在它上面。
M1「样板」    L1 → L2 → L3
              交付物：设置弹窗 / 聊天转录 / 壳与侧栏 三页与 FastVibe 对照一致。
              这三页跑通后，剩余的迁移就是「按同一套路重复」。
M2「铺开」    L4 → L5 → L7 → L8 → L9 → L6（移动端殿后，因为要等 G 批次行为项）
              ＋ B/C/D 批次里与外观无关的行为条目、G5/G7/G10/G11/G12
              交付物：全部页面 = FastVibe 形态；手机端同理；断线可读 + 草稿不丢 + 搜得到
M3「补齐」    E4 → E5 → E6 → E7 → E1 → E2 → E3（DAG / Goal / checkpoint / 决策）
              交付物：能力与 FastVibe 同深
M4「大件」    F1 / F2 / F3（逐个确认后再开）
M5「清场」    L10
              交付物：旧 CSS / 画板 / 门禁删除，CSS 体量从 15312 行降到 2000 行量级
```

顺序理由：H 是地基（不完成则 L 无法开工）；L1–L3 是样板（验证整套技术栈在 Next.js 里跑得通）；L4–L9 是铺开（同一套路重复）；L10 必须最后（用户裁定「先共存，最后统一清」）；E 与视觉解耦可穿插；F 成本量级不同单独决定。

---

## 6. 不搬清单（附理由）

| 项 | 理由 |
| --- | --- |
| Electron 原生窗口 chrome / vibrancy / traffic lights | PI NEXT 是 Web + 可选 Electron 壳；玻璃可用 `backdrop-filter` 近似（FastVibe 自己也是这个机制） |
| 官方连接（账号 + WebRTC + TURN 中继） | 需要 FastVibe 的云端服务（fastvibe-services）才能成立；PI NEXT 已有 LAN + tunnel + PWA 三件套 |
| Flutter 手机 App | PI NEXT 已有 PWA + Capacitor 壳 + 同步协议；重写一遍收益为负 |
| 移动端 Keychain/Keystore 凭证与「跳到系统设置」 | 浏览器无等价物；PWA 用 IndexedDB + 页面内引导替代 |
| mDNS「附近的电脑」发现 | 浏览器无 mDNS；用扫码 / 手输地址 /（未来）账号设备列表替代 |
| Android APK 自更新 | PWA 由 Service Worker 更新（版本自愈已做） |
| GlassScaffold 的 shader 级玻璃折射 | 浏览器只能 `backdrop-filter` + 描边近似 |
| Vite / electron-vite | 本仓是 Next.js，构建链不同；Tailwind 在 Next 里走 PostCSS 插件（**已接**） |
| `@fontsource-variable/geist` | 本仓用 `next/font/google`，Next 的字体优化（预加载 / 零 CLS）优于纯 CSS 引入；**有意偏离** |
| `@tanstack/react-virtual` 替换自研虚拟化 | 本仓自研已处理「行高测量」这个特有难题（`fork:session-row-overlap` 的教训）；换掉是倒退 |
| `@dnd-kit/*` 替换自研拖拽 | 同上：自研已适配本仓虚拟列表与窄屏，不强制换 |
| pi-tui 组件桥 / TUI 线渲染 | 依赖 pi-tui 的 SGR 渲染，与 Web 渲染模型冲突；PI NEXT 直接用 React 渲染 |
| Chromium session 级代理 | PI NEXT server 端无 Chromium；只需 Node 侧代理设置 |
| `material-icon-theme`（彩色文件图标） | 与「文件图标统一」的现有契约冲突；**待你单独裁定** —— 换成彩色会改变整个文件树的观感，不在一纸计划里顺带决定 |

---

## 7. 参考索引（FastVibe 源文件 → 本计划用途）

| 主题 | 文件 |
| --- | --- |
| **技术栈换血（H 批次）** | `package.json`（依赖清单）；`components/ui/*`（35 个组件的直接来源）；`src/renderer/src/index.css:1-180`（Tailwind 入口 + 令牌 + `@theme inline`）；`src/renderer/src/lib/themes.ts:31-830`（24 套主题 seed + `applyTheme`）；`components/settings/settings-sections.tsx:1-120`（图标 import 样本） |
| 浮岛 / 玻璃 / 动效 / 字阶 | `src/renderer/src/index.css:181-434`；`src/renderer/src/lib/themes.ts` |
| **图标映射（H3）** | `components/chat/composer.tsx:3,179,622,671-702`（Hugeicons 用法样本）；`@hugeicons/core-free-icons` 的导出清单（FastVibe 实际用了 84 个） |
| 聊天转录全部（L2） | `src/renderer/src/components/chat/*`（`message-list.tsx` 788 行 / `message-row.tsx` 843 行 / `composer.tsx` 916 行 / `tool-row.tsx` / `tool-group.tsx` / `turn-rail.tsx`）；`lib/chat-layout.ts`、`lib/turn-rail.ts`、`lib/tool-presentation.tsx`、`lib/diff.ts` |
| 壳 / 侧栏 / 右栏（L3–L5） | `src/renderer/src/components/layout/*`（`sidebar.tsx` 476-696、`sidebar-rows.tsx`、`side-pane*.tsx`、`title-bar.tsx`）；`stores/side-pane.ts`；`lib/use-resizable-panel.ts`、`lib/window-chrome.ts`、`lib/platform.ts` |
| 设置全部页面（L1 / L9） | `src/renderer/src/components/settings/*`；`settings-dialog.tsx:147-260`（弹窗布局）；`settings-group.tsx`（行规格）；`settings-sections.tsx`（19 节 / 5 组） |
| 弹层与杂项（L7–L8） | `components/ui/{popover,dropdown-menu,context-menu,sheet,dialog}.tsx`；`components/boot-recovery.tsx`、`error-boundary.tsx`、`f-loader.tsx`、`running-mark.tsx` |
| DAG | `src/main/pi/dag-scheduler.ts`、`src/main/engine/dag-store.ts`、`src/shared/dag*.ts`、`components/dag/*` |
| Goal / 记忆 / 决策 / checkpoint / 队列 | `resources/extensions/goal.ts`、`engine/memory*.ts`、`engine/decision/*`、`engine/checkpoint.ts`、`engine/message-queue.ts` |
| 导入 / 统计 / 配额 / 代理 / cc-switch | `engine/import/*`、`engine/usage-*.ts`、`openai-quota.ts`、`gateway-probe.ts`、`network-proxy.ts`、`cc-switch.ts` |
| 远程 / SSH / agent | `src/main/server/*`、`src/main/rtc/*`、`src/main/ssh/*`、`src/agent/*` |
| 移动端 / PWA（L6 / G） | `apps/mobile_flutter/lib/**`（screens / chat / ui / theme / session / notifications）；`apps/mobile_flutter/AGENTS.md`（材质与平台纪律） |
| PWA 连接态 / 草稿（G10–G12） | `lib/session/connection.dart`（退避与状态四态）；`lib/chat/draft_storage.dart`（debounce 落盘）；`lib/screens/chat.dart:300-320`（从不调 `conversations.open`，只按名订阅）；`lib/chat/tool_card.dart`（输出纪律，对照用） |
| 设计/交互约定（文字版） | `fastvibe-main/AGENTS.md`（UI / Theming / 模板章节） |
