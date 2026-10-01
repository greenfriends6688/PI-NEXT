# 换肤收尾集中修复计划（全量 P0–P5 + 删除 BoardUI 层）

## 扫描结论

**已完成、无需动**：CSS 分层顺序、Geist 字体、主题三档（light/dark/auto）、动效 token 值、静态门禁四件套全绿；三栏壳/侧栏五段/composer 三段/过程时间轴/工具卡/回合结束行/迷你地图（含 kind 字段+图钉）/PathActions/EmptyStateGuide/TodoChip/排队徽章等已照画板 DOM 落地；设置壳+13 分节导航+控件基件（SW-07）、插件+MCP（SW-10）、定时+记忆（SW-11）、快捷键+用量（SW-12 主体）已完成且有测试锚定。

**三类缺口**：
- **A 未换肤**：设置三件未开始（PromptsConfig / 归档×2 / ImportPanel，pw=0）；ThemeSkinStudio 对话框未接 pw-modal（画板 47 帧已就绪）+ BuiltinWallpaperPicker；ModelsConfig 106 处 inline；SkillsConfig 29 处 + AgentsConfig 详情区 14 处 inline；ConfigPanelShell 未换、config-sidebar-group 残留 7 处；markdown-* 103 条旧 CSS 双轨并行；TurnWrittenFiles 全 inline；BranchNavigator 大面积 inline；PWA 安装提示功能本体缺失；移动端信任横幅点击仍弹模态框。
- **B 已改但对不上**：①`BrowserPanel.tsx:170 align="end"` 类型错误（tsc 唯一报错，疑似外部回滚残留）；②TopBarPopovers 用了 10 个 `topbar.*` i18n 键、三语字典全没有 → 界面渲染原始键名；③token 高亮层画板 `pw-tok-ref/pw-tok-cmd` 零接入、颜色档位差一档；④MermaidZoom 自绘样式与 ImagePreview 的 pw-modal 不一致；⑤拖放阈值 10MB vs 画板 61 文案 20MB；⑥fork-ui.css 7 个顶层 pw-* 重定义 + settings.css 12 个同名（判据⑦欠账）。
- **C 规范欠账**：AGENTS.md 停留在 BoardUI 时代；BoardUI 1124 行架空（颜色权威已迁 `--ds-*`、52 排版类 0 使用、字体引用死链）；settings.css 72 个死类；4 个验收脚本未挂 npm scripts；审计文档 §2.5 滞后；设计侧画板 20 `.pw-stats` 三帧旧稿待清理。

---

## P0 · 真 bug 修复（半小时级）

1. `components/BrowserPanel.tsx:170` `align="end"` → PortalDropdown 类型只收 `"left"|"right"`（`PortalDropdown.tsx:80`），按右对齐语义改 `"right"`；tsc 归零。
2. 补 10 个 `topbar.*` i18n 键到 `lib/i18n/messages/{en,zh-CN,zh-TW}.ts`（mcp / mcpServers / mcpLoadFailed / mcpNone / plugins / extensionStatus / pluginPackages / pluginLoadFailed / pluginNone / pluginTotals），文案照画板 22 用词；i18n registry 测试守三语一致。

验收：tsc 0 错；顶栏 MCP/插件浮窗不再出现原始键名。

## P1 · 设置收尾（批次 C 残留，工作量最大头）

统一走既有四步法（抄画板 DOM 原文 → 接数据与事件 → 产品 CSS 只做 UA 归零 → 验收六件套）；SettingsPanel「零 inline style」守卫不破。

1. **三件未开始（画板 46）**：`components/fork/PromptsConfig.tsx`（18 处 settings-*、22 inline）、`ArchivedSessionsPanel.tsx` + `ProjectArchivePanel.tsx`（pw=0）、`ImportPanel.tsx`（13 处 settings-*）→ 全部照画板重写为 pw-* 件。
2. **皮肤工作室（画板 47）**：`ThemeSkinStudio.tsx` 对话框壳接 `pw-modal`（900×720，五行结构：头行 / 页签行 pw-tabs / 内容行 / 提示行 / 动作行 pw-modal-foot；`47-skin-studio.html:71-215` 帧已就绪），`fork-skin-dialog-*` 68 条退役；`BuiltinWallpaperPicker` 接 `pw-wallpaper-thumb` 家族。
3. **ModelsConfig 补课（画板 41）**：106 处 inline 清理；模型行 omit/null/string 三态分段控件整段自绘改画板分段形态；`config-button-success-icon` 残留收编。
4. **SkillsConfig + AgentsConfig 补课（画板 42）**：技能 29 处 inline；子代理详情区 14 处 inline + `agents-feature-*`/`agents-system-prompt` 自有类改画板件。
5. **外壳统一**：`ConfigPanelShell`（config-panel-*）→ pw-modal 家族；`config-sidebar-group` 7 处残留收编为画板分组行。

