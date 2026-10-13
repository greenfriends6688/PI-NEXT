# FastVibe 对齐改造计划（PI NEXT × FastVibe）

日期：2026-10-13
参考项目：`/Users/yingjing/Downloads/fastvibe-main`（FastVibe 0.19.3，Electron 44 + React 19 + pi SDK 1.1.0）
目标仓库：本仓库 @ `ab67d3d1`（0.10.0-beta.3，Next.js 16 + React 19 + pi SDK 1.1.0）
审计方式：对 FastVibe 做 7 路并行深读（聊天 UI / 壳与布局 / 设置 / 设计系统 / 引擎功能 / 远程移动 / 数据流），对 PI NEXT 做 2 路现状盘点（UI 面 / 功能面）。本文件是唯一的执行台账，后续每个 PR 按 §4 的六件套交付。

---

## 0. 一页结论

用户裁定：**FastVibe 的形态最合理，PI NEXT 照它做全方位改造。**

先说清楚两个项目不是一个东西，然后按「能搬什么」组织：

| 维度 | FastVibe | PI NEXT |
| --- | --- | --- |
| 交付形态 | Electron 桌面应用（macOS/Windows/Linux）+ Flutter 手机端 | 本地 Web 工作台（浏览器 + Electron 壳 + PWA 手机端） |
| 引擎 | pi SDK 嵌入主进程，私有 userData 目录 | pi SDK 嵌在 Next server 进程，读写 `~/.pi` |
| UI 技术 | Tailwind v4 + shadcn Nova（Base UI）+ Hugeicons | 自研 V5/V6 设计系统（`d-*`/`m-*` + 画板 + 门禁），lucide 图标 |
| 强项 | 桌面壳打磨、DAG 编排、决策引擎、记忆、电脑操控、SSH、24 主题、浮岛/玻璃 | 多渠道推送、生图、联网搜索、定时任务、PWA、MCP 深度、文件/文档能力 |

**本次改造 = 把 FastVibe 的形态（布局 / 信息结构 / 交互 / 视觉规格）与产品能力搬进 PI NEXT 的 Web 形态**，而不是把 Electron 搬进来。

改造分 7 个批次、共 **47 个核心 PR**（另有 B11 / G9 两个可选），三条里程碑加一批大件（G 批次为 PWA 移动端，与 M2 并行）：

- **M1「看得见」**：A1–A4（浮岛壳 / 玻璃二期 / 主题 / 字阶）+ B1/B4/B6/B7（转录滚动 / 工具行 / composer / 队列）→ 打开应用就是 FastVibe 的那个样子。
- **M2「天天用」**：B2/B3/B5/B8–B10 + C1–C5 → 聊天、侧栏、右栏全部对齐。
- **M3「能力补齐」**：D1–D6 + E1–E7 → 设置与 FastVibe 同深；DAG / Goal / checkpoint / 决策引擎补齐。
- **M4「大件」（需单独裁定）**：F1 SSH、F2 电脑操控、F3 记忆形态。

**明确不做清单**（理由见 §6）：原生窗口 chrome/vibrancy、官方 WebRTC 连接与云端中继、Flutter App、彩色 Material 文件图标（除非改设计门禁）、24 主题整套硬搬、pi-tui 桥。

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
| 70 | 浮岛 | `panel-frame` 透明 border 方案 | 无 | ❌ | A1 |
| 71 | 玻璃 tokens | `glassTokens(seed)` 全量推导 + rim 渐变 + overlay | V6 有壳面 blur，无 rim/overlay | 🟡 | A2 |
| 72 | 主题种子 | ThemeSeed → 30+ token 推导 | 无（手写两套） | ❌ | A3 |
| 73 | 文件图标 | Material Icon Theme（彩色，SVG 协议） | lucide 单色（`FileIcons.tsx`，已登记偏离） | ⛔ 保 lucide | 备注 |
| 74 | 供应商图标 | LobeHub Mono，14px + viewBox inset 28 | `ProviderIcon.tsx` | 🟡 | D2 |
| 75 | diff 渲染 | 单一 DiffView + 行号解析（@@ / pi 内嵌列） | SplitPatchView / PatchTextView | 🟡 | B4 |
| 76 | KaTeX 严格行内 | Pandoc tex_math_dollars 规则 | remark-math（严格规则待查） | 🟡 | B3b |
| 77 | 滚动条 | 12px，thumb 3px 透明边框 | 有 | ✅ | — |
| 78 | 动效令牌 | spring 280 / fade 110/90 / caret steps | 有 motion tokens | 🟡 | A1/A2 |

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

