# 偏离台账 · DIVERGENCE.md（v5）

> 三类条目：**采纳**（从参考项目抄了什么，换成了什么）、**拒绝**（为什么不抄）、
> **登记不改**（本仓有意与参考项目不同的地方）。
> 每条都要写清「为什么」，否则下一轮就会有人「顺手统一一下」。

---

## A · BoardUI（`BoardUI/boardui`，MIT）

> 2026-10-04 实读。仓库地址 https://github.com/BoardUI/boardui.git
> 形态：Tailwind v4 + React Aria Components + 400+ 语义 token，69 个自由组件，
> 自称「agentic interfaces 的设计系统」，含 `agent-chat` / `agent-log` / `agent-thinking` /
> `composer-loader` / `settings-*` / `notification-center` / `data-grid` / `landing`。

### A1 · 拒绝整体照搬（实现层）

| 项 | 结论 | 理由 |
|---|---|---|
| Tailwind v4 工具类 | **不引入** | 本仓没有 Tailwind（`tailwind.config.ts` 已删）。引入 = 多一套样式来源，正是「改一处只对一半」的来源。 |
| React Aria Components | **不引入** | 交互语义（浮层、菜单、列表框）我们已有 React 侧实现；为一套设计系统再压一层 ARIA 抽象，收益不抵依赖与心智成本。 |
| 它的 400+ token | **不引入** | V5 的 `base.css` 已经把「角色值 / 形态值」分开，这是我们要的结构；再叠一套只会重演双真值。 |
| 它的类名（`bui-*` 等） | **不引入** | 一个类名一个来源。引入它的类名等于把它的真值搬进来。 |

### A2 · 采纳（抄**规格**，用本仓自己的类重写）

| 采纳了什么 | 来源 | 在 V5 的落点 |
|---|---|---|
| **文字流光**（等待中文案扫过一道高光） | `.agent-progress-loading-text` | `base.css` `@keyframes nx-shimmer` + `.d-shimmer` / D-21 帧 A |
| **数字淡入**（值一变淡一下） | `number-fade` 220ms | `nx-num` + `.d-num`（计数/余额/token） |
| **翻卡**（0→-90 落下 + 90→-9→4→0 弹回，末尾过冲） | `flap-fall` / `flap-rise` | `nx-flap-fall/rise` + `.d-flap.is-fall/.is-rise`（推理档切换） |
| **行展开/收起**（grid 轨道 `0fr↔1fr`，位移 400ms、淡入 240ms 走更短的钟） | `row-grow-in` / `row-slide-out` | `nx-row-*` + `.d-row-x-track` + `.d-row-x.is-open/.is-closing` |
| **标签上下交换** | `label-out/in` | `nx-label-out/in` + `.d-label-out/.d-label-in`（滚动数字换字） |
| **对勾描边**（`pathLength=1`，与分辨率无关） | `check-draw` | `nx-check-draw` + `.d-check-draw path` |
| **图表入场**（柱条自基线长起、折线 clip 揭开、格子弹入） | `bar-rise` / `chart-reveal` / `cell-pop` | 同名 keyframes + `.d-bar-rise` / `.d-chart-reveal` / `.d-cell-pop` |
| **思考指示器四变体**（波 / 绕心 / 星 / 彗星） | `agent-thinking` | `.d-think-dots.wave/.spin`、`.d-think-stars`、`.d-think-comet`（D-21 帧 C） |
| **输入框环绕光带** | `composer-loader` | `.d-loader` + `.d-loader-svg`（`pathLength=100` 的 dash 绕 pill 一圈） |
| **徽标流光** | `badge-shimmer` | `nx-badge-shimmer` + `.d-badge-shimmer` |
| **「减弱动效一律停终态」的纪律** | 它每条动画都配 reduced-motion | V5 写进铁律，且 D-21 有专门注记 |

### A3 · 采纳（抄**结构**，形态自己定）

| 结构 | 来源 | V5 落点 |
|---|---|---|
| 设置分节的「行 + 右侧控件」形态 | `settings-rows` | `.d-set-row` / `.d-set-row-t` / `.d-set-row-s` / `.d-grow-last` |
| 通知中心（未读高亮 + 图标 + 空态） | `notification-center` | `.d-notice` / `.d-notice-ico` / `.d-notice.unread` |
| 数据表原语（表头/行/hover/选中） | `data-table` | `.d-table` |
| 分页条 | `data-table` 内联 | `.d-pagebar` / `.d-page.is-on` |
| 公告条 | `announcement` | `.d-announce` |
| 面包屑 | `breadcrumb` | `.d-crumb` |
| 拖拽投放区 | `file-upload` | `.d-drop` / `.d-drop.over` |

### A4 · 未采纳（想清楚了但不做）

