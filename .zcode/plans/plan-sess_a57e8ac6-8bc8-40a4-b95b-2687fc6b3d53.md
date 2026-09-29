# 撰写《换肤计划》文档（组件矩阵版）

## 铁律（文档第 0 原则，写在最显眼处）

**禁止截图模仿。** 每个组件的替换只有一条路：打开定义它的画板 HTML → **原样复制那段 DOM 结构**（类名、层级、`<i data-ico>` 一字不动）→ 把数据与事件接上去 → 产品侧 CSS 只做 UA 归零。验收不看"长得像不像"，用 structdiff（画板 vs 产品 DOM 签名逐节点 diff）+ 几何量测（getBoundingClientRect 对数）判定。

## 交付物

**`docs/design-skin-swap-plan-2026-09-29.md`**（中文，预计 700-900 行）。本次执行只写文档，不改代码。

## 文档结构（八章）

### 第 1 章 · 定位与两套编号
接替 09-28 计划（PR-01~28 已落地，PR-13 冲突已于第十轮裁定）；路线已演进为"画板组件直接引用 + DOM 替换"。新批次编号 **SW-00~SW-17**，与旧 PR-NN 并存对照表。

### 第 2 章 · 组件清单矩阵（文档主体，50+ 项逐行）
按 board.css 组件族分组的大表，**每行一个组件类型**，列：`组件（画板类名族）· 定义画板 · 产品宿主文件 · 现状 · 落点批次`。现状四档：✅已直接引用 / ◐部分或加类 / ✗未接 / ⊘登记不改。矩阵 ~60 行，按族分组：

- **基础原子(10)**：pw-btn 四态、pw-iconbtn、pw-badge 五色、pw-ico/data-ico、pw-kbd、pw-chip、pw-chipbtn、pw-dot、pw-seg、pw-group-title —— 大多 ✅
- **壳(8)**：pw-app 三栏、pw-side 五段、pw-brand/pw-logo、pw-session 六态、折叠导轨 pw-rail、pw-topbar/pw-tb-title、运行扫掠线(fork-ui ⊘)、pw-empty/pw-starters —— 大多 ✅
- **转录(13)**：pw-msg-user ✅、pw-md ◐(markdown-\* 102 条残留)、pw-proc/pw-step ✅、pw-card/pw-tool ✅、pw-diff-\* ◐(词级 ⊘)、pw-perm ✅、pw-todo ✅、pw-compact ✅、pw-sub(以工具卡徽标 ⊘)、pw-term ✅、pw-turn-end ✅、pw-toast ✅、内容块六分支 ✗
- **内容块(5)**：pw-code ✅、pw-table ✅、数学公式 ◐、Mermaid ✅、frontmatter 卡 ✗
- **输入框(7)**：三态 composer ✅、pw-chips ✅、token 高亮层 ◐、pw-select ✅、pw-send ✅、pw-ring+pw-pop ✅、排队徽章 ✅
- **弹层菜单(6)**：pw-pop 体系 ✅(部分)、模型选择器 ✅、@/命令菜单 ✗、pw-modal ✅(部分)、扩展请求对话框 ✅、二次确认 ✗
- **右栏(7)**：pw-panel 三段 ✅、pw-tabs/pw-tab ✅、pw-trow ✅、pw-viewer 六形态 **✗ 全套未接（最大遗留）**、CSV/图片缩放 ✗、pw-git 泳道 ⊘、pw-browser ✗
- **设置(6)**：pw-settings 壳 ✅、左导航 ✗、列表-详情 ✗、表单控件 ✗、用量九卡五图 ✗、皮肤条+工作室+壁纸 ◐(保留并约束输出，用户已裁定)
- **全局(4)**：菜单原子表(八种行) ✗(ContextMenu)、新建任务选择器 ✗、worktree 切换器 ◐、拖放落区 ◐
- **移动端(4)**：抽屉侧栏 ✅、覆盖工具条 ✅、安装提示 ◐、信任横幅 **✗ 新功能**
- **辅助(3)**：pw-minimap-rail/pop **✗ 未接**、阶段行四相位 ✅、项目/待办/GitRef 芯片 ◐
- **动效(1 族)**：17 项清单 ◐(token 已落，逐项对表)

