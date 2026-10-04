import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// fork:settings-frame（画板 62 帧 B / 画板 42 帧 3）—— 技能分节改版的**结构**断言。
// 断言只锁「照抄画板的 DOM 形态」与「62 硬规则」，不锁文案（文案在三语包里）。

const source = await readFile(new URL("./SkillsConfig.tsx", import.meta.url), "utf8");

test("detail column is header + rows + SKILL.md card (board D-11 frame C)", () => {
  // 详情头：d-row（h3 + 作用域徽标 + 条目级动作）
  assert.match(source, /<Title>/);
  assert.match(source, /data-ico="external-link"/);
  // 元信息是画板 D-11 的行式 `.d-set-row`（来源 / 路径 / 允许自动调用）
  assert.match(source, /className="d-set-sec"/);
  assert.match(source, /className="d-set-row"/);
  assert.match(source, /skills\.fieldSource/);
  // SKILL.md 是一张 `.d-card`：`.d-card-head` + grow + square-pen 编辑钮
  assert.match(source, /className="d-card-head"/);
  assert.match(source, /data-ico="square-pen"/);
});

test("SKILL.md editing does not embed a second scroll container (board 62 hard rule)", () => {
  // 62 硬规则：详情内部不再套第二层滚动 —— textarea 不写死 max-height/min-height，
  // 用 rows 跟着草稿长高，滚动交给详情列。
  // fork:skills-row-name-only（2026-10-02）—— 断言必须**按元素取**：安装弹层的壳
  // （fork:skills-modal-scroll）为了能滚，正当需要 max-height + flex 列，那是另一个
  // 元素，不属于这条硬规则。所以只截 <textarea ... /> 那一段来判。
  const textareaStart = source.indexOf("<textarea");
  const textarea = source.slice(textareaStart, source.indexOf("/>", textareaStart));
  assert.match(textarea, /className="d-textarea"/);
  assert.doesNotMatch(textarea, /maxHeight/);
  assert.doesNotMatch(textarea, /minHeight/);
});

test("list column renders scope groups with name-only rows (board D-11 frame A)", () => {
  // 作用域分组标题（项目 / 全局 / 路径）是画板的 `.d-group-title`
  assert.match(source, /className="d-group-title"/);
  // fork:skills-row-name-only（2026-10-02）—— 列表行只保留名称：`.pw-lsub` 副标题
  // 撤掉（board.css:860 只给了 color/font-size，没有钳位，真实描述铺 5~19 行）。
  // 断言只对 **JSX** 生效：取 renderSkillRow 那一段源码，别让解释性注释里的
  // 类名把断言喂饱（那正是旧版 /pw-lsub/ 变成假通过的原因）。
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

test("toolbar carries search, scope filter, merged count badge and update-all", () => {
  assert.match(source, /<PwSearch/);
  assert.match(source, /className="d-sep-v"/);
  assert.match(source, /scopeFilter/);
  // 画板：`17 个 · 4 个可更新` 合并成一枚 count 徽章
  assert.match(source, /tone="count"/);
  assert.match(source, /updateAllAvailable/);
});
