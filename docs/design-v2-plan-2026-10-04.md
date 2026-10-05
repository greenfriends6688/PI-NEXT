# 设计体系 v2 计划 · 一套真值 / 两套画板 / 一个落地口

日期：2026-10-04 · 基准：`design/pi-web-design/`（30 张画板 + tokens.css + board.css + icons.js + 4 份文档 + 3 个脚本）
输入：`docs/ref-feature-matrix-2026-10-04.md`（ZCode / Aether 对比与缺口表）
落地契约：`design/pi-web-design/LANDING.md`（**那个「口」，常驻，随本计划一起生效**）

---

## 0 · 一句话

**不新建第二套设计系统。** 把现有的一套拆成「一个真值核心 + 两套画板」：
`assets/{tokens.css, board.css, icons.js}` 是**唯一真值**，Web 画板与 PWA 画板都只从它取值；
两套画板的差别**只在版式组合**（桌面三栏 vs 手机单栏 + 覆盖层），**不在颜色/字号/圆角/控件/动效**。

理由（这是本次最重要的一个判断，也是「上次翻车」的直接教训）：

> 上次落不了地的根因是**同一个视觉有两个来源**（画板 `board.css` 与产品 `globals.css` 各自定义同名 `pw-*`）。
> 如果这次「两套设计体系」做成两套 token / 两套基元，就是把那个错误放大一倍 —— 两个来源变四个来源，
> 且两套之间还会互相漂移。所以「两套」只能落在**画板层**，不能落在**真值层**。

---

## 1 · 目录与编号（零文件搬迁）

```
design/pi-web-design/
  README.md            索引：两套画板导航 + 对应表
  DESIGN-SPEC.md       规范（v2：新增 §PWA 章、§缺口功能章）
  DIVERGENCE.md        偏离台账（继续用）
  LANDING.md           【新】落地契约 = 那个「口」
  index.html           导航首页（v2：两组分栏）
  assets/
    tokens.css         【唯一真值】Token（两端共用，不改）
    board.css          【唯一真值】pw-* 基元（两端共用，只增不改）
    icons.js           【唯一真值】图标集（两端共用）
    board-demo.js      【新】画板交互引擎（~120 行，见 §3）
  scripts/
    check-boards.mjs   （沿用）
    check-align.mjs    （沿用）
    render-boards.mjs  （沿用）
    check-demo.mjs     【新】可点击性冒烟：每张画板的交互件真能点
  00-…-69-*.html       Web 画板（桌面，1440×900）
  70-…-89-*.html       PWA 画板（手机 390×844 + 平板 1024×768）
  90-…-99-*.html       跨端（组件原子、动效、Token）
```

**编号是唯一的分组手段**：`00–69` Web / `70–89` PWA / `90–99` 跨端。
不建 `boards-web/` `boards-pwa/` 子目录 —— 那会打断 `check-boards.mjs`、`scripts/board-specs/*`、
`app/layout.tsx` 的引用路径，是纯粹的搬迁成本，换不来任何东西。

**现有 30 张画板一张不重画、不重编号**，全部归入 Web 组。新增画板从 `63` 起（Web）与 `70` 起（PWA）。

---

## 2 · 两套画板的分工

### 2.1 Web 组（00–69，桌面 1440×900）

| 新增编号 | 画板 | 来源缺口 | 说明 |
|---|---|---|---|
| 63 | `63-global-search.html` | ZCode Command Center | **P0** 全局搜索浮层：三类结果（命令/会话/文件）+ scope tab + 搜索历史 + 命中片段 |
| 64 | `64-device-preview.html` | ZCode 模拟器语义改写 | **P0** 设备预览面板：机型预设（iPhone 15/16 Pro Max/SE、Pixel、Galaxy Tab）+ 旋转 + 缩放 + 截图 + 刷新 + 在 PWA 画板与产品页之间切换 |
| 65 | `65-extension-slots.html` | Aether slot 体系 | **P1** 扩展挂载点声明表 + 每个 slot 一帧（`app.overlay` / `chat.top` / `chat.composer.top` / `chat.list.start/end` / `drawer.header/footer` / `settings.hub`） |
| 66 | `66-plan-timeline.html` | ZCode workflow（只取可视化） | **P3** 多步计划进度时间线（不引入工作流引擎） |

**改到现有画板**（不新增编号）：

| 画板 | 补什么 |
|---|---|
| 44 定时任务 | 运行历史、状态筛选、模板目录网格、失败/错过一次的表达 |
| 41 模型 | 模型元数据编辑（模态/推理档位）、拖拽排序、模板选择器 |
| 45 用量 | 热力图、工具用量、错误率卡、TTFT 卡 |
| 31 浏览器 | 元素拾取、响应式视口预设（与 64 同一套件） |
| 43 插件 | 商店形态（卡片网格 + 详情整页 + 分类分组） |
| 20 输入框 | 队列暂停/恢复横幅、选中代码 → 引用 chip |
| 01 工作台 | 拖会话到窗格 |
| 53 转录辅助 | 单条消息统计浮窗 |
| 05 动效 | 流式 CJK 边界切分（新增一项可播放动效） |