每行现状都有本轮盘实的文件证据（遗留类名与行数），✗/◐ 项即工作量清单。

### 第 3 章 · 批次计划（每批 = 一组矩阵行的清空）
- **SW-00 git 快照**（硬前置）：78 个改动 + 9 项 untracked（design/、PwIcons.tsx、门禁脚本、旧计划文档）全部未提交——先入库，每批一个 commit 可独立 revert。
- **批次 A · 弹层与菜单**（SW-01~03）：ContextMenu→pw-pop 八种行；ComposerReferenceMenu/SessionSearch；NewTaskPicker + ProjectTrustDialog + DirectoryPicker 降级态。
- **批次 B · 文件查看器全套**（SW-04~06，最大遗留面）：pw-viewer 头行+源码态 → diff 覆盖层+全屏/缩放/已删除/冲突/空态 → CodeMirror 主题 + CsvPreview/ImagePreview/MarkdownFilePreview/PathActions/AttachmentPreview。
- **批次 C · 设置 13 分节**（SW-07~13，用户裁定全量照画板重写）：壳导航+常规 → 模型 → 子代理+技能 → 插件+MCP → 定时+记忆 → 快捷键+用量+命令+归档+导入 → 皮肤工作室+壁纸（保留，输出约束到 token 槽位）。
- **批次 D · 顶部面板与小件**（SW-14~15）：SystemPromptPanel/ToolDefinitionsPanel（去内嵌 style，参数表维持两列）；pw-minimap-rail/pop 接入+标题节点 kind、BranchNavigator 残余、pw-md 收尾、九个散件。
- **批次 E · 功能增补**（SW-16）：做——移动端信任横幅、迷你地图节点 kind；不做——agent 认证（画板自标提案）、参数四列（等价登记）。
- **批次 F · 收尾**（SW-17）：⊘项复核、基线 PNG 重渲、DIVERGENCE 回填、AGENTS.md 更新。

### 第 4 章 · 组件替换四步法（写死，禁止截图模仿）
① 打开定义画板 HTML 抄 DOM 原文（类名/层级/data-ico 一字不动）→ ② 接数据与事件（产品状态进 pw 类）→ ③ 产品侧 CSS 只做 UA 归零/窄屏语义，不重复画板值，覆盖用 0-2-0 特异性 → ④ 验收：structdiff DOM 签名 diff + 几何对数（1440×900 与 390×800）+ 浮窗裁切审计 + `npm run check:design` 四门禁 + check-contrast + 截图存证。

### 第 5 章 · 陷阱清单（实战教训固化）
overflow:hidden 裁浮窗、min-width:0 链压瘪芯片、挪 DOM 后删 stale CSS、虚拟列表容器外插行、内联 minWidth 压过 CSS、SettingsPanel 零 inline 纪律、源码守卫测试改"等价新约束"、dev/prod 共用 .next 的切换纪律、禁宽正则改 JSX。

### 第 6 章 · 裁定记录
用户两条（设置全量重写、皮肤工作室保留并约束输出）+ 我的增补裁定（信任横幅做、agent 认证不做等）+ 历史裁定索引。

### 第 7 章 · 明确不做清单（沿用旧计划 §7 + 新增）
### 第 8 章 · 附录
验收脚本用法速查（.scratch 四类脚本、check:design、check-contrast、render-boards）、常用命令、两套编号对照、29 画板 ↔ 批次反向索引。

## 执行步骤
1. 读 `docs/design-system-refactor-plan-2026-09-28.md` 全文与 `design/pi-web-design/README.md` 画板计数表校准引用。
2. 用 grep 实测第 2 章矩阵每行的证据（遗留类名行数、pw 挂类数），不自造数字。
3. 写出 `docs/design-skin-swap-plan-2026-09-29.md`。
4. 不改代码、不提交 git（SW-00 属计划内容，待你批准后执行）。