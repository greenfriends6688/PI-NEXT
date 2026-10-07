import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// fork:v5-d11-frame-a（画板 D-11）—— 技能分节改版的**结构**断言。
// 桌面 = 帧A 表格（计数行 + 筛选行 + .d-table + 两条横幅）+ 帧C 内容弹层；
// 移动端（M-05）= 既有列表 + 内联详情，原样保留。
// 断言只锁「照抄画板的 DOM 形态」与「62 硬规则」，不锁文案（文案在三语包里）。

const source = await readFile(new URL("./SkillsConfig.tsx", import.meta.url), "utf8");

test("desktop table section is count row + filter row + d-table (board D-11 frame A)", () => {
  const desktop = source.slice(source.indexOf("fork:v5-d11-frame-a —— 桌面 = 画板 D-11 帧A"));
  // sec 标题 + 计数行（总/启用/关掉）+ 「搜索与安装」入口
  assert.match(desktop, /className="d-set-sec-t"/);
  assert.match(desktop, /skills\.countSummary/);
  assert.match(desktop, /skills\.searchAndInstall/);
  // 表格在 `.d-card` 里：列头 技能(30%) / 来源 / 版本 / 状态 / 启用
  assert.match(desktop, /className="d-card"/);
  assert.match(desktop, /className="d-table"/);
  assert.match(desktop, /style=\{\{ width: "30%" \}\}/);
  assert.match(desktop, /skills\.colSkill/);
  assert.match(desktop, /skills\.colSource/);
  assert.match(desktop, /skills\.colVersion/);
  assert.match(desktop, /skills\.colStatus/);
  assert.match(desktop, /skills\.colEnable/);
  // 行 = 名称+描述两行（d-col）+ 来源徽标 + 版本 + 状态 + 真开关 + 更多
  const row = source.slice(
    source.indexOf("const renderSkillTableRow"),
    source.indexOf("  return (\n    <ConfigPanelShell"),
  );
  assert.match(row, /className="d-col"/);
  assert.match(row, /d-t-b/);
  assert.match(row, /d-t-xs d-t-faint/);
  assert.match(row, /d-mono/);
  assert.match(row, /role="switch"/);
  assert.match(row, /event\.stopPropagation\(\)/);
  assert.match(row, /className="d-iconbtn"/);
  assert.match(row, /data-ico="ellipsis"/);
  // 沉睡排序保持生效（enabled 在前）
  assert.match(desktop, /orderSkillsByDormancy\(visibleSkills\)\.map\(renderSkillTableRow\)/);
});

test("frame A carries the untrusted-directory banner（「关掉 ≠ 卸载」横幅已删）", () => {
  const desktop = source.slice(source.indexOf("fork:v5-d11-frame-a —— 桌面 = 画板 D-11 帧A"));
  /* fork:settings-no-explainer（用户 2026-10-06 裁定）—— 设置页不再摆说明性文案，
     「关掉 ≠ 卸载」那条 `d-banner warn` + `circle-help` 横幅整条删了。它以前是这一帧
     里唯一那条 warn 档横幅，所以旧断言（拿 `d-banner warn` / `circle-help` 当探针）
     一并换成「它真的不在了」—— 板面保留，偏离记在 DIVERGENCE。
     要重建那条「关了不会删文件」的安心感，正确落点是行内状态或 title，不是一块横幅。 */
  assert.doesNotMatch(desktop, /skills\.offNotUninstall/, "「关掉 ≠ 卸载」横幅不许回来");
  assert.doesNotMatch(desktop, /data-ico="circle-help"/);
  // 未信任目录（shield-question）：项目技能未加载时出现 —— 这是**状态**，保留。
  assert.match(desktop, /data-ico="shield-question"/);
  assert.match(desktop, /trust\.skillsNotLoaded/);
});