### 2.2 PWA 组（70–89，手机 390×844 / 平板 1024×768）

**这是本次工作量的大头，也是现状最薄的一面**（现在只有 `60-mobile-pwa.html` 一张，是「断点表 + 局部件」，不是完整页面集）。

PWA 组的定位：**同一套 `pw-*` 基元，在手机视口下的完整页面集**。不是另一套设计语言。

| 编号 | 画板 | 内容 |
|---|---|---|
| 70 | `70-pwa-shell.html` | **可点原型**：抽屉推拉 + 遮罩收起 + 顶部弹层 + 项目/聊天页签 + 发送追加。已出，`check-demo` 6 个交互件 0 失效 |
| 71 | `71-pwa-transcript.html` | 消息流：用户气泡、助手分组、过程时间轴（手机版折叠）、工具卡、代码块横向滚动、表格横滚、附件网格、流式 |
| 72 | `72-pwa-composer.html` | 输入框：1–5 行自适应、附件、**顶部下拉形态的模型/思考/`@`/`/` 菜单**、上下文环、发送/停止、队列面板 |
| 73 | `73-pwa-sessions.html` | 会话抽屉整页：搜索、会话行三态、项目分组、分段、长按菜单、项目切换器、工作区切换 |
| 74 | `74-pwa-settings.html` | 设置：hub 卡片分组 → 分节二级页（手机形态）、分节选择器下拉、控件（开关/滑块/输入）手机尺寸 |
| 75 | `75-pwa-files.html` | 文件树（整页）+ 查看器（源码/图片/Markdown）+ 覆盖顶栏的动作工具条 |
| 76 | `76-pwa-terminal-browser.html` | 终端（键盘工具条：Ctrl/Esc/方向键/Tab）、浏览器（地址栏 + 设备视口） |
| 77 | `77-pwa-install.html` | PWA 安装：安装提示（分平台：iOS Safari / Android Chrome / 桌面 Chrome）、standalone 首启、更新提示、离线态、信任横幅 |
| 78 | `78-pwa-gestures.html` | 手势与触控：下拉刷新、双指缩放代码、长按菜单、侧滑返回、触控目标尺寸表 |
| 79 | `79-pwa-states.html` | 系统态：空态、加载、错误、断网、权限请求、通知、Toast |

**PWA 组的裁定（2026-10-04 复核维持原裁定）**：**与桌面完全同构**。

| 变的 | 不变的 |
|---|---|
| 宽度（抽屉 272）、触控目标 36、滚动条 6px、安全区 | 导航范式、控件、弹层位置、token / 字阶 / 圆角 / 动效 / 图标 |

异构方案（底部 tab bar / 二级页推送 / 底部动作面板）已于 2026-10-04 提出并**当日撤回**，
过程与留下的产物记在 `DESIGN-SPEC.md` §3.6 与 `DIVERGENCE.md` 开头。

---

## 3 · 「可点击的真实 demo」（board-demo.js）

现状：30 张画板里只有 `00-tokens` 的按钮四态与 `05-motion` 的动效是真在动的，其余是**静态帧并排**。
用户要的「具体交互效果 + 可点击的真实 demo」= 画板里的交互件**真能点、真有状态迁移**。

做法（懒而通用，**不逐张手写 JS**）：新增 `assets/board-demo.js`，用属性声明式接线：

```html
<!-- 页签：点一个，切一个 -->
<div class="pw-seg" data-demo-tabs>
  <button class="pw-row is-on" data-demo-tab="a">项目</button>
  <button class="pw-row" data-demo-tab="b">聊天</button>
</div>
<section data-demo-pane="a">…</section>
<section data-demo-pane="b" hidden>…</section>

<!-- 浮层：点触发钮开合，点外部关闭，Esc 关闭 -->
<button class="pw-iconbtn" data-demo-open="menu-1">…</button>
<div class="pw-pop" data-demo-pop="menu-1" hidden>…</div>

<!-- 抽屉：推拉 -->
<button data-demo-drawer="open">…</button>

<!-- 模拟发送：往消息流追加一条（demo 专用，画板 01/71 用） -->
<button class="pw-send" data-demo-append="#transcript" data-demo-from="#demo-script">…</button>
```

引擎职责（约 120 行）：tab 切换、popover 开合（含外部点击/Esc/翻转）、抽屉推拉、追加消息、滚动跟随。
**每一张画板都可以只加属性就变成可点的**，不需要各自写脚本。

配套门禁 `scripts/check-demo.mjs`：对每张画板里声明了 `data-demo-*` 的触发钮做一次真实点击，
断言目标元素可见性发生迁移。防止「写了属性但没接上」（这正是上次 `fork-msg-actions` → `pw-msg-acts` 那类事故的形态）。

---

## 4 · `design:status` —— 让「一句话启动全部改版」成立