| 候选 | 结论 | 理由 |
|---|---|---|
| 日期选择器 / 日程 / input-otp / 轮播 | **不做** | 本产品没有这些使用场景；加进来就是死类（死类是下一次漂移的种子）。 |
| 数据大屏 / 医疗示例卡 | **不做** | 那是它们给别的行业做样例，不是 agent 界面。 |
| 落地页 hero 光束 | **不做** | 本仓是工作台，不是官网。 |
| 徽章流光用在主按钮上 | **不做** | 我们只有一个主行动（发送），常驻流光会一直在动，反而降级了「运行中」的信号强度。 |

---

## B · ZCode（`pi参考项目/ZCode-main`）

| 采纳/参考 | 落点 |
|---|---|
| ⌘K 命令中心的三类聚合与前缀语法 | D-16（画板）→ 未来 `CommandCenter` |
| 插件商店的「目录 → 详情整页 → 安装」三段式 | D-10 |
| Automations 的模板目录 + **错峰执行 OffPeak** 两个概念 | D-12（本仓已有 4 调度模式，只补模板与错峰） |
| Saved workflows 的「带参表单 + 运行历史 + 提升为全局」 | D-19 |
| 输入框的 Lexical 编辑器内核 | **不采纳**：`textarea` + 自管引用已够；换编辑器内核的成本大于收益 |
| 电脑控制 CUA | **不做**：浏览器形态拿不到桌面输入注入，且需整套可撤销权限模型 |

## C · Aether（`pi参考项目/Aether-main`）

| 采纳/参考 | 落点 |
|---|---|
| 起步卡点击后**填入完整指令**（不是只给标题） | D-01（本轮最值的一条） |
| 能力 chip 归一化（技能/MCP/模式同一种 chip） | D-04 |
| Plus 分离形变（有草稿时 plus 浮起） | M-03（`m-composer-wrap.separated`） |
| 统计面板的「速度/延迟」卡片 | **不做**：`.jsonl` 没有样本，不造数据 |
| 扩展插槽体系（12 槽位 + 5 宿主） | D-20 声明 8 个可注入点（不做 replace/hide 宿主，太重） |
| `compacting` / `naming` 独立模型 | **暂不做**：先确认 SDK 是否支持 compaction 模型指定 |

---

## D · 登记不改（本仓有意不同）

| 项 | 登记 |
|---|---|
| Git 图泳道自绘 SVG | 已登记例外，不改成 lucide（lucide 没有泳道概念） |
| 子代理以工具卡徽标呈现 | 不单独设计一套子代理面板 |
| 用量图表零依赖手写 | 不引入 recharts（Electron/Linux 下模块初始化会崩） |
| PWA 与桌面**导航范式同构** | 不新增底部 tab bar / 二级页推送（2026-09-29 与 2026-10-04 两次裁定） |
| 主题只有 light / dark / auto | 不加更多主题；皮肤工作室走基色/壁纸参数，不走新主题名 |
---

## E · 拒绝新增的类（2026-10-04 · 补板过程中累计）

> 子任务与自查都会提出「缺一个类」，逐条判过之后记在这里。**能复用的一律不建** ——
> 重复的类比缺一个类更糟：两个名字做同一件事，下次改动只改一处就又会漂。

| 提过的类 | 判定 | 用什么代替 |
|---|---|---|
| `.d-switch-row`（开关行） | **不建** | `.d-set-row` + `.d-grow-last` + `.d-switch`，本来就是这个结构 |
| `.d-kvpair-row`（键值对增删） | **暂不建** | `.d-table`；真要频繁增删时再抽 |
| `.d-modal-box.tall`（高度档） | **不建** | 改成**限高 + 内部滚动**，一个高度档解决不了长内容 |
| `.d-badge.trust`（信任徽章） | **不建** | `.d-badge.ok` / `.bad` + `shield-*` 图标，语义够用 |
| `.d-badge-shimmer`（徽标流光） | **不做** | 主行动常驻流光会一直动，反而降级「运行中」的信号强度 |
| `.d-ripple`（涟漪） | **不做** | 与「单一曲线路线」冲突；按压缩放已足够表达触达 |
| `.d-step-dot` / `.d-device-zoom` / `.d-device-shot` | **不建** | 已有等价件：`.d-plan-dot` / `.d-device-presets` / `.d-store-card` |
| `.d-trow.l3`（三级缩进） | **建了** | 深目录确实要用 —— 例外说明：不是重复件 |
| `.m-trow` 层级变体 | **不建** | 手机端定为「一屏一层」，缩进值不出现 |
| `.d-panel-foot` | **不建** | 终端有 `.d-terminfo`，Git 顶部有 `.d-subhead`，暂无第二处消费者 |
