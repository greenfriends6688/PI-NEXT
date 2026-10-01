import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// fork:settings-frame（画板 62 帧 B / 画板 42 帧 3）—— 技能分节改版的**结构**断言。
// 断言只锁「照抄画板的 DOM 形态」与「62 硬规则」，不锁文案（文案在三语包里）。

const source = await readFile(new URL("./SkillsConfig.tsx", import.meta.url), "utf8");

test("detail column is header + kv + body, not bare field listing (board 62 frame B)", () => {
  // 详情头：pw-inline（h3 + 作用域徽标 + 条目级动作）
  assert.match(source, /<ConfigDetailTitle>/);
  assert.match(source, /data-ico="external-link"/);
  // 元信息是 `.pw-kv` 属性表（来源 / 路径 / 允许自动调用开关）
  assert.match(source, /<ConfigKv>/);
  assert.match(source, /skills\.fieldSource/);
  // SKILL.md 是 sec-title 行：标题 + grow + square-pen 编辑钮
  assert.match(source, /className="pw-sec-title"/);
  assert.match(source, /data-ico="square-pen"/);
});

test("SKILL.md editing does not embed a second scroll container (board 62 hard rule)", () => {
  // 62 硬规则：详情内部不再套第二层滚动 —— textarea 不写死 max-height/min-height，
  // 用 rows 跟着草稿长高，滚动交给详情列。
  assert.match(source, /className="pw-textarea"/);
  assert.doesNotMatch(source, /maxHeight/);
  assert.doesNotMatch(source, /minHeight/);
});

test("list column renders scope groups with icon + subtitle rows (board 62 frame B)", () => {
  // 作用域分组标题（项目 / 全局 / 路径）+ 两行行（pw-lname + pw-lsub）
  assert.match(source, /ConfigSidebarGroupLabel/);
  assert.match(source, /pw-lsub/);
  assert.match(source, /data-ico=\{rowScope === "path" \? "folder-cog" : "box"\}/);
  // 沉睡排序保持在组内生效（dormancy 断言的调用形态不变）
  assert.match(source, /orderSkillsByDormancy\(grpSkills\)\.map\(renderSkillRow\)/);
});

test("install skills opens a board 42 dialog, not an inline detail view", () => {
  assert.match(source, /InstallSkillsModal/);
  assert.match(source, /pw-modal-head/);
  assert.match(source, /pw-modal-foot/);
  assert.match(source, /pw-iconbtn sm/);
  // 内联视图（AddSkillPanel）已随画板裁定退役
  assert.doesNotMatch(source, /AddSkillPanel/);
});

test("toolbar carries search, scope filter, merged count badge and update-all", () => {
  assert.match(source, /<PwSearch/);
  assert.match(source, /className="pw-sep"/);
  assert.match(source, /scopeFilter/);
  // 画板：`17 个 · 4 个可更新` 合并成一枚 count 徽章
  assert.match(source, /tone="count"/);
  assert.match(source, /updateAllAvailable/);
});