test("row click opens the frame C content modal; more-menu carries entry actions", () => {
  assert.match(source, /function SkillContentModal/);
  assert.match(source, /const openRow = \(skill: Skill\)/);
  assert.match(source, /openMenu\(event\.clientX, event\.clientY, entries, \{ title: skill\.name \}\)/);
  // 弹层只挂桌面（移动端是内联详情），按文件路径换实例
  assert.match(source, /!isMobile && contentSkill && \(/);
  assert.match(source, /key=\{contentSkill\.filePath\}/);
});

test("content modal is frame C: seg tabs (rendered/raw), frontmatter switch, d-code", () => {
  const modal = source.slice(
    source.indexOf("function SkillContentModal"),
    source.indexOf("/** fork:skillhub"),
  );
  // 画板弹层骨架：d-modal is-open > d-modal-box wide > head/body/foot
  assert.match(modal, /className="d-modal is-open"/);
  assert.match(modal, /className="d-modal-box wide"/);
  assert.match(modal, /className="d-modal-head"/);
  assert.match(modal, /className="d-modal-body"/);
  assert.match(modal, /className="d-modal-foot"/);
  // 正文一段 `.d-seg`（渲染 / 原文）+ 右端路径
  assert.match(modal, /className="d-seg"/);
  assert.match(modal, /role="tablist"/);
  assert.match(modal, /skills\.tabRender/);
  assert.match(modal, /skills\.tabRaw/);
  assert.match(modal, /displayPath\(skill\.filePath\)/);
  // 渲染 pane = d-card（head 文件名 + 编辑动作 / body 正文）
  assert.match(modal, /className="d-card-head"/);
  assert.match(modal, /data-ico="square-pen"/);
  // 原文 pane = frontmatter 开关行 + d-code（行号 d-ln，真实文件行号）
  assert.match(modal, /skills\.frontmatter/);
  assert.match(modal, /className="d-code-head"/);
  assert.match(modal, /className="d-code-body"/);
  assert.match(modal, /className="d-ln"/);
  // 能力面映射：允许自动调用开关在弹层里有一行真开关
  assert.match(modal, /skills\.allowAutoInvoke/);
});

test("SKILL.md editing does not embed a second scroll container (board 62 hard rule)", () => {
  // 62 硬规则：详情内部不再套第二层滚动 —— textarea 不写死 max-height/min-height，
  // 用 rows 跟着草稿长高，滚动交给宿主（移动端详情列 / 帧C 弹层）。
  // fork:skills-row-name-only（2026-10-02）—— 断言必须**按元素取**：安装弹层的壳
  // （fork:skills-modal-scroll）为了能滚，正当需要 max-height + flex 列，那是另一个
  // 元素，不属于这条硬规则。帧C 弹层与移动端详情各有一个 textarea，逐个判。
  const textareas = [...source.matchAll(/<textarea[\s\S]*?\/>/g)].map((m) => m[0]);
  assert.ok(textareas.length >= 2, "mobile detail and frame C modal each host one textarea");
  for (const textarea of textareas) {
    assert.match(textarea, /className="d-textarea"/);
    assert.doesNotMatch(textarea, /maxHeight/);
    assert.doesNotMatch(textarea, /minHeight/);
  }
});

test("mobile branch keeps scope groups with name-only rows (M-05)", () => {
  // 作用域分组标题（项目 / 全局 / 路径）是画板的 `.d-group-title`
  assert.match(source, /className="d-group-title"/);
  // fork:skills-row-name-only（2026-10-02）—— 列表行只保留名称：副标题
  // 撤掉（旧 board.css 的 lsub 没有钳位，真实描述铺 5~19 行）。
  // 断言只对 **JSX** 生效：取 renderSkillRow 那一段源码，别让解释性注释里的
  // 类名把断言喂饱。
  const row = source.slice(
    source.indexOf("const renderSkillRow"),
    source.indexOf("<ConfigPanelShell"),
  );
  assert.match(row, /d-sess-t/);
  assert.doesNotMatch(row, /pw-lsub/);
  // 描述没丢：进详情列的 `.d-set-row`（详情头正下方）。
  assert.match(source, /t\("i18n\.description"\)/);
  assert.match(source, /\{skill\.description\}/);
  assert.match(source, /data-ico=\{rowScope === "path" \? "folder-cog" : "box"\}/);
  // 沉睡排序保持在组内生效（dormancy 断言的调用形态不变）
  assert.match(source, /orderSkillsByDormancy\(grpSkills\)\.map\(renderSkillRow\)/);
});

test("install dialog has one real scroll container (fork:skills-modal-scroll)", () => {
  // 壳：视口上限 + flex 列（照 ChatWindow 扩展对话框 / ImagePreview / DirectoryPicker）
  // 内容行：flex:1 + min-height:0 + overflow-y:auto —— board.css:643 的 overflow-y
  // 只有在父级给上限、这一行能收缩时才真正生效（此前 scrollHeight === clientHeight）。
  assert.match(source, /maxHeight: "calc\(var\(--app-viewport-height, 100dvh\) - 32px\)"/);
  assert.match(source, /display: "flex",\s*\n\s*flexDirection: "column",/);
  assert.match(
    source,
    /<div\s*\n\s*className="pw-modal-body"\s*\n\s*style=\{\{\s*\n\s*flex: "1 1 0%",\s*\n\s*minHeight: 0,\s*\n\s*overflowY: "auto",\s*\n\s*gridTemplateColumns: "minmax\(0, 1fr\)",\s*\n\s*\}\}\s*>/,
  );
  // 横滚动条不许出现：长 token（安装路径 / 技能名 / repo）就地折行
  assert.match(source, /overflowWrap: "anywhere"/);
  // 结果改成画板 D-11 帧 B 的商店卡片网格
  assert.match(source, /className="d-store-grid"/);
});

test("install skills opens a board 42 dialog, not an inline detail view", () => {
  assert.match(source, /InstallSkillsModal/);
  assert.match(source, /pw-modal-head/);
  assert.match(source, /pw-modal-foot/);
  assert.match(source, /d-iconbtn sm/);
  // 内联视图（AddSkillPanel）已随画板裁定退役
  assert.doesNotMatch(source, /AddSkillPanel/);
});

test("filter row carries search, scope filter and the filtered-scope group switch", () => {
  assert.match(source, /<PwSearch/);
  assert.match(source, /scopeFilter/);
  // 画板：`17 个 · 4 个可更新` 合并成一枚 count 徽章（移动端工具栏保留）
  assert.match(source, /tone="count"/);
  assert.match(source, /updateAllAvailable/);
  // fork:group-switch（G4）—— 表格化后组开关挪进筛选行：选了作用域才出现，
  // 作用于当前筛选出的可见集合
  assert.match(source, /scopeFilter !== "all" && visibleSkills\.length > 0 && \(/);
  assert.match(source, /setGroupSkills\(scopeFilter, visibleSkills, next\)/);
});
