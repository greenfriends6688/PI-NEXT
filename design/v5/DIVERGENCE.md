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
| 侧栏品牌比画板小一档（20/16） | 用户 2026-10-05 裁定「logo 别太大」；`.d-logo` 24→20、`.d-wordmark` 20→16 直接改在 system.css（画板随库同步变小），PWA 的 `.m-brand` 不在此裁定内 |
| 项目名称行高于画板档位 | 用户 2026-10-05 裁定「项目名字有点小」；`ProjectRow` 叠加产品类 `fork-proj-title`（fork-ui.css）把名称格抬到 fs-body/500/主色，分区头与分支行维持画板原档 |
| 会话子代理行 ↳ 并入标题行 | 用户 2026-10-05 报「重影」；虚拟行固定 48/58px，图标作为标题的兄弟内联节点会把整段 nowrap 标题挤到第二行、行内挤出第三行叠到下一行上（fork:session-row-ghost）。画板没有子代理行形态，这里按 D-02b「图标内联贴文字」并入标题行 |
| D-11 技能列表落成表格后保留筛选行 | fork:v5-d11-frame-a（2026-10-05）。画板帧 A 是「计数行 + 5 行表格」，没有检索；真机 87 个技能。搜索 + 作用域分段（画板 `.d-searchfield` / `.d-seg` 原类）放在计数行与表格之间；组开关（fork:group-switch G4）随之挪进筛选行——选了作用域才出现，作用于当前可见集合 |
| D-11 帧 A 的「看卸载到底删什么」弹层不落 | 产品没有卸载能力（`/api/skills` 只有 GET/PATCH/install/update/content），横幅只保留「关掉 ≠ 卸载」这半段真话；弹层与「信任该目录」按钮等有卸载 / 信任 API 后再落 |
| D-11 帧 A 的「加载策略」分节不落 | 画板画了「按需注入 / 自动更新」两个开关；产品的技能加载由 pi 的 `DefaultResourceLoader` 决定，没有这两个全局开关的数据面 |
| D-11 帧 A 计数行省掉「同名技能按目录优先级取一个」 | 同名解析发生在 pi 侧（`DefaultResourceLoader`），面板不做这个断言；计数行只报 总数 / 启用 / 关掉 |
| D-11 帧 A 状态列以「已启用」兜底 | 画板内置技能直接标「最新」；产品对未检查过更新的安装技能不能断言「最新」，显示「已启用」，检查后才切「最新 / 可更新到 x」 |
| D-11 帧 C 的「文件」pane 与「声明一致」徽章不落 | `/api/skills/content` 只回单文件，没有技能目录清单 API；frontmatter 声明与正文的并排比对也没有数据面。tabs 只有「渲染 / 原文」；token 估算同理不写假数 |
| D-11 帧 C 弹层的「在编辑器中打开」改成「在文件管理器中打开」 | 产品的既有动作是 `/api/files/reveal`（OS 访达定位 SKILL.md），没有接编辑器的通路 |
| D-11 表格描述列数据侧截断 60 字符 | 真实 SKILL.md 的 description 远长于画板手写短句，而库没有给 `.d-table` 定义钳位类（判据⑦：类必须有画板在用）；截断 + 原文进 title（60 字符 ≈ 中文两行，实测 100 字符在真机数据上仍铺 4-5 行） |
| D-11 移动端不走帧 A 表格 | 窄屏设置形态归 M-05 管（列表 + 内联详情），照 `PwBlock` 等基件的先例桌面/移动各一支；帧 C 弹层仅桌面挂载 |
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

---

## F · 有类但无产品宿主（2026-10-05 · 全量落地收尾）

> 与 E 的区别：E 是「这个类不该存在」，F 是「类合法、画板也用了，但产品里没有对应的宿主」。
> 逐条写清「宿主要长成什么样才能落」，否则下一轮会有人为了凑数硬挂一个装饰 DOM ——
> 那比缺一个类更糟：假 DOM 会让帧级清单变绿，而界面什么都没发生。
> 判定口径是 `scripts/v5-frame-regression.mjs`（帧）与 `design/v5/scripts/land-status.mjs`（类）。