### 批次 A · 视觉基座（P0）

#### A1 — 浮岛壳（floating panes）
- **目标**：桌面（≥768px）侧栏 / 中栏 / 右栏 / 设置全部变成内缩 8px 的圆角浮岛；移动端不变（仍是抽屉/全屏）。
- **内容**：透明 border 实现 inset（不是 margin）；外圆角 24 / 内 16；`background-clip: padding-box`；面板开合 280ms `cubic-bezier(0.22,1,0.36,1)`，动画期间子面板保持 `--panel-width`；拖拽中撤销动画；分隔条 margin 24px + 平移 ±8px；对话列顶部补 8px。
- **参考**：`fastvibe-main/src/renderer/src/index.css:181-215,410-434`；`lib/use-resizable-panel.ts`。
- **PI NEXT**：`components/AppShell.tsx`（`d-shell`/`d-side`/`d-main`/`d-panel` 骨架）、`app/globals.css`、`app/fork-ui.css`、`app/design/v5-forms.css`。
- **画板**：V6 新增 `D-41-floating-panes.html`（桌面 + 折叠 + 拖拽中三帧）。
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

1. **fork 标记**：所有改动带 `fork:<slug>` 注释（本计划统一用 `fork:fastvibe-*` 前缀，如 `fork:fastvibe-floating-panes`）。
2. **补丁台账**：`docs/patches/NNNN-*.md` + `.patch`，按现有约定（一个补丁 = 一个意图）。
3. **画板**：新形态先画板（`design/v6/web/boards/` 新 `D-4x`），产品 DOM 照板抄；对位 spec 进 `board-diff-all`。
4. **门禁**：`node_modules/.bin/tsc --noEmit`；`npm test`（新增/更新 `.test.mjs`）；`npm run check:design`；颜色改动跑 `npm run check:contrast`；DOM 几何改动跑 `npm run verify:boards`。
5. **真浏览器验证**：`npm run prod` 起服 → Playwright/内置浏览器验证 + 截图（不是只看代码）。
6. **三语文案**：UI 文案进 i18n（zh-CN / zh-TW / en），不硬编码。

**不要改的东西**：`design/v5/` 已落地的类只维护不新增；`app/design/tokens.css` 是令牌真值；`fork-ui.css` 永远最后加载；`lib/pi-web-preferences.ts` 是偏好唯一写入者；`lib/session-liveness.ts` 是忙碌信号唯一入口。

---

## 5. 里程碑与建议顺序

```
M1「看得见」  A1 → A2 → A4 → B1 → B6 → B4 → B7 → B3 →（A3 与 B 并行）
              交付物：打开应用 = 浮岛 + 玻璃 + 居中转录 + 单行工具 + 圆角 composer + 队列
M2「天天用」  B2 → B5 → B8 → B9 → B10 → C1 → C3 → C2 → C4 → C5 → C6 → D1
              G1 → G2 → G3 → G4 → G5 → G6 → G7 → G8 → G10 → G11 → G12（移动端，与 C/D 并行）
              交付物：长会话流畅、问询不弹窗、侧栏/右栏/设置 = FastVibe 形态；手机端 = FastVibe 移动端形态 + 断线可读 + 草稿不丢 + 搜得到
M3「补齐」    D2 → D3 → D4 → D5 → D6 → E4 → E5 → E6 → E7 → E1 → E2 → E3
              交付物：设置同深；Goal / checkpoint / 决策 / DAG 可用
M4「大件」    F1 / F2 / F3（逐个确认后再开）
```

顺序理由：视觉基座（A）是后面所有 PR 的画板依据；聊天（B）是用户每天看到的；壳/栏（C）依赖 A 的浮岛；设置（D）独立；能力（E）与界面解耦，可穿插并行；大件（F）成本量级不同，单独决定。

---