现在的对位是**人工一板一 spec**（`scripts/board-specs/*.mjs`，27/30 覆盖）。
「我说一句话你就启动所有改版」要成立，缺的是一份**不靠人记的改版清单**。

**不做手写的 `manifest.json`。** 手写的对应表会和代码漂移（那正是上次失败的形态），
而且它记的东西**全部可以从源码推导**。新增 `scripts/design-status.mjs`（`npm run design:status`），从四路扫描推导：

| 数据 | 来源 |
|---|---|
| 画板清单与分组 | `design/pi-web-design/*.html`，编号 `00–69` Web / `70–89` PWA / `90–99` 跨端 |
| live 对位覆盖 | `scripts/board-specs/*.mjs` 里的 `board: "…"` |
| `pw-*` 双向可查（判据⑦） | 画板的 `class="…"` × `board.css` 的 `.pw-*` 选择器 |
| **宿主映射与未落地队列** | 产品 `components/**` `app/**` 里出现的 `pw-*` 词 |

输出四件事：

1. **每张画板的未落地类数** —— 排掉两类白名单之后才是真欠账：
   - **画板家具**（`pw-frame*` / `pw-anim-*` / `pw-phone*` …）是画板自己搭的展示框，**永远不会进产品**；
   - **登记不改**（`pw-sub*` 子代理卡、`pw-git` 泳道）有 `DIVERGENCE.md` 背书。
2. **`board.css` 里定义了但没有任何画板在用的类** —— 双向可查的反向，逐条该清或该补画板；
3. **产品用了但 `board.css` 没定义的 `pw-` 类** —— 历史拷贝与拼写漂移（`pw-branch-*` / `pw-search-*` 这 11 个是真发现）；
4. **有画板但无 live 对位 spec 的清单**。

`--json` 给 AI / CI 读；默认退出码只在**错误**（画板用了 `board.css` 没定义的类、spec 指向不存在的画板）时为 1。

> 这份报告**就是改版清单**。落地时先跑它拿清单，不凭记忆 —— 这一条已写进 `LANDING.md` 的硬性动作顺序。

**首次运行的真实结果（2026-10-04）**：30 张画板 / 27 有 spec / `board.css` 259 个 `pw-` 类；
**21 个真未落地类分布在 9 张画板**（01 四个布局容器、12 `pw-audio`、20 `pw-tok-cmd`、30 四个、40 `pw-snav-close`、53 两个、54 四个、60 四个、62 一个）；
**19 个 `board.css` 死类**（含已裁定删除的 `pw-login*` 与 `pw-mobile-bar/actions`）；
**11 个产品侧漂移类**（`pw-branch-*` / `pw-search-*` / `pw-tasklist-text` / `pw-icons-manual`）。
这份名单直接就是 D2 的输入。

---

## 5 · 批次（每批一个可独立 revert 的 commit）

| 批次 | 内容 | 交付 |
|---|---|---|
| **D0** | 地基：`LANDING.md` + `design-status.mjs` + `design:status` npm 脚本 + `board-demo.js` + `check-demo.mjs` | 「口」生效，改版清单可机读 |
| **D1** | Web 缺口 P0：`63-global-search` + `64-device-preview` | 两张新画板 + 可点 demo |
| **D2** | Web 现有画板补形态：44 / 41 / 45 / 31 / 43 / 20 / 01 / 53 / 05 | 九张画板增补帧 |
| **D3** | PWA 组：70（**已出**）+ 71 / 72 / 73（转录 / 输入框 / 会话抽屉） | PWA 核心四张 |
| **D4** | PWA 组：74 / 75 / 76 / 77 / 78 / 79 | PWA 其余六张 |
| **D5** | Web 组落地：按 manifest 把 `designed` 项接进产品（走四步法 + 验收六件套） | 代码 |
| **D6** | PWA 组落地：同上（含 `app/pwa-settings.css` 与断点对齐） | 代码 |

D0 是硬前置（没有它，「一句话启动」无从谈起）。D1–D4 是设计，D5–D6 是落地。

---

## 6 · 验收

沿用 `LANDING.md` 的**验收六件套**（tsc / lint / test 全绿 + structdiff 0 偏差 + 几何对数 + 浮窗裁切审计 + `check:design` + `check-contrast`），
新增两条：

- `npm run design:status` —— 未落地类必须为 0 才算「全部改版完成」；
- `node design/pi-web-design/scripts/check-demo.mjs` —— 每张画板声明的交互件点击后必须真有状态迁移。

---

## 7 · 明确不做

- **不做第二套 token / 第二套 `pw-*` 基元**（本计划的核心禁令，理由见 §0）。
- 不搬迁现有画板文件（零文件搬迁）。
- 不重画现有 30 张画板（只增补帧）。
- 不引入工作流引擎、电脑控制、资源仪表盘（见对比矩阵 §3 的「不做」行）。
- **PWA 不引入异构范式**：不新增底部控件条 / 底部弹层（2026-10-04 复核维持 2026-09-29 的同构裁定）。
- **不改桌面**：PWA 只在 70–79，桌面画板与 `AppShell` 桌面分支一字不动。