## P2 · 转录一致性与散件（SW-15 残留）

1. **markdown-\* 退役**：pw-md 已接管渲染，拆发射端（`MarkdownBody.tsx:243`、`MessageView.tsx:509/517/1652/1785`、`FrontmatterCard` 6 处）+ `globals.css` 103 条规则逐条退役；`FileViewer` 的 Markdown 预览容器接 pw-md/pw-viewer 体系后退役 `markdown-file-preview`/`markdown-readable-column`。
2. **token 高亮层对表（画板 20）**：@引用与 /命令着色接 `pw-tok-ref`/`pw-tok-cmd`；`mention-token` 颜色 `--accent` → 画板 `--accent-text`；无 CSS 的 `mention-token-{kind}` 后缀清掉。
3. **MermaidZoom → pw-modal**（对齐 ImagePreview 做法），`globals.css` 11 条 `mermaid-zoom-*` 退役。
4. **TurnWrittenFiles**（画板 53「回合写过的文件」）接 pw 件；BranchNavigator 残余 inline 清理。
5. **拖放阈值**：保留实现 10MB，登记 DIVERGENCE（画板 61 的 20MB 属提案值）。
6. **内容块六分支**：resource_link/音频/embedded text 产品数据模型无对应类型（`lib/types.ts:52`）——登记「无数据源不画」，销项。

## P3 · 移动端增补（SW-16）

1. **移动端信任横幅完整化（画板 60 D）**：standalone/isMobile 下点击横幅**不再弹模态框**，改为横幅内联「信任」按钮直接完成信任动作；桌面维持现有弹窗。
2. **PWA 安装提示分平台（画板 60 B）**：Android 捕获 `beforeinstallprompt` 弹安装提示；iOS 显示「分享 → 添加到主屏幕」教学提示；可关闭。

## P4 · 基建治理 + 文档同步

1. **删除 BoardUI 架空层**（已裁定）：`globals.css` 去掉 `@import boardui/theme.css + typography.css`；删 `app/boardui/`（1124 行）；ChatWindow 4 处 `text-text-muted` → `var(--text-muted)`；保留 `--color-*` → Zeno 槽位反向桥；截图对比应零视觉变化。
2. **判据⑦收编**：fork-ui.css 7 个顶层 pw-* 重定义（pw-side-search / pw-range / pw-skin-strip / pw-skin-actions / pw-snav-close / pw-wallpaper-thumb / pw-md）——board.css 已有同名定义的删本地副本，没有的上提；`pw-snav-row` 自有类改名 fork-*；settings.css 12 个同名收敛到只留带注释的 0-2-0 有意覆盖。
3. **死 CSS 清退**：settings.css 35 个 config-* + 37 个 settings-* 无引用选择器逐个 grep 确认后删除；`settings-chat-range-hint` 改挂 board.css 的 `pw-hint`。
4. **门禁成体系**：package.json 挂 `check:icons`、`check:contrast`、`verify:boards`（board-diff + verify-against-boards）；board-specs 补 P1/P2 触及画板（42/43/46/47）的规格。
5. **文档**：AGENTS.md 皮肤章节从 BoardUI 体系重写为 pi-web-design 体系（画板位置、SW 编号、验收协议、判据⑦、Geist、圆角 3/4/6、主题三档）；审计文档 §2.5 按实测更新；DIVERGENCE.md 回填本轮全部裁定；设计侧清理画板 20 `.pw-stats` 三帧旧稿（DIVERGENCE 53）。

## P5 · 验收收尾（SW-17）

1. 动效 17 项对表（画板 05）+ `prefers-reduced-motion` 停终态核查；`--motion-slow/--motion-instant` 13 处旧名引用改新名。
2. `verify-against-boards.mjs` 全画板跑一遍（npm run prod），report 存 `docs/screenshots/`。
3. 全量验收：tsc 0 错 / lint 0 错 / npm test 全绿 / `check:design` 四门禁 / check-contrast。
4. 矩阵销项：`docs/design-skin-swap-plan-2026-09-29.md` 剩余 ✗/◐ 逐行更新。

---

## 执行约定

- **第〇原则：禁止截图模仿**——每个组件打开对应画板 HTML 原样复制 DOM 段，产品数据/事件接上去。
- 测试守卫改成断言新结构，不删测试；SettingsPanel/SettingsUi 的 inline 守卫保持生效。
- 每批验收六件套：tsc + lint + test 全绿、浮窗裁切审计、`check:design`、改色跑 check-contrast。
- 陷阱清单照 `docs/design-skin-swap-plan-2026-09-29.md` §5（overflow 裁切、左缘锚定、min-width 链、stale CSS、零 inline 守卫等）。
- **提交节奏**：P0–P5 每批一个独立 commit（`fix(skin): P0 …` / `refactor(skin): P1 …` …），两个既有 WIP 提交保留为还原点。