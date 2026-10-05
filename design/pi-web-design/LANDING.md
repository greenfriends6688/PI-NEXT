# 落地契约 · LANDING.md

> **这份文档是「设计 → 代码」的唯一通道。常驻，不随任何一次改版作废。**
> 任何把画板落进产品的动作，无论人做还是 AI 做，都必须走这里写的过程。
> 画板侧的文件是 `README.md`（索引）/ `DESIGN-SPEC.md`（规范）/ `DIVERGENCE.md`（偏离台账）；
> 本文件是第四份，也是**唯一管「怎么落地」的那一份**。

---

## 0 · 为什么会有这份文档

曾经失败过一次，根因记在这里，避免重犯。

**第一次失败（2026-09-29 之前）**：设计稿和产品是**两套 DOM**。
画板自己用一套类名与内联样式画几何，产品用另一套（`chat-input-shell`、`file-viewer-*`、`config-*`…），
中间靠「桥接层」做映射。结果是**同一套视觉有两个来源**，画板改一次、产品要手动追一次，
追不上就漂移。已经发生过的活 bug：`fork-ui.css` 里写 `.fork-msg-actions`，组件渲染的却是 `.pw-msg-acts` ——
悬浮显现规则失效，消息动作行**永久透明**。这类 bug 编译器、单测、肉眼评审**全都看不见**。

**第二次失败（同期的「加类」路线）**：不换 DOM，只往产品现有 DOM 上**加** `pw-*` 类。
也不成立 —— `board.css` 假设了自己的结构：`.pw-step::before` 的竖线靠 `:first-child/:last-child` 判断首末行；
`.pw-step` 是 flex 行，把正文塞进去就变第二列；`.pw-acts{display:flex}` 只在 `.pw-row` 下定义，宿主是 `.pw-session` 就竖着堆。
**类名相同不等于结构相同。**

**攻克后的路线（现行，本文件就是它的成文化）**：**画板 DOM 即产品 DOM。**
产品 `app/layout.tsx` 直接把 `design/pi-web-design/assets/{tokens.css, board.css}` 原样 import 进运行时，
产品组件挂**画板原样的类名**，画板是 1440px 静态稿、产品只接数据与事件。

---

## 1 · 三条铁律

### 铁律一：第〇原则 —— 禁止截图模仿

**每个组件的替换只有一条路：打开定义它的画板 HTML，原样复制那段 DOM。**

- 类名、嵌套层级、`<i data-ico="…" data-size="…">`、状态类（`.is-on` / `.child` / `.running`）**一字不动**地搬进产品；
- 产品里只改两处：① 静态示例文本 → 真实数据；② 静态元素 → 可交互元素（`div` → `button` 时**保留原类名**，UA 归零在接线层做）；
- **禁止**看着截图/描述「照着做一个差不多的」。历史上所有翻车（错行、竖线断截、模型名压瘪）都出在这条路上。

验收同样**不看长得像不像**：截图只做存证。判定靠 **structdiff**（画板与产品 DOM 各自归一化成 `tag + pw-* + data-ico` 签名逐节点 diff）与**几何对数**（同一选择器在画板页与产品页各取 `getBoundingClientRect` + `getComputedStyle`，逐项对数）。

### 铁律二：`board.css` 是 `pw-*` 的唯一出处

- 新增 `pw-*` 类**必须先进 `assets/board.css`**，且**必须有一帧画板在用它** —— 两者缺一不可；
- **不许在产品 CSS（`app/*.css`）里另起同名 `pw-` 类**。产品侧只保留「静态元素 → 可交互元素」的 UA 归零、cursor、窄屏语义、滚动容器语义；
- 派生件的定义**只允许固化画板上已经画出来的几何**（把内联样式收成类），**不许在固化时顺手改设计**。要改设计，先改画板；
- 双向可查（用 `class="…"` 里的 `pw-` 词做集合比对）：**画板里用到的每个 `pw-` 类都必须在 `board.css` 有定义**；`board.css` 里定义但没有任何画板用到的类，逐个记进 `DIVERGENCE.md`，不许默默留着。

> **v2 例外（2026-10-04）**：`design/v2/` 是**重画的目标态**，有两套并列的令牌与组件：
> `web/{tokens.css, system.css}`（`w-` 前缀 / `--w-*`）与 `pwa/{tokens.css, system.css}`（`p-` 前缀 / `--p-*`）。
> 对它们，本条的“唯一出处”分别指 **两份各自的 system.css**。
>
> **两套与 `pw-*` 刻意不共用类名**：v1 的 `pw-*` 与 v2 的 `w-*` / `p-*` **同名不同义**
> （`pw-side` 是 v1 的侧栏几何，`w-side` 是 v2 的另一套）。
> 共用类名会把「一个类名两个来源」的老问题换个名字再来一次 —— 那是 2026-09-29 翻车的根因。
> 产品按形态挂其中一套（`html[data-form="pwa"]`），不同时生效。

> 存量欠账不追溯：`app/globals.css` / `app/fork-ui.css` / `app/settings.css` 里仍重定义着二十多个同名 `pw-` 类（重构前的历史拷贝），清理属产品侧、登记在 `DIVERGENCE.md`。在清完之前，本条约束的是**新类**。

### 铁律三：画板帧必须直接写产品那套类名

画板帧**不许用内联样式另画一套几何**。画板里出现的每个颜色、字号、间距、圆角、时长都必须能在 `assets/tokens.css` 找到；
组件几何一律用 `board.css` 的 `pw-*` 类表达。理由：内联样式另画的几何**没有任何机制能验证**，写完即漂移。

（唯一例外：`app/error.tsx` / `app/global-error.tsx` 这类根级错误页与独立 HTML 文档，`var()` 可能解空。）

---

## 2 · 落地四步法（每个组件都走这四步）

### ① 抄 DOM 原文

打开定义该组件的画板 HTML，找到那段片段，**原样复制**。类名、层级、`data-ico`、状态类全部保留。

### ② 接数据与事件

- 状态映射：产品布尔 → 画板状态类（`is-on` / `is-open` / `child` / `running`）；
- 事件**不进 CSS**：hover / focus 行为留在 CSS（画板已有），点击 / 键盘在 React；
- **浮窗一律考虑裁切与翻转**：宿主链上有 overflow 的（滚动容器 / composer），要么 portal + `fixed`（`PortalDropdown` 模式），要么确认 `overflow-y: visible` 链路（composer 模式）；下方放不下（< 260px）才朝上。

### ③ 产品侧 CSS 纪律

- 画板值**一个都不重复写**；`fork-ui.css` 末尾接线块只做 UA 归零（button/input 的 border/background/font）+ cursor + 窄屏语义；
- 需要覆盖画板时用 **0-2-0 双类选择器**（如 `.chat-input-shell.pw-composer`），并在注释里写明**为什么覆盖、对应哪条台账**；
- 改完**顺手删 stale 规则** —— DOM 挪了 CSS 还在，是已经发生过的形态（`explorer-column` 负 margin 把树列顶出面板体）。

### ④ 验收六件套（全过才算完）

1. `node_modules/.bin/tsc --noEmit` 0 错 · `npm run lint` 0 错 · `npm test` 全绿（**源码守卫测试改成断言新结构**，不是删）；
2. **structdiff**：画板 vs 产品 DOM 签名 diff —— 组件级 0 结构偏差（产品状态类除外）；
3. **几何对数**：`npm run verify:boards`，关键选择器 board vs app 并排对数（1440×900 桌面 + 390×800 移动端）；
4. **浮窗裁切审计**：本批触发的每个浮窗，hover / 点开，沿祖先链查 overflow 裁切 + 截图 —— 0 处裁切；
5. `npm run check:design`（style-literals + motion-tokens + icons + check-boards + check-align）退出码全 0；
6. 改了任何前景 / 背景色：`npm run check:contrast`（需服务在 30141）；截图存 `docs/screenshots/`。

---

## 3 · 触发口令（用户说一句话 → 执行什么）

用户说下面任意一句，即触发对应流程。**不需要用户再说第二遍。**

| 用户说 | 执行 |
|---|---|
| **「按设计落地」/「启动改版」/「把画板落进去」** | 跑 `npm run design:status` 拿 `designed` 清单 → 按批次顺序逐项走 §2 四步法 → 每项完成后更新 `manifest.json` 的 `status` → 全部 `designed` 归零后跑 §2④ 六件套 |
| **「只落地 XX」**（点名画板或功能） | 只做该项，其余不动；同样走四步法 + 六件套 |
| **「按 v2 设计落地」** | 同「按设计落地」，但目标态是 `design/v2/`：`w-*`（Web）与 `p-*`（PWA）两套。逐项从 v1 组件迁到 v2 组件，走同一套四步法与六件套 |
| **「画板改了，同步产品」** | 先跑 `npm run design:status` 找出受影响的组件 → 对每项做 structdiff，列出真实偏差 → 只改有偏差的 |
| **「设计检查」/「画板与产品对得上吗」** | 跑 `npm run check:design` + `npm run verify:boards` + `npm run design:status`，只报告不修改 |
| **「新增画板 XX」** | 先确认它不在 `README.md` 的「待补画板」里 → 编号取未用的 → 只从 `tokens.css` 取值、只用 `board.css` 已有类（要新类先加进 `board.css`）→ 加进 `manifest.json` → 跑 `check-boards` + `check-demo` |

**执行者的硬性动作顺序**（缺一步即返工）：

```
1. 读 LANDING.md（本文件）          ← 不许跳
2. npm run design:status             ← 拿清单，不凭记忆
3. 逐项：抄 DOM → 接数据 → CSS 纪律 → 六件套
4. 更新 manifest.json 的 status
5. 提交（commit message: refactor(skin): <画板号> <名称>）
```

---

## 4 · 陷阱清单（每一条都真实翻过车）

| 陷阱 | 事故 | 对策 |
|---|---|---|
| 画板容器的 `overflow: hidden` | `.pw-composer` 裁圆角用的 hidden 把向上弹的环浮窗 / 下拉 / `@` 菜单整张裁掉 | 浮层宿主竖向必须 `overflow-y: visible`；横向可保留 `clip` |
| 左缘锚定的浮窗 | 320 宽下拉右缘锚定在左侧组触发钮上，探出卡片左缘 151px 被 `overflow-x: clip` 裁掉 | 左侧组浮窗一律**左缘锚定**；右侧组右缘锚定 |
| `min-width: 0` 链 | 逐层 `min-width:0` 让 flex 把模型芯片压瘪成「D…」 | 芯片按内容定宽 `flex: 0 0 auto`；真放不下走窄屏折叠形态（容器实测 < 700px），不靠芯片自己缩 |
| 折叠判据用视口断点 | 1440 视口开右栏后聊天列只剩 ~352px，视口断点不感知，发送钮被顶出裁掉 | 折叠判据 = 视口断点 **或** ResizeObserver 实测容器宽 |
| 挪 DOM 留 stale CSS | 标签行挪出 body 后，`explorer-column` 的负 margin 把树列顶出面板体 | 每次结构替换，同批 `grep` 旧位置专属规则并删除 |
| 虚拟列表约束 | 绝对定位容器内部不能插行 | 插在容器**外的普通流位置**，列表槽位计算不受影响 |
| 内联样式压 CSS | ModelSelector 根节点 inline `minWidth: 0` 压过任何 CSS 保底 | 改组件内联本身，不要试图用 CSS 赢 inline |
| 源码守卫测试 | 换结构后旧断言失效 | 断言**新的等价约束**（真正的不变量），不是删测试 |
| SettingsPanel 纪律 | 该文件有「零 inline style」守卫 | 设置类改动全部走类 |
| 宽正则改 JSX | `[^}]*` 近似匹配曾弄坏 12 处 | 用精确锚点或 python 脚本 + 唯一性断言 |
| dev/prod 共用 `.next` | 直接混用报 `Module factory is not available` 假故障 | 切换只走 `npm run dev:clean` / `npm run prod`；起服前 `lsof -nP -iTCP:30141` 复用健康进程 |
| **截图模仿** | 全部历史错行 / 错位的根因 | §1 铁律一；验收用 structdiff + 对数，不用肉眼 |

