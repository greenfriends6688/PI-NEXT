import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./PromptsConfig.tsx", import.meta.url), "utf8");

/*
 * fork:settings-frame（画板 62）—— 自定义命令页的源码守卫。
 *
 * 落位表（画板 62 帧 E）：骨架 A/B → 新 B（列表 300 + 详情 760）；页头 sub 写
 * 「~/.pi/agent/prompts 下的模板」；页级动作「新建命令」；「空态说明飘在右列中段 →
 * 详情列居中空态」（62 帧 D「详情未选」：40px 方框图标 + 一句引导，居中）。
 * 与 UsageStatsPanel.test.mjs 一样分两层：结构层钉类名与挂载位置，口径层钉行为。
 */

test("骨架 B：SettingsPage(fill) + ConfigSplitView，页级动作「新建命令」在页头", () => {
  assert.match(source, /<SettingsPage[\s\S]*?sub=\{t\("prompts\.subtitle"\)\}/);
  // fill → `.pw-scontent.is-fixed`：整个分节就是列表 + 详情，两列各自滚（画板 62 帧 B）。
  assert.match(source, /fill\b/);
  assert.match(source, /<ConfigSplitView>/);
  const actionsAt = source.indexOf("actions={");
  const newAt = source.indexOf("prompts.new\"");
  assert.ok(actionsAt >= 0 && newAt > actionsAt, "新建命令必须是页头 actions");
  assert.match(source, /data-ico="plus" data-size="13"/, "动作形态照画板 46 页头：plus + primary sm");
});

test("工具栏 = 搜索 + 目录路径 + 计数等宽徽章，计数不在页头也不在列表里", () => {
  const toolbarAt = source.indexOf("toolbar={");
  assert.ok(toolbarAt > source.indexOf("actions={"), "工具栏在页头之后");
  assert.match(source, /<PwSearch[\s\S]*?t\("prompts\.search"\)/);
  assert.match(source, /className="pw-mono pw-dim">\{dir\}</);
  assert.match(source, /<ConfigBadge tone="count">\{t\("prompts\.count"/);
});

test("列表行：斜杠命令名 + 描述副标题（画板 46 的 pw-litem 两段式）", () => {
  assert.match(source, /className=\{`pw-litem\$\{editor\?\.originalName === prompt\.name \? " is-on" : ""\}`\}/);
  assert.match(source, /<span className="pw-lname">\/\{prompt\.name\}<\/span>/);
  assert.match(source, /<span className="pw-lsub">\{prompt\.description \|\| t\("prompts\.noDescription"\)\}<\/span>/);
  assert.match(source, /data-ico="square-function" data-size="14"/);
});

test("详情：头部 pw-inline + 字段行 pw-field + 整行 pw-textarea 挂 .pw-detail 直下", () => {
  assert.match(source, /<h3 className="pw-mono" style=\{\{ margin: 0 \}\}>/);
  // 画板 62 帧 B / 46 帧「自定义命令」：整行宽的正文编辑器不塞字段行。
  const detailAt = source.indexOf('<div className="pw-detail">');
  const textareaAt = source.indexOf("<textarea");
  const fieldAt = source.indexOf('className="pw-field"');
  assert.ok(detailAt > 0 && fieldAt > detailAt && textareaAt > fieldAt, "详情卡 = 头部 → 字段行 → 正文");
  assert.match(source, /<span className="pw-mono pw-dim">\/<\/span>/, "命令名的 / 前缀单独一格（画板 46）");
  assert.match(source, /<div className="pw-sec-title"/);
  // 表单级动作在表单块底部右对齐（62 动作层级 ④），不浮在视口角落。
  assert.match(source, /t\("i18n\.cancel"\)[\s\S]*?t\("i18n\.save"\)/);
});

test("详情未选：62 帧 D 的居中空态（40px 方框 mark + 引导），说明不再飘在右列中段", () => {
  // 详情列恒有 `.pw-detail` 卡 —— board.css 的 `.pw-detail .pw-empty` 高度规则
  // 只有在空态住进详情卡里才生效，卡外挂 `.pw-empty` 会退回「飘在中段」。
  const emptyAt = source.indexOf("<ConfigEmptyState>");
  const detailAt = source.indexOf('<div className="pw-detail">', emptyAt - 200) >= 0;
  assert.ok(emptyAt > 0 && detailAt, "空态必须包在详情卡里");
  assert.match(source, /<span className="mark" aria-hidden="true">\s*<i data-ico="square-mouse-pointer" data-size="16" \/>\s*<\/span>/);
  // 原来飘在右列中段的「保存后斜杠面板立即可用」收进空态。
  assert.match(source, /<ConfigEmptyState>[\s\S]*?t\("prompts\.paletteHint"\)[\s\S]*?<\/ConfigEmptyState>/);
});

test("状态行走画板原语，不挂旧壳类", () => {
  assert.match(source, /className="pw-hint">\{t\("i18n\.loading"\)\}</);
  assert.match(source, /className="pw-hint">\{query\.trim\(\) \? t\("prompts\.noMatch"\) : t\("prompts\.empty"\)\}</);
  assert.doesNotMatch(source, /className="sub"/, "列表列里的 sub 不在 .pw-sbody 直下，样式挂不上");
  assert.doesNotMatch(source, /config-sidebar|config-detail|config-switch|fork-settings/);
});