| 类 | 出现处 | 判定 | 理由 / 复活条件 |
|---|---|---|---|
| `.d-drawer` | D-29 帧 F（规格台）、D-03e 帧 D（探索视图）、D-26b 帧 E（worktree 切换器） | **不落** | 覆盖式右缘抽屉（`position:absolute; width:360px; transform:translateX(100%)`）。产品右栏是常驻 flex 列（`ExplorationPane.tsx` 头注已写明换过去会把整块抽离布局），worktree 切换器是行内锚定的 `.d-pop`。**复活条件**：把探索视图或 worktree 切换器改成「压在 `.d-main` 上的覆盖层 + `.d-scrim`」——那是交互改版，不是换皮。移动形态的等价件 `m-drawer` 已落地（`AppShell` 会话抽屉）。 |
| `.d-sheet-title` | D-29 帧 F | **不落** | 桌面底部面板宿主不存在：桌面菜单一律 portal 浮层 / 模态，没有 `bottom:0` 升起的 sheet。移动等价件 `m-sheet-title` 已在 5 处落地（`PwaSheet` / `PwaDirectoryPicker` / `PwaComposerSheet` / `RightPanelsMobile` / `SessionSidebar` 删除确认）。 |
| `.m-select` | M-05 帧 B | **不落（画板给了二选一）** | 同一件事画板并排给了 ① `.m-select` 静态盒开自绘面板（写明「能力浮层里的模型 / 思考强度」）与 ② `.m-pickselect` 原生 `<select>`。产品的设置流一律走 ②；能力浮层是一行一个选项的单选行（`.m-setrow` + `.m-radio`），没有「再开一层」的静态盒。 |
| `.m-modal` | M-11 帧 B-3 | **不落（画板自相矛盾）** | 同一个「删除会话确认」两张板画了两种壳：M-04 帧 D 是 `.m-sheet`（底部面板），M-11 帧 B-3 是 `.m-modal`（居中模态）。产品按 M-04（该交互的主板）落地；预览灯箱那条路是原生 `<dialog>`（fixed + `::backdrop` + 焦点陷阱），`.m-modal` 的 `absolute/display` 会与它打架（同为 0-1-0，v5 库后加载会赢）。 |
| `.m-store-body` | M-09 帧 A | **不落（无一级页宿主）** | 帧 A 画的是「手机上的插件商店一级页」；产品里插件 / 技能 / MCP 目录都还在设置流内（`McpCatalog` 是 sheet，`PluginsConfig` / `SkillsConfig` 没有手机一级页）。`PwaPage` 已支持 `bodyClass="m-store-body"`，商店拆成一级页时一行接线。 |
| `.d-turn-end` / `.m-turn-end` | D-03c 帧 D / M-02 帧 B | **不落（产品主动删除）** | 用户裁定 2026-10：消息末尾的回合结束行（状态图标 + `stop` + 耗时 + `↑/↓` token + 金额 + 复制本轮统计）整行拿掉。同一批数字已经有三处宿主：身份行末尾的 `.d-plan-meta`（本轮耗时 · token）、输入框右下角的统计浮窗（会话累计）、思考块 / 工具卡各自的秒表。**复活条件**：只想保留 `length` / `aborted` 这类异常徽章而不要读数时，做成 `.d-badge` 单枚挂在身份行，不要恢复整行。 |

---

## G · 产品主动删掉的画板分节（2026-10-05 · fork:models-picker）

> 与 A–F 的区别：A–F 讲的是**类**的去留，这里讲的是**一整节界面**的去留：画板仍然画着，
> 产品里没有了。方向和 F 相反（F 是类没有宿主，这里是宿主没有类），所以单列一节。

| 画板分节 | 判定 | 理由 / 复活条件 |
|---|---|---|
| D-10「白名单 pattern」表 +「加一条 pattern」行 | **产品删除** | `enabledModels` 的 glob / 精确项 / `:thinking` 后缀是 `settings.json` 的**存法**，不是人要逐条操作的东西。同一意图（这些模型进聊天）现在只由 `ChatModelsPicker` 一个跨供应商弹层表达，供应商详情里的逐模型开关是它的单点版。失配横幅与 prune 按钮没删，搬进了 `SelectorVisibilitySection`（「在模型选择器里显示」那一节）。**复活条件**：要手写通配符时（例如 `provider/**` 才能覆盖带斜杠的模型 id），在选择器里加一个「高级：手写 pattern」折叠区，不要把它摊回概览列。 |
| D-10「匹配结果预览」 | **产品删除** | 它逐条复述上面那张表的合集，同一份数据讲两遍。选完之后「哪些模型在聊天里」由供应商行的 `N/M` 徽标（`providerBadgeLabel`）与逐模型开关回答。 |
| D-08 帧 C「成本档」表 | **产品删除** | 跨供应商的价格总表是模型编辑器里价格字段的索引；价格本来就在 `models.json`，编辑入口也一直在模型详情页（`CostTiersEditor` / `parseModelCostTiers` 未动）。**复活条件**：要批量改价时，按供应商分组，不要回到一张全局表。 |
| D-10 画板整体形态 | **待重画** | D-10 现在画的仍是三张 pattern 表。产品的「聊天里显示哪些模型」是弹层形态，画板还没有对应帧。下一轮画板要把这节改成「工具栏那枚 `list-checks` 钮 + 弹层里的供应商分组 / 全选 / 已在聊天中」，否则 `verify:boards` 的 D-10 对位会一直报缺口。 |