---

## 5 · 工具速查

| 命令 | 作用 | 判定 |
|---|---|---|
| `npm run design:status` | 读源码推导改版清单（v1 体系）：每张画板的未落地类、spec 覆盖、`pw-*` 双向可查 | `designed` 项必须为 0 才算改版完成 |
| `node scripts/check-v2.mjs` | v2 两套体系的静态校验：图标 / emoji / 未定义令牌 / **类名前缀混用** | 退出码 0 |
| `npm run check:design` | style-literals + motion-tokens + icons + check-boards + check-align | 退出码全 0 |
| `npm run verify:boards` | live 几何对位（`board-diff-all`） | 0 项不符 |
| `npm run verify:boards:seeded` | 同上，CI 用（自建临时 agent 目录，不碰用户数据） | 0 项不符 |
| `npm run check:contrast` | 9 组组合 × light/dark（需服务在 30141） | 正文 4.5 / dim 3.0 |
| `node design/pi-web-design/scripts/check-demo.mjs` | 画板声明的交互件点击后真有状态迁移 | 0 处失效 |
| `node design/pi-web-design/scripts/render-boards.mjs <dir>` | 逐张出 PNG | 基线存档 |
| `.scratch/structdiff.mjs`（模式脚本） | DOM 签名逐节点 diff | 0 结构偏差 |
| `.scratch/popover-audit.mjs`（模式脚本） | 浮窗裁切审计 | 0 处裁切 |
| `npm test` / `npm run lint` / `tsc --noEmit` | 全量 | 全绿 |

---

## 6 · 裁定索引（不再重议）

以下是用户已经裁定过的结论，落地时**直接执行，不再询问**：

- 本产品**没有登录体系**（`PI_WEB_PASSWORD` 未设时 `/login` 直接 302）。
- 用量与上下文占用**收进上下文环浮窗**，输入框下方**不再有第二条常驻横条**。
- **移动端与桌面完全同构**：不新增底部控件条、不新增底部弹层（2026-09-29；2026-10-04 提出异构方案后当日撤回，维持原裁定）。
- 主题**只有** light / dark / auto（`lib/theme.ts` 的 `THEME_OPTIONS` 是唯一清单）。
- 目录选择器**系统原生优先**，自绘浏览器是降级态。
- 会话分支（git-fork）≠ Git 分支（git-branch），是两个功能。
- 扩展状态在**右上角 mono 胶囊浮标**。
- 全套色相 **≤ 5**（强调 + 4 语义）；圆角上限 6；字阶五档。
- **一套 token 真值，两套画板**（Web / PWA 只在版式组合上不同，见 `docs/design-v2-plan-2026-10-04.md` §0）。

---

## 7 · 新画板检查单（新增画板时逐条勾）

- [ ] 编号未被占用（Web 00–69 / PWA 70–89 / 跨端 90–99）
- [ ] 头部有编号、名称、一句话说明、三个标签（页面 / 组件 / 状态）
- [ ] 末尾有「这一张在定什么」的注记
- [ ] 所有颜色 / 字号 / 间距 / 圆角 / 时长都能在 `assets/tokens.css` 找到
- [ ] 图标全走 `assets/icons.js` 的 `data-ico`，**零 emoji、零图片素材**
- [ ] 用到的 `pw-*` 类**全部已在 `board.css` 定义**；需要新类就先进 `board.css`
- [ ] **没有用内联样式另画几何**（铁律三）
- [ ] 交互件加了 `data-demo-*` 属性（可点）
- [ ] 已加进 `manifest.json`
- [ ] `node scripts/check-boards.mjs` + `check-align.mjs` + `check-demo.mjs` 全过
- [ ] 文案用真实内容（产品 i18n 原文可直接用），不用 lorem ipsum
- [ ] 不加 `DESIGN-SPEC.md §4` 未列的页面或功能；缺的写进 `README.md` 的「待补画板」