## 6. 不搬清单（附理由）

| 项 | 理由 |
| --- | --- |
| Electron 原生窗口 chrome / vibrancy / traffic lights | PI NEXT 是 Web + 可选 Electron 壳；V6 玻璃已是等价物 |
| 官方连接（账号 + WebRTC + TURN 中继） | 需要 FastVibe 的云端服务（fastvibe-services）才能成立；PI NEXT 已有 LAN + tunnel + PWA 三件套 |
| Flutter 手机 App | PI NEXT 已有 PWA + Capacitor 壳 + 同步协议；重写一遍收益为负 |
| 移动端 Keychain/Keystore 凭证与「跳到系统设置」 | 浏览器无等价物；PWA 用 IndexedDB + 页面内引导替代 |
| mDNS「附近的电脑」发现 | 浏览器无 mDNS；用扫码 / 手输地址 /（未来）账号设备列表替代 |
| Android APK 自更新 | PWA 由 Service Worker 更新（版本自愈已做） |
| GlassScaffold 的 shader 级玻璃折射 | 浏览器只能 `backdrop-filter` + 描边近似（G1 的目标形态） |
| 彩色 Material 文件图标 | 与 PI NEXT「图标全部 lucide、单色」的门禁与已登记偏离冲突；如要改，先做设计裁定（单独立项） |
| 24 主题整套 + shadcn/Base UI 变量名 | 会引入第二套设计来源；A3 改为"主题种子架构 + 首批 12 个主题"，全部映射进现有令牌 |
| pi-tui 组件桥 / TUI 线渲染 | 依赖 pi-tui 的 SGR 渲染，与 Web 渲染模型冲突；PI NEXT 直接用 React 渲染 |
| 系统通知的原生投递层 | PI NEXT 已有 Web Push + 壳内通知；只需补"开关与判定"（D5） |
| Chromium session 级代理 | PI NEXT server 端无 Chromium；D5 只做 Node 侧代理设置，浏览器流量走系统代理 |

---

## 7. 参考索引（FastVibe 源文件 → 本计划用途）

| 主题 | 文件 |
| --- | --- |
| 浮岛 / 玻璃 / 动效 / 字阶 | `src/renderer/src/index.css`；`src/renderer/src/lib/themes.ts` |
| 聊天转录全部 | `src/renderer/src/components/chat/*`；`lib/chat-layout.ts`、`lib/turn-rail.ts`、`lib/tool-presentation.tsx`、`lib/diff.ts` |
| 壳 / 侧栏 / 右栏 / 命令面板 | `src/renderer/src/components/layout/*`；`stores/side-pane.ts` |
| 设置全部页面 | `src/renderer/src/components/settings/*`；`settings-group.tsx`、`settings-sections.tsx` |
| DAG | `src/main/pi/dag-scheduler.ts`、`src/main/engine/dag-store.ts`、`src/shared/dag*.ts`、`components/dag/*` |
| Goal / 记忆 / 决策 / checkpoint / 队列 | `resources/extensions/goal.ts`、`engine/memory*.ts`、`engine/decision/*`、`engine/checkpoint.ts`、`engine/message-queue.ts` |
| 导入 / 统计 / 配额 / 代理 / cc-switch | `engine/import/*`、`engine/usage-*.ts`、`openai-quota.ts`、`gateway-probe.ts`、`network-proxy.ts`、`cc-switch.ts` |
| 远程 / SSH / agent | `src/main/server/*`、`src/main/rtc/*`、`src/main/ssh/*`、`src/agent/*` |
| 移动端 / PWA | `apps/mobile_flutter/lib/**`（screens / chat / ui / theme / session / notifications）；`apps/mobile_flutter/AGENTS.md`（材质与平台纪律） |
| PWA 连接态 / 草稿（G10–G12） | `lib/session/connection.dart`（退避与状态四态）；`lib/chat/draft_storage.dart`（debounce 落盘）；`lib/screens/chat.dart:300-320`（从不调 `conversations.open`，只按名订阅）；`lib/chat/tool_card.dart`（输出纪律，对照用） |
| 设计/交互约定（文字版） | `fastvibe-main/AGENTS.md`（UI / Theming / 模板章节） |
